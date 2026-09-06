import type { BrowserContext, Page, Route } from "playwright";
import type { Db } from "../db/connection";
import type { ScopeValidator } from "../scope";
import { registerDiscoveredOperation } from "../operation-discovery/discovered-operations-repository";
import { sanitizeEvidence } from "../evidence/sanitize-evidence";
import { isInScope } from "./origin-scope-guard";

const NON_CAPTURE_METHODS = new Set(["GET", "HEAD"]);

export interface CapturedMutatingRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

export type DryRunOutcome =
  | { status: "CAPTURED"; request: CapturedMutatingRequest }
  | { status: "DRY_RUN_AMBIGUOUS"; requests: CapturedMutatingRequest[] }
  | { status: "DRY_RUN_UNAVAILABLE" };

export interface RunDryRunCaptureParams {
  /** A disposable context — sharing the authenticated session's cookies/storage but never the primary context/page — so a Dry-Run attempt can never leave a side effect the primary verification session would see. */
  context: BrowserContext;
  pageUrl: string;
  actionSelector: string;
  scopeValidator: ScopeValidator;
  /** Set false only to simulate the case where interception genuinely could not be installed reliably before the action's request(s) fire — never a real production toggle. */
  interceptionInstallable?: boolean;
  /** Runs after navigation but before the action is clicked — for a caller that needs to set up the page first (e.g. a test injecting a control to click). Never used to weaken interception, which is already installed by the time this runs. */
  beforeAction?: (page: Page) => Promise<void>;
}

/**
 * Browser Dry-Run Request Capture (design.md Decision 38): before ever
 * executing a SAFE_MUTATION action for real, installs a blanket
 * interception barrier over every in-scope, non-GET/HEAD request the
 * page could produce — not one guessed URL — executes the action, and
 * aborts every intercepted mutating request before any of it reaches the
 * backend. Exactly one distinct captured request is a clean CAPTURED
 * result (registered as a `BROWSER_DRY_RUN` `DiscoveredOperation`); more
 * than one distinct mutating request with no confident primary is
 * DRY_RUN_AMBIGUOUS, and none of them are ever registered or sent; and
 * when interception itself could not be reliably installed before
 * dispatch, the result is DRY_RUN_UNAVAILABLE — the action is never
 * executed for real merely to learn its shape. The page this runs
 * against is always discarded afterward.
 */
export async function runDryRunCapture(params: RunDryRunCaptureParams): Promise<DryRunOutcome> {
  if (params.interceptionInstallable === false) {
    return { status: "DRY_RUN_UNAVAILABLE" };
  }

  const page = await params.context.newPage();
  const captured: CapturedMutatingRequest[] = [];

  await page.route("**/*", async (route: Route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (NON_CAPTURE_METHODS.has(method) || !isInScope(request.url(), params.scopeValidator)) {
      await route.continue();
      return;
    }
    captured.push({
      method,
      url: request.url(),
      headers: sanitizeEvidence(request.headers()),
      body: request.postData(),
    });
    await route.abort("aborted");
  });

  await page.goto(params.pageUrl);
  if (params.beforeAction) await params.beforeAction(page);
  await page.click(params.actionSelector);
  await page.waitForTimeout(300); // lets any additional fire-and-forget requests the action produces arrive

  // Always discarded — never reused for the primary verification session.
  await page.close();

  if (captured.length === 0) return { status: "DRY_RUN_UNAVAILABLE" };

  const distinctKeys = new Set(captured.map((c) => `${c.method} ${c.url}`));
  if (distinctKeys.size === 1) return { status: "CAPTURED", request: captured[0]! };
  return { status: "DRY_RUN_AMBIGUOUS", requests: captured };
}

/** Registers a clean CAPTURED outcome as a `BROWSER_DRY_RUN`-sourced `DiscoveredOperation` (Section 7.7's registration path) — a no-op for any other outcome, so an ambiguous or unavailable Dry-Run never registers or sends anything. */
export function registerDryRunOperation(db: Db, scanRunId: number, outcome: DryRunOutcome): void {
  if (outcome.status !== "CAPTURED") return;
  registerDiscoveredOperation(db, scanRunId, {
    method: outcome.request.method,
    url: outcome.request.url,
    source: "BROWSER_DRY_RUN",
    confidence: "HIGH",
    requestSchema: { headers: outcome.request.headers, body: outcome.request.body },
  });
}
