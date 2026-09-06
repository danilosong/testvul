import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeFields } from "../analysis/field-analyzer";
import { generateCandidates } from "../analysis/candidate-generator";
import { setAuthorizationExpectation } from "../auth/authorization-expectations-repository";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { listEvidenceForScanRun } from "../evidence/evidence-repository";
import { evidentiaryOutcomeForXssVerdict } from "../findings-reporting/evidentiary-outcome";
import { listFindings, recordFinding } from "../findings-reporting/finding-repository";
import { severityForXssVerdict } from "../findings-reporting/technical-finding-builder";
import { SecurityHttpClient } from "../http/security-http-client";
import { addMutationScopeEntry } from "../mutation/mutation-scope";
import type { DiscoveredOperation } from "../operation-discovery/discovered-operation";
import { ScopeValidator } from "../scope";
import { runGtmPermissionTest } from "../scanners/gtm/gtm-permission-test";
import { evaluateGtmPermissionFinding } from "../scanners/gtm/gtm-finding-policy";
import { runReadIdorTest } from "../scanners/idor/read-idor-test";
import type { Candidate, ScanContext } from "../scanners/security-scanner";
import { XssScanner } from "../scanners/xss/xss-scanner";
import { insertCandidate, updateEvidentiaryOutcome } from "../eligibility/candidates-repository";
import { createNewSecurityAudit } from "../target-configuration/new-security-audit";
import { MUTATION_AUTHORIZATION_CONFIRMATION_TEXT, startScan } from "../target-configuration/start-scan";
import { finalizeScanRun } from "./scan-run-state-machine";
import { runPipeline, type PipelineStageRunner } from "./pipeline-sequencer";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");
let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
}, 60_000);

afterAll(async () => {
  await servers.stop();
});

describe("Section 18.1 — full Safe Automatic scan", () => {
  it("discovers and proves the seeded XSS, GTM and IDOR controls, restores every write, and completes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sca-safe-automatic-e2e-"));
    const db: Db = openDb(join(dir, "test.db"));
    runMigrations(db, MIGRATIONS_DIR);

    try {
      const targetId = createNewSecurityAudit(db, {
        projectName: "Safe Automatic E2E",
        targetDns: "127.0.0.1",
        environment: "LOCAL_FIXTURE",
        scanMode: "SAFE_AUTOMATIC",
      });
      addMutationScopeEntry(db, { targetId, objectType: "project", resourceId: "1" });
      const userAProfileId = Number(db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('User A', 'BEARER')").run().lastInsertRowid);
      const userBProfileId = Number(db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('User B', 'BEARER')").run().lastInsertRowid);
      setAuthorizationExpectation(db, { authProfileId: userBProfileId, action: "analyticsGtm", expected: "DENIED" });
      const { scanRunId } = startScan(db, {
        targetId,
        authProfileIds: [userAProfileId, userBProfileId],
        mutationAuthorization: { confirmationText: MUTATION_AUTHORIZATION_CONFIRMATION_TEXT, confirmedBy: "e2e-operator" },
      });

      const origin = `http://127.0.0.1:${ports.httpPort}`;
      const resourceUrl = `${origin}/api/projects/1`;
      const client = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["127.0.0.1"]), allowPrivateNetworks: true });
      const operations: DiscoveredOperation[] = [
        { method: "GET", url: resourceUrl, source: "OPENAPI", confidence: "HIGH" },
        { method: "PATCH", url: resourceUrl, source: "OPENAPI", confidence: "HIGH" },
      ];
      const resourceKey = { targetId, origin, objectType: "project", resourceId: "1" };

      await client.request(resourceUrl, {
        method: "PATCH",
        headers: { Authorization: "Bearer userA-token", "Content-Type": "application/json" },
        body: JSON.stringify({ notes: "<p>Assinatura existente</p>" }),
      });

      let discoveredCandidates: ReturnType<typeof generateCandidates> = [];
      const noOp: PipelineStageRunner = async () => ({});
      await runPipeline({
        stageRunners: {
          DNS_RESOLVER: noOp,
          SCOPE_VALIDATION: noOp,
          HTTP_DISCOVERY: noOp,
          CRAWLER_AND_BROWSER_RUNTIME_DISCOVERY: noOp,
          API_DISCOVERY: async () => operations,
          JSON_DOM_ANALYZER: async () => {
            const response = await client.request(resourceUrl, { headers: { Authorization: "Bearer userA-token" } });
            return analyzeFields(JSON.parse(response.body));
          },
          OPERATION_DISCOVERY: async () => operations,
          BUSINESS_OBJECT_STATE_DISCOVERY: noOp,
          CANDIDATE_GENERATOR: (previous) => {
            discoveredCandidates = generateCandidates(previous.JSON_DOM_ANALYZER as ReturnType<typeof analyzeFields>, resourceUrl);
            expect(discoveredCandidates.some((candidate) => candidate.scanner === "XSS" && candidate.fieldPath === "notes")).toBe(true);
            expect(discoveredCandidates.some((candidate) => candidate.scanner === "GTM" && candidate.fieldPath === "analyticsGtm")).toBe(true);
            return discoveredCandidates;
          },
          ELIGIBILITY_CLASSIFICATION: noOp,
          AUTHENTICATION_MAPPING: noOp,
          SECURITY_TESTS: async () => {
            const generatedXss = discoveredCandidates.find((candidate) => candidate.scanner === "XSS" && candidate.fieldPath === "notes")!;
            const persistedXss = insertCandidate(db, scanRunId, {
              scanner: "XSS", fieldPath: generatedXss.fieldPath, confidence: generatedXss.confidence, priority: generatedXss.priority,
              resourceKey, resourceUrl, writeMethod: "PATCH", operations, minConfidence: "MEDIUM", isPassiveTest: false,
              inScope: true, hasRequiredAuth: true, requiresOwnershipData: false, hasOwnershipData: false,
              advancedOverrideConfirmed: false, environmentPolicyAllows: true, localFixtureDenylistOverrideActive: false,
            });
            const candidate: Candidate = {
              id: persistedXss.id, scanner: "XSS", resourceKey, resourceUrl, fieldPath: "notes", writeMethod: "PATCH",
              eligibilityState: persistedXss.eligibilityState, browserTestability: persistedXss.browserTestability,
            };
            const context: ScanContext = {
              db, scanRunId, httpClient: client, operations, minConfidence: "MEDIUM", authHeaders: { Authorization: "Bearer userA-token" },
            };
            const xssResult = await new XssScanner(client).test(context, candidate);
            expect(xssResult.verdict).toBe("RAW_HTML");
            updateEvidentiaryOutcome(db, candidate.id, evidentiaryOutcomeForXssVerdict(xssResult.verdict));
            recordFinding(db, {
              scanRunId, title: "Stored XSS: HTML bruto persistido", severity: severityForXssVerdict(xssResult.verdict),
              evidentiaryOutcome: "PROVEN_VULNERABLE", targetEndpoint: resourceUrl, fieldPath: "notes",
              evidenceId: xssResult.evidenceIds[0], restoreStatus: "RESTORE_OK",
            });

            const gtmResult = await runGtmPermissionTest({
              db, scanRunId, requester: { request: (url, options) => client.request(url, { ...options, headers: { ...options?.headers, Authorization: "Bearer userB-token" } }) },
              resourceKey, resourceUrl, fieldPath: "analyticsGtm", initiator: "API", holder: "API:GTM_SCANNER", operations,
            });
            expect(gtmResult.outcome).toBe("AUTHORIZED");
            expect(gtmResult.restoreOutcome).toBe("RESTORE_OK");
            expect(evaluateGtmPermissionFinding(gtmResult.outcome, "DENIED")).toBe("AUTHORIZATION_POLICY_VIOLATION");
            recordFinding(db, {
              scanRunId, title: "Política de autorização GTM violada", severity: "HIGH", evidentiaryOutcome: "PROVEN_VULNERABLE",
              targetEndpoint: resourceUrl, fieldPath: "analyticsGtm", authProfileId: userBProfileId, restoreStatus: "RESTORE_OK",
            });

            const idorResult = await runReadIdorTest({
              requester: { request: (url, options) => client.request(url, { ...options, headers: { ...options?.headers, Authorization: "Bearer userB-token" } }) },
              resourceUrl, resourceIdFieldPath: "id", expectedResourceId: "1", ownerFieldPath: "owner", expectedOwnerId: "userA",
            });
            expect(idorResult.outcome).toBe("POTENTIAL_BOLA");
            recordFinding(db, {
              scanRunId, title: "BOLA confirmado por identidade do recurso", severity: "HIGH", evidentiaryOutcome: "PROVEN_VULNERABLE",
              targetEndpoint: resourceUrl, authProfileId: userBProfileId,
            });
            return { xssResult, gtmResult, idorResult };
          },
          EVIDENCE: noOp,
          RESTORE: () => {
            const terminalStates = db.prepare(
              `SELECT mj.state FROM mutation_journal mj WHERE mj.scan_run_id = ? AND mj.id = (
                 SELECT MAX(mj2.id) FROM mutation_journal mj2 WHERE mj2.target_id = mj.target_id AND mj2.origin = mj.origin
                   AND mj2.tenant_id IS mj.tenant_id AND mj2.object_type = mj.object_type AND mj2.resource_id = mj.resource_id
               )`,
            ).all(scanRunId) as { state: string }[];
            expect(terminalStates).not.toHaveLength(0);
            expect(terminalStates.every((row) => row.state === "RESTORE_OK")).toBe(true);
            return terminalStates;
          },
          REPORT: noOp,
        },
      });

      const findings = listFindings(db, scanRunId);
      expect(findings.map((finding) => [finding.title, finding.severity])).toEqual([
        ["Stored XSS: HTML bruto persistido", "HIGH"],
        ["Política de autorização GTM violada", "HIGH"],
        ["BOLA confirmado por identidade do recurso", "HIGH"],
      ]);
      expect(listEvidenceForScanRun(db, scanRunId).filter((evidence) => evidence.restoreStatus !== undefined).every((evidence) => evidence.restoreStatus === "RESTORE_OK")).toBe(true);
      expect(finalizeScanRun(db, scanRunId, { cancellationRequestedAndCleanlyCompleted: false, unrecoverableErrorOccurred: false, anyQueueTruncated: false })).toBe("COMPLETED");
      expect((db.prepare("SELECT state FROM scan_runs WHERE id = ?").get(scanRunId) as { state: string }).state).toBe("COMPLETED");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
