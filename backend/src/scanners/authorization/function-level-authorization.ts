import type { Page } from "playwright";

export type FunctionLevelAuthorizationResult = "POTENTIAL_BROKEN_FLA" | "NO_FINDING";

/**
 * A 200 status alone is never sufficient (design.md, Section 12.22):
 * function-level authorization checks (e.g. a direct navigation to
 * `/admin`) must confirm genuine restricted content or operations were
 * actually delivered before flagging Potential Broken Function-Level
 * Authorization. A page that merely loads (200) but renders no real
 * restricted content — an access-denied message, an empty shell — is not
 * a finding.
 */
export function classifyFunctionLevelAuthorization(status: number, containsGenuineRestrictedContent: boolean): FunctionLevelAuthorizationResult {
  if (status !== 200) return "NO_FINDING";
  return containsGenuineRestrictedContent ? "POTENTIAL_BROKEN_FLA" : "NO_FINDING";
}

export interface FunctionLevelAuthorizationCheckParams {
  page: Page;
  url: string;
  /** A pattern only genuine restricted content would ever produce (e.g. a marker specific to the real payload) — never just "the page loaded successfully". */
  restrictedContentPattern: RegExp;
}

/**
 * Browser-assisted function-level authorization check: navigates directly
 * to a URL (e.g. `/admin`, bypassing any UI-level navigation — per
 * Section 12.21, absence of a UI path there is irrelevant) and confirms
 * genuine restricted content was actually rendered before classifying a
 * finding, read-only, never itself mutating anything.
 */
export async function checkFunctionLevelAuthorization(params: FunctionLevelAuthorizationCheckParams): Promise<FunctionLevelAuthorizationResult> {
  const response = await params.page.goto(params.url);
  const status = response?.status() ?? 0;
  const bodyText = (await params.page.textContent("body")) ?? "";
  const containsGenuineContent = params.restrictedContentPattern.test(bodyText);
  return classifyFunctionLevelAuthorization(status, containsGenuineContent);
}
