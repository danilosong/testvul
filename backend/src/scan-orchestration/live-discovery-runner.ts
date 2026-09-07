import { analyzeFields } from "../analysis/field-analyzer";
import { classifyField } from "../analysis/field-classifier";
import { generateCandidates, type GeneratedCandidate } from "../analysis/candidate-generator";
import { discoverOpenApi, KNOWN_OPENAPI_PATHS } from "../api-discovery/openapi-discovery";
import { crawl } from "../crawler/crawler";
import { extractFromHtml } from "../crawler/html-extractor";
import type { Db } from "../db/connection";
import type { DiscoveredResource } from "../discovery/attack-surface";
import { recordDiscoveredEndpoint, recordDiscoveredEndpoints } from "../discovery/discovered-endpoints-repository";
import { recordDiscoveredField } from "../discovery/discovered-fields-repository";
import { discoverRoot } from "../discovery/http-discovery";
import { probeProtocols } from "../discovery/protocol-prober";
import { resolveDns } from "../dns/resolver";
import { sanitizeEvidence } from "../evidence/sanitize-evidence";
import { SecurityHttpClient } from "../http/security-http-client";
import { HostRateLimiter } from "../http/rate-limiter";
import { operationsFromOpenApi } from "../operation-discovery/openapi-operations";
import { registerDiscoveredOperation } from "../operation-discovery/discovered-operations-repository";
import type { DiscoveredOperation } from "../operation-discovery/discovered-operation";
import { ScopeValidator } from "../scope";
import { getTarget } from "../target-configuration/targets-repository";
import { isCancellationRequested } from "./scan-cancellation";
import { runPipelineWithAuditTrail } from "./scan-lifecycle-audit";
import type { PipelineRunResult, PipelineStage, PipelineStageRunner } from "./pipeline-sequencer";
import { getScanRunConfigSnapshot } from "./scan-run-config-snapshot";
import { finalizeScanRun } from "./scan-run-state-machine";

/**
 * The real, automatic Discovery-only pipeline driver for a live (non-fixture,
 * arbitrary-operator-supplied) target: every stage runner here uses the
 * actual DNS/HTTP/crawler/OpenAPI/field-analysis primitives against the
 * real network, instead of the hand-authored stage runners every Section 18
 * E2E test builds against the local fixture. Mutation-testing stages
 * (SECURITY_TESTS/EVIDENCE/RESTORE) are intentionally left unautomated for
 * a live, unknown target — there is no curated Resource Ownership/candidate
 * data to safely dispatch a scanner against — and instead report a clear
 * "not automated for this pass" result rather than staying silently
 * PENDING forever.
 */
export class ScanCancelledError extends Error {
  constructor() {
    super("Scan cancelled before this stage started");
    this.name = "ScanCancelledError";
  }
}

function assertNotCancelled(db: Db, scanRunId: number): void {
  if (isCancellationRequested(db, scanRunId)) throw new ScanCancelledError();
}

export interface RunLiveDiscoveryScanOptions {
  /** Test-only seam: skip DNS/protocol probing and crawl this origin directly (e.g. the fixture app's dynamic-port URL, which a bare hostname can never express). */
  baseUrlOverride?: string;
  maxDepth?: number;
  maxPages?: number;
}

export async function runLiveDiscoveryScan(db: Db, scanRunId: number, options: RunLiveDiscoveryScanOptions = {}): Promise<PipelineRunResult> {
  const config = getScanRunConfigSnapshot(db, scanRunId);
  const target = getTarget(db, config.targetId);
  if (!target) throw new Error(`No target found with id ${config.targetId}`);

  const scopeValidator = new ScopeValidator(config.scope);
  const client = new SecurityHttpClient({
    scopeValidator,
    allowPrivateNetworks: config.allowPrivateNetworks,
    rateLimiter: new HostRateLimiter({ requestsPerSecond: config.rateLimitRps }),
  });

  const persistedEndpointIdByUrl = new Map<string, number>();
  let analyzedFieldTotal: ReturnType<typeof analyzeFields> = [];
  let generatedCandidates: GeneratedCandidate[] = [];
  let crawlTruncated = false;

  db.prepare("UPDATE scan_runs SET state = 'RUNNING' WHERE id = ?").run(scanRunId);

  const stageRunners: Partial<Record<PipelineStage, PipelineStageRunner>> = {
    DNS_RESOLVER: async () => {
      assertNotCancelled(db, scanRunId);
      const result = await resolveDns(target.hostname);
      return sanitizeEvidence(result);
    },

    SCOPE_VALIDATION: async () => {
      assertNotCancelled(db, scanRunId);
      const inScope = scopeValidator.isInScope(`https://${target.hostname}/`);
      if (!inScope) throw new Error(`Target hostname ${target.hostname} is unexpectedly outside its own scan run's scope`);
      return { inScope, scope: config.scope };
    },

    HTTP_DISCOVERY: async () => {
      assertNotCancelled(db, scanRunId);
      const baseUrl = options.baseUrlOverride ?? `https://${target.hostname}/`;
      const protocolProbe = options.baseUrlOverride ? undefined : await probeProtocols(client, target.hostname);
      const rootUrl = options.baseUrlOverride ?? (protocolProbe?.primaryScheme === "http" ? `http://${target.hostname}/` : baseUrl);
      const discovery = await discoverRoot(client, rootUrl);
      recordDiscoveredEndpoint(db, scanRunId, { url: rootUrl, method: "GET", isPage: true, ...(discovery.contentType !== undefined ? { contentType: discovery.contentType } : {}) }, "STATIC");
      return sanitizeEvidence({ protocolProbe, status: discovery.status, contentType: discovery.contentType, server: discovery.server, redirectChain: discovery.redirectChain, finalUrl: discovery.finalUrl });
    },

    CRAWLER_AND_BROWSER_RUNTIME_DISCOVERY: async (previous) => {
      assertNotCancelled(db, scanRunId);
      const http = previous.HTTP_DISCOVERY as { finalUrl?: string } | undefined;
      const startUrl = options.baseUrlOverride ?? http?.finalUrl ?? `https://${target.hostname}/`;
      const { pages, truncated } = await crawl(startUrl, {
        client,
        extractLinks: (html, baseUrl) => extractFromHtml(html, baseUrl).links,
        ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
        ...(options.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
      });
      crawlTruncated = truncated;

      const resources: DiscoveredResource[] = [];
      const forms: { url: string; method: string }[] = [];
      const seen = new Set<string>();
      for (const page of pages) {
        resources.push({ url: page.url, method: "GET", contentType: "text/html", isPage: true });
        const extracted = extractFromHtml(page.html, page.url);
        for (const link of extracted.links) {
          if (seen.has(link)) continue;
          seen.add(link);
          resources.push({ url: link, method: "GET" });
        }
        for (const script of extracted.scripts) {
          if (seen.has(script)) continue;
          seen.add(script);
          resources.push({ url: script, method: "GET", contentType: "application/javascript" });
        }
        for (const form of extracted.forms) {
          resources.push({ url: form.action, method: form.method, isForm: true });
          forms.push({ url: form.action, method: form.method });
        }
      }
      recordDiscoveredEndpoints(db, scanRunId, resources, "STATIC");
      return { pagesVisited: pages.length, resourcesFound: resources.length, truncated, forms, browserRuntime: { skipped: true, reason: "browser-runtime discovery is not run for a live discovery-only pass" } };
    },

    API_DISCOVERY: async (previous) => {
      assertNotCancelled(db, scanRunId);
      const http = previous.HTTP_DISCOVERY as { finalUrl?: string } | undefined;
      const baseUrl = options.baseUrlOverride ?? http?.finalUrl ?? `https://${target.hostname}/`;
      const schema = await discoverOpenApi(client, baseUrl);
      if (!schema) return { found: false, checkedPaths: KNOWN_OPENAPI_PATHS, operations: [] as DiscoveredOperation[], templatedPathsSeen: [] as string[] };

      const templated = operationsFromOpenApi(schema);
      const isTemplatePath = (url: string) => /\{[^}]+\}/.test(url);
      // A templated path (e.g. "/api/projects/{id}") documents a *shape*,
      // not a concrete resource — resolving it would require guessing a
      // resource id, which this codebase never does automatically. Only
      // concrete (parameter-free) paths become real, fetchable operations.
      const operations = templated
        .filter((operation) => !isTemplatePath(operation.url))
        .map((operation) => ({ ...operation, url: new URL(operation.url, baseUrl).toString() }));
      const templatedPathsSeen = [...new Set(templated.filter((operation) => isTemplatePath(operation.url)).map((operation) => operation.url))];

      for (const operation of operations) {
        registerDiscoveredOperation(db, scanRunId, operation);
        const endpointId = recordDiscoveredEndpoint(db, scanRunId, { url: operation.url, method: operation.method }, "OPENAPI");
        persistedEndpointIdByUrl.set(`${operation.method} ${operation.url}`, endpointId);
      }
      return { found: true, operationCount: operations.length, operations, templatedPathsSeen };
    },

    JSON_DOM_ANALYZER: async (previous) => {
      assertNotCancelled(db, scanRunId);
      const apiDiscovery = previous.API_DISCOVERY as { found: boolean; templatedPathsSeen?: string[] } | undefined;
      if (!apiDiscovery?.found) {
        return { analyzedFieldCount: 0, note: "no OpenAPI document was found in this pass; arbitrary crawled-link JSON guessing is out of scope for automatic live discovery" };
      }

      const operations = (previous.API_DISCOVERY as { operations?: DiscoveredOperation[] }).operations ?? [];
      const getOperations = operations.filter((op) => op.method.toUpperCase() === "GET");
      const fields: { endpointId?: number; fieldPath: string; classification: string; sample?: string }[] = [];
      const note =
        getOperations.length === 0 && (apiDiscovery.templatedPathsSeen?.length ?? 0) > 0
          ? "every documented GET operation required a resource id this pass never guesses; no field analysis was possible"
          : undefined;

      for (const operation of getOperations) {
        assertNotCancelled(db, scanRunId);
        try {
          const response = await client.request(operation.url);
          const body = JSON.parse(response.body) as unknown;
          const analyzed = analyzeFields(body);
          analyzedFieldTotal = analyzedFieldTotal.concat(analyzed);
          const endpointId = persistedEndpointIdByUrl.get(`GET ${operation.url}`);
          for (const field of analyzed) {
            const classification = classifyField(field.path, field.value);
            const sample = sanitizeEvidence(String(field.value)).slice(0, 200);
            recordDiscoveredField(db, scanRunId, endpointId, field.path, classification, sample);
            fields.push({ fieldPath: field.path, classification, sample, ...(endpointId !== undefined ? { endpointId } : {}) });
          }
        } catch {
          // A single endpoint's body not being parseable JSON (or unreachable) never aborts the rest of the pass.
        }
      }
      return { analyzedFieldCount: fields.length, fields: sanitizeEvidence(fields), ...(note !== undefined ? { note } : {}) };
    },

    OPERATION_DISCOVERY: async (previous) => {
      assertNotCancelled(db, scanRunId);
      const crawlerResult = previous.CRAWLER_AND_BROWSER_RUNTIME_DISCOVERY as { forms?: { url: string; method: string }[] } | undefined;
      const apiDiscovery = previous.API_DISCOVERY as { operations?: DiscoveredOperation[] } | undefined;
      const formOperations: DiscoveredOperation[] = (crawlerResult?.forms ?? []).map((form) => ({
        method: form.method.toUpperCase(),
        url: form.url,
        source: "HTML_FORM",
        confidence: "LOW",
      }));
      for (const operation of formOperations) registerDiscoveredOperation(db, scanRunId, operation);
      return { operations: [...(apiDiscovery?.operations ?? []), ...formOperations] };
    },

    BUSINESS_OBJECT_STATE_DISCOVERY: async () => ({ skipped: true, reason: "business-logic profiles are not evaluated for a live discovery-only target" }),

    CANDIDATE_GENERATOR: async (previous) => {
      const jsonAnalysis = previous.JSON_DOM_ANALYZER as { fields?: { endpointId?: number }[] } | undefined;
      const baseUrl = options.baseUrlOverride ?? `https://${target.hostname}/`;
      generatedCandidates = generateCandidates(analyzedFieldTotal, baseUrl);
      void jsonAnalysis;
      return { candidateCount: generatedCandidates.length, candidates: sanitizeEvidence(generatedCandidates) };
    },

    ELIGIBILITY_CLASSIFICATION: async () => ({ skipped: true, reason: "no mutation-test eligibility is computed automatically for a live target — configure Resource Ownership/Test Resource Scope and use manual/targeted testing" }),

    AUTHENTICATION_MAPPING: async () => ({ skipped: true, reason: "no security tests run in this pass, so authentication mapping was not applied" }),

    SECURITY_TESTS: async () => ({
      skipped: true,
      reason:
        config.scanMode === "PASSIVE"
          ? "Passive mode: no mutating or scanner test is ever executed, by definition"
          : "automatic dispatch of mutation-testing scanners (XSS/GTM/IDOR) against a live, unknown target is not yet implemented — use manual/targeted testing",
    }),

    EVIDENCE: async () => ({ skipped: true, reason: "no mutation test ran in this pass, so there is no test-specific evidence to collect" }),

    RESTORE: async () => ({ skipped: true, reason: "no mutation was performed in this pass" }),

    REPORT: async () => ({ ready: true }),
  };

  try {
    const result = await runPipelineWithAuditTrail(db, scanRunId, { stageRunners });
    finalizeScanRun(db, scanRunId, { cancellationRequestedAndCleanlyCompleted: false, unrecoverableErrorOccurred: false, anyQueueTruncated: crawlTruncated });
    return result;
  } catch (err) {
    if (err instanceof ScanCancelledError) {
      finalizeScanRun(db, scanRunId, { cancellationRequestedAndCleanlyCompleted: true, unrecoverableErrorOccurred: false, anyQueueTruncated: crawlTruncated });
      return { results: {}, progress: [] };
    }
    finalizeScanRun(db, scanRunId, { cancellationRequestedAndCleanlyCompleted: false, unrecoverableErrorOccurred: true, anyQueueTruncated: crawlTruncated });
    throw err;
  }
}
