import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { withAuthHeaders } from "../scanners/authenticated-requester";
import { resolveDns } from "../dns/resolver";
import { discoverRoot } from "../discovery/http-discovery";
import { runStaticDiscovery } from "../discovery/run-static-discovery";
import { buildAttackSurface, type DiscoveredResource } from "../discovery/attack-surface";
import { discoverRuntimeSurface, toDiscoveredResources } from "../browser/browser-runtime-discovery";
import { discoverOpenApi } from "../api-discovery/openapi-discovery";
import { analyzeFields, type AnalyzedField } from "../analysis/field-analyzer";
import { operationsFromOpenApi } from "../operation-discovery/openapi-operations";
import { registerDiscoveredOperation, getDiscoveredOperations } from "../operation-discovery/discovered-operations-repository";
import type { DiscoveredOperation } from "../operation-discovery/discovered-operation";
import { recognizeObjectTypesFromUrl, recordBusinessObject } from "../business-logic/business-object-discovery";
import { recordObservedState } from "../business-logic/state-model";
import { generateCandidates } from "../analysis/candidate-generator";
import { insertCandidate } from "../eligibility/candidates-repository";
import { addMutationScopeEntry } from "../mutation/mutation-scope";
import { createAuthProfile, getAuthProfile, getDecryptedCredential } from "../auth/auth-profiles-repository";
import { XssScanner } from "../scanners/xss/xss-scanner";
import type { Candidate, ScanContext } from "../scanners/security-scanner";
import { computeBusinessLogicCoverage, buildProfileObjectTypeMap } from "../business-logic/business-logic-coverage";
import { composeProfiles } from "../business-logic/profiles/profile-plugin";
import { GENERIC_PROFILE, type GenericProfileContext } from "../business-logic/profiles/generic";
import { createContestProfile } from "../business-logic/profiles/contest";
import { listBusinessFindings } from "../business-logic/business-findings-repository";
import { buildAuthHeaders } from "./auth-header-mapping";
import { resolveOperationUrl } from "./operation-url-resolution";
import { runPipeline, type PipelineStage, type PipelineStageProgress } from "./pipeline-sequencer";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let browser: Browser;

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
let originalKeyEnv: string | undefined;

beforeAll(async () => {
  originalKeyEnv = process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  servers = createServers();
  ports = await servers.start();
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  await browser.close();
  await servers.stop();
  if (originalKeyEnv === undefined) delete process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY = originalKeyEnv;
});

function origin(): string {
  return `http://127.0.0.1:${ports.httpPort}`;
}

describe("Section 14.2 — the Fixed Pipeline Sequencer, end-to-end against the real fixture app", () => {
  it(
    "runs every stage strictly in order, including the browser-runtime and business-logic stages, with per-resource restore completing before the next test on that resource",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "sca-run-full-pipeline-"));
      const db: Db = openDb(join(dir, "test.db"));
      runMigrations(db, MIGRATIONS_DIR);
      db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
      db.prepare(
        "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'SAFE_AUTOMATIC', 10, 'LOCAL_FIXTURE')",
      ).run();
      db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
      const scanRunId = 1;
      const targetId = 1;

      addMutationScopeEntry(db, { targetId, objectType: "project", resourceId: "1" });

      const scopeValidator = new ScopeValidator(["127.0.0.1"]);
      const httpClient = new SecurityHttpClient({ scopeValidator, allowPrivateNetworks: true });
      // Ordinary discovery (crawling, field analysis, candidate generation)
      // already operates under a configured Authentication Profile from the
      // start, per Sections 5/8 — Section 14.2's own Authentication Mapping
      // stage is specifically about resolving *which* profile a candidate
      // is tested AS, ahead of the Security Tests stage.
      const discoveryRequester = withAuthHeaders(httpClient, { Authorization: "Bearer userA-token" });

      // A realistic pre-condition: the owner previously stored HTML-shaped
      // content in "notes" (stored verbatim by the fixture — the actual
      // vulnerability), before this scan ever ran — not something the
      // pipeline itself sets up.
      await discoveryRequester.request(`${origin()}/api/projects/1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: "<p>Existing signature</p>" }),
      });

      const events: PipelineStageProgress[] = [];

      const { results, progress } = await runPipeline({
        onProgress: (event) => events.push(event),
        stageRunners: {
          DNS_RESOLVER: () => resolveDns("127.0.0.1"),

          SCOPE_VALIDATION: async () => {
            const inScope = scopeValidator.isInScope(origin());
            expect(inScope).toBe(true);
            return { inScope };
          },

          HTTP_DISCOVERY: () => discoverRoot(httpClient, origin()),

          CRAWLER_AND_BROWSER_RUNTIME_DISCOVERY: async () => {
            const staticResources: DiscoveredResource[] = await runStaticDiscovery(httpClient, origin(), { maxDepth: 1, maxPages: 15 });
            const browserContext = await browser.newContext();
            await browserContext.addCookies([{ name: "session", value: "userA-token", url: origin() }]);
            const runtimeResult = await discoverRuntimeSurface(browserContext, `${origin()}/app/projects/1`);
            await browserContext.close();
            const surface = buildAttackSurface([...staticResources, ...toDiscoveredResources(runtimeResult)]);
            return { staticResourceCount: staticResources.length, surface };
          },

          API_DISCOVERY: () => discoverOpenApi(httpClient, origin()),

          JSON_DOM_ANALYZER: async () => {
            const response = await discoveryRequester.request(`${origin()}/api/projects/1`);
            expect(response.status).toBe(200);
            return analyzeFields(JSON.parse(response.body));
          },

          OPERATION_DISCOVERY: async (previous) => {
            const schema = previous.API_DISCOVERY as Awaited<ReturnType<typeof discoverOpenApi>>;
            expect(schema).not.toBeNull();
            const templatedOperations = operationsFromOpenApi(schema!);
            const resolvedOperations: DiscoveredOperation[] = templatedOperations.map((op) => ({
              ...op,
              url: resolveOperationUrl(origin(), op.url, "1"),
            }));
            for (const operation of resolvedOperations) registerDiscoveredOperation(db, scanRunId, operation);
            return getDiscoveredOperations(db, scanRunId);
          },

          BUSINESS_OBJECT_STATE_DISCOVERY: async () => {
            const projectResourceUrl = `${origin()}/api/projects/1`;
            for (const objectType of recognizeObjectTypesFromUrl(projectResourceUrl)) {
              recordBusinessObject(db, scanRunId, objectType, "URL");
            }

            // The business-logic stage: a real Contest/Ticketing flow.
            const reserveResponse = await discoveryRequester.request(`${origin()}/api/contest/campaigns/1/reservations`, { method: "POST" });
            const reservation = JSON.parse(reserveResponse.body) as { id: string };
            const purchaseResponse = await discoveryRequester.request(`${origin()}/api/contest/reservations/${reservation.id}/purchase`, {
              method: "POST",
            });
            const purchase = JSON.parse(purchaseResponse.body) as { ticket: { id: string; status: string } };
            expect(purchase.ticket.status).toBe("PENDING_PAYMENT");

            recordBusinessObject(db, scanRunId, "Ticket", "JSON_FIELD");
            recordObservedState(db, scanRunId, "Ticket", purchase.ticket.status);

            return { projectResourceUrl, ticketId: purchase.ticket.id };
          },

          CANDIDATE_GENERATOR: (previous) => {
            const analyzedFields = previous.JSON_DOM_ANALYZER as AnalyzedField[];
            const { projectResourceUrl } = previous.BUSINESS_OBJECT_STATE_DISCOVERY as { projectResourceUrl: string };
            const generated = generateCandidates(analyzedFields, projectResourceUrl);
            const notesCandidate = generated.find((c) => c.fieldPath === "notes");
            expect(notesCandidate).toBeDefined();
            expect(notesCandidate?.scanner).toBe("XSS");
            return notesCandidate!;
          },

          ELIGIBILITY_CLASSIFICATION: (previous) => {
            const generatedCandidate = previous.CANDIDATE_GENERATOR as ReturnType<typeof generateCandidates>[number];
            const operations = previous.OPERATION_DISCOVERY as DiscoveredOperation[];
            const resourceKey = { targetId, origin: origin(), objectType: "project", resourceId: "1" };
            const record = insertCandidate(db, scanRunId, {
              scanner: generatedCandidate.scanner,
              fieldPath: generatedCandidate.fieldPath,
              confidence: generatedCandidate.confidence,
              priority: generatedCandidate.priority,
              resourceKey,
              resourceUrl: generatedCandidate.endpoint,
              writeMethod: "PATCH",
              operations,
              minConfidence: "MEDIUM",
              isPassiveTest: false,
              inScope: true,
              hasRequiredAuth: true,
              requiresOwnershipData: false,
              hasOwnershipData: false,
              advancedOverrideConfirmed: false,
              environmentPolicyAllows: true,
              localFixtureDenylistOverrideActive: false,
            });
            expect(record.eligibilityState).toBe("TESTABLE");
            return { record, resourceKey, resourceUrl: generatedCandidate.endpoint, fieldPath: generatedCandidate.fieldPath };
          },

          AUTHENTICATION_MAPPING: () => {
            const authProfileId = createAuthProfile(db, { name: "userA", method: "BEARER", credential: "userA-token" });
            const profile = getAuthProfile(db, authProfileId)!;
            const credential = getDecryptedCredential(db, authProfileId)!;
            return { authHeaders: buildAuthHeaders(profile.method, credential) };
          },

          SECURITY_TESTS: async (previous) => {
            const { record, resourceKey, resourceUrl, fieldPath } = previous.ELIGIBILITY_CLASSIFICATION as {
              record: { id: number; eligibilityState: string; browserTestability: string };
              resourceKey: { targetId: number; origin: string; objectType: string; resourceId: string };
              resourceUrl: string;
              fieldPath: string;
            };
            const { authHeaders } = previous.AUTHENTICATION_MAPPING as { authHeaders: Record<string, string> };
            const operations = previous.OPERATION_DISCOVERY as DiscoveredOperation[];

            const candidate: Candidate = {
              id: record.id,
              scanner: "XSS",
              resourceKey,
              resourceUrl,
              fieldPath,
              writeMethod: "PATCH",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              eligibilityState: record.eligibilityState as any,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              browserTestability: record.browserTestability as any,
            };
            const context: ScanContext = { db, scanRunId, httpClient, operations, minConfidence: "MEDIUM", authHeaders };

            const scanner = new XssScanner(httpClient);

            // First mutation on this resource.
            const firstResult = await scanner.test(context, candidate);
            const journalAfterFirst = db
              .prepare("SELECT state FROM mutation_journal WHERE resource_id = ? ORDER BY id")
              .all(resourceKey.resourceId) as { state: string }[];
            expect(journalAfterFirst[journalAfterFirst.length - 1]?.state).toBe("RESTORE_OK");

            // Second mutation on the SAME resource — must only begin after
            // the first one's restore has already completed (per-resource
            // restore-before-next-test ordering).
            const secondResult = await scanner.test(context, candidate);
            const journalAfterSecond = db
              .prepare("SELECT state FROM mutation_journal WHERE resource_id = ? ORDER BY id")
              .all(resourceKey.resourceId) as { state: string }[];

            const firstRestoreIndex = journalAfterSecond.findIndex((row, i) => row.state === "RESTORE_OK" && i === journalAfterFirst.length - 1);
            const secondBackupIndex = journalAfterSecond.findIndex((row, i) => row.state === "BACKUP_CREATED" && i >= journalAfterFirst.length);
            expect(firstRestoreIndex).toBeGreaterThanOrEqual(0);
            expect(secondBackupIndex).toBeGreaterThan(firstRestoreIndex);
            expect(journalAfterSecond[journalAfterSecond.length - 1]?.state).toBe("RESTORE_OK");

            return { firstResult, secondResult };
          },

          EVIDENCE: () => {
            const count = (db.prepare("SELECT COUNT(*) as c FROM evidence WHERE scan_run_id = ?").get(scanRunId) as { c: number }).c;
            expect(count).toBeGreaterThan(0);
            return { evidenceCount: count };
          },

          RESTORE: () => {
            // A checkpoint, not a separate execution step (design.md
            // Decision 17) — every mutating test already restored inside
            // its own cycle during Security Tests; this stage only
            // confirms no resource was left in a non-terminal state.
            const rows = db.prepare("SELECT state FROM mutation_journal WHERE resource_id = '1' ORDER BY id DESC LIMIT 1").all() as { state: string }[];
            expect(rows[0]?.state).toBe("RESTORE_OK");
            return { allResourcesRestored: true };
          },

          REPORT: () => {
            const context: GenericProfileContext = { discoveredObjectTypes: ["Project", "Ticket"] };
            const contribution = composeProfiles([GENERIC_PROFILE, createContestProfile(true)], context);
            const profileObjectTypes = buildProfileObjectTypeMap(contribution.candidates as { source: string; objectType: string }[]);
            const coverage = computeBusinessLogicCoverage({ db, scanRunId, targetId, profileObjectTypes });
            const findings = listBusinessFindings(db, scanRunId);
            return { coverage, findings };
          },
        },
      });

      // ── Strict stage-order assertion ─────────────────────────────────
      const expectedOrder: PipelineStage[] = [
        "DNS_RESOLVER",
        "SCOPE_VALIDATION",
        "HTTP_DISCOVERY",
        "CRAWLER_AND_BROWSER_RUNTIME_DISCOVERY",
        "API_DISCOVERY",
        "JSON_DOM_ANALYZER",
        "OPERATION_DISCOVERY",
        "BUSINESS_OBJECT_STATE_DISCOVERY",
        "CANDIDATE_GENERATOR",
        "ELIGIBILITY_CLASSIFICATION",
        "AUTHENTICATION_MAPPING",
        "SECURITY_TESTS",
        "EVIDENCE",
        "RESTORE",
        "REPORT",
      ];
      expect(progress.map((p) => p.stage)).toEqual(expectedOrder);
      expect(progress.every((p) => p.status === "COMPLETED")).toBe(true);

      // Every RUNNING event for a stage precedes its own COMPLETED event,
      // and every stage's COMPLETED event precedes the next stage's
      // RUNNING event — genuinely strict, non-overlapping execution.
      for (let i = 0; i < expectedOrder.length; i++) {
        const runningIdx = events.findIndex((e) => e.stage === expectedOrder[i] && e.status === "RUNNING");
        const completedIdx = events.findIndex((e) => e.stage === expectedOrder[i] && e.status === "COMPLETED");
        expect(runningIdx).toBeLessThan(completedIdx);
        if (i > 0) {
          const previousCompletedIdx = events.findIndex((e) => e.stage === expectedOrder[i - 1] && e.status === "COMPLETED");
          expect(previousCompletedIdx).toBeLessThan(runningIdx);
        }
      }

      // ── Real business-logic and browser-runtime stage content ────────
      const businessObjectStage = results.BUSINESS_OBJECT_STATE_DISCOVERY as { ticketId: string };
      expect(businessObjectStage.ticketId).toBeTruthy();
      const businessObjectRows = db.prepare("SELECT object_type FROM business_objects WHERE scan_run_id = ?").all(scanRunId) as { object_type: string }[];
      expect(businessObjectRows.map((r) => r.object_type).sort()).toEqual(["Project", "Ticket"]);

      const browserStage = results.CRAWLER_AND_BROWSER_RUNTIME_DISCOVERY as { staticResourceCount: number };
      expect(browserStage.staticResourceCount).toBeGreaterThan(0);

      // ── Report stage produced real, non-empty content ─────────────────
      const report = results.REPORT as { coverage: ReturnType<typeof computeBusinessLogicCoverage>; findings: unknown[] };
      expect(report.coverage.byProfile.length).toBeGreaterThan(0);

      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
    60_000,
  );
});
