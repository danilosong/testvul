export { ScopeValidator, ScopeViolationError } from "./scope-validator";
export { canonicalizeUrl, UnsupportedSchemeError } from "./canonicalize";
export { isBlockedIp, type IpValidationOptions } from "./ip-validator";
export {
  issueValidatedRequest,
  validateHop,
  stripSensitiveHeaders,
  REDIRECT_STATUSES,
  type IssueValidatedRequestOptions,
  type ValidatedRequestResult,
  type HopRecord,
  type HopValidation,
  type BlockReason,
  type DnsLookupFn,
} from "./validated-request";

// Deliberately NOT exported: validated-request.ts's internal `performRequest`
// (the only function in this module that actually opens a socket). It has
// no bypass path here — see index.test.ts's non-reachability assertion.
