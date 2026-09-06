import type { RestoreRequester } from "../../restore/restore-engine";

export type ReadIdorOutcome = "POTENTIAL_BOLA" | "PROTECTED" | "NO_FINDING";

export interface ReadIdorTestParams {
  requester: RestoreRequester;
  resourceUrl: string;
  /** The field in the response body expected to hold the resource's own id. */
  resourceIdFieldPath: string;
  expectedResourceId: string;
  /** The field in the response body expected to hold the resource's owner identifier. */
  ownerFieldPath: string;
  /** The resource's real, known owner (from `resource_ownership`) — what a leaked response must actually match. */
  expectedOwnerId: string;
}

export interface ReadIdorTestResult {
  outcome: ReadIdorOutcome;
  status: number;
}

/**
 * The Read IDOR test with positive content confirmation (design.md
 * Decision 21): a 200 status alone is never sufficient. 403/404 is the
 * expected, protected outcome. On 200, the response body must positively
 * confirm it actually is the *other* profile's resource — both its own
 * resource id and its known owner id must match — before a Potential BOLA
 * finding is raised. A 200 whose body doesn't yield a matching identity
 * (a generic error, an empty object, an unrelated resource such as the
 * caller's own data) produces no finding.
 */
export async function runReadIdorTest(params: ReadIdorTestParams): Promise<ReadIdorTestResult> {
  const response = await params.requester.request(params.resourceUrl);

  if (response.status === 403 || response.status === 404) {
    return { outcome: "PROTECTED", status: response.status };
  }
  if (response.status !== 200) {
    return { outcome: "NO_FINDING", status: response.status };
  }

  let body: unknown;
  try {
    body = JSON.parse(response.body);
  } catch {
    return { outcome: "NO_FINDING", status: response.status };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { outcome: "NO_FINDING", status: response.status };
  }

  const record = body as Record<string, unknown>;
  const resourceIdMatches = String(record[params.resourceIdFieldPath]) === params.expectedResourceId;
  const ownerMatches = String(record[params.ownerFieldPath]) === params.expectedOwnerId;

  if (resourceIdMatches && ownerMatches) {
    return { outcome: "POTENTIAL_BOLA", status: response.status };
  }
  return { outcome: "NO_FINDING", status: response.status };
}
