import type { Db } from "../db/connection";
import type { ScanMode } from "../scan-orchestration/scan-mode-gate";
import { ScopeValidator } from "../scope";
import { normalizeHostname } from "./hostname-normalization";
import { computeAllowedScope, type AllowedScopeOptions } from "./allowed-scope";
import { createTarget, type TargetInput } from "./targets-repository";
import type { TargetEnvironmentClassification } from "../mutation/scan-run-environment";

/**
 * The "New Security Audit" creation form/API (Section 16.1): Project
 * Name, Target DNS, Scope, Authentication, Scan Mode, Rate Limit.
 * Required-field validation happens before any row is ever written —
 * there is no code path here that persists a target missing its name or
 * hostname.
 */
export interface NewSecurityAuditInput {
  projectName?: string;
  targetDns?: string;
  /** "Include authorized subdomains" (Section 16.3) — ignored when `advancedScope` is also supplied. */
  includeSubdomains?: boolean;
  /** "Advanced Scope" (Section 16.3) — an explicit override that always wins over both the default and the subdomains checkbox. */
  advancedScope?: string[];
  scanMode?: ScanMode;
  rateLimitRps?: number;
  environment?: TargetEnvironmentClassification;
}

export type NewSecurityAuditValidationError = "MISSING_PROJECT_NAME" | "MISSING_TARGET_DNS" | "TARGET_NOT_IN_SCOPE" | "INVALID_ENVIRONMENT";

const TARGET_ENVIRONMENTS = new Set<TargetEnvironmentClassification>(["LOCAL_FIXTURE", "DEVELOPMENT", "STAGING", "PRODUCTION"]);

function scopeOptionsFor(input: NewSecurityAuditInput): AllowedScopeOptions {
  const options: AllowedScopeOptions = {};
  if (input.includeSubdomains !== undefined) options.includeSubdomains = input.includeSubdomains;
  if (input.advancedScope !== undefined) options.advancedScope = input.advancedScope;
  return options;
}

/**
 * Required-field validation plus Target-Must-Be-Within-Scope (Section
 * 16.4) — independent of the later, per-scan OUT_OF_SCOPE handling for
 * hosts *discovered during* a scan (Section 2/14.4): this check is purely
 * about whether the operator's own configured scope even covers the
 * Target DNS they just typed in, at creation time.
 */
export function validateNewSecurityAuditInput(input: NewSecurityAuditInput): NewSecurityAuditValidationError[] {
  const errors: NewSecurityAuditValidationError[] = [];
  if (!input.projectName || input.projectName.trim() === "") errors.push("MISSING_PROJECT_NAME");
  if (input.environment !== undefined && !TARGET_ENVIRONMENTS.has(input.environment)) errors.push("INVALID_ENVIRONMENT");

  if (!input.targetDns || input.targetDns.trim() === "") {
    errors.push("MISSING_TARGET_DNS");
    return errors; // nothing further to check without a hostname
  }

  let hostname: string;
  try {
    hostname = normalizeHostname(input.targetDns);
  } catch {
    errors.push("MISSING_TARGET_DNS");
    return errors;
  }

  const scope = computeAllowedScope(hostname, scopeOptionsFor(input));
  const scopeValidator = new ScopeValidator(scope);
  if (!scopeValidator.isInScope(`https://${hostname}/`)) errors.push("TARGET_NOT_IN_SCOPE");

  return errors;
}

export class InvalidNewSecurityAuditInputError extends Error {
  constructor(public readonly errors: readonly NewSecurityAuditValidationError[]) {
    super(`New Security Audit input is invalid: ${errors.join(", ")}`);
    this.name = "InvalidNewSecurityAuditInputError";
  }
}

/** Creates the Target this "New Security Audit" describes — rejects (never partially persists) when required-field or Target-Must-Be-Within-Scope validation fails. */
export function createNewSecurityAudit(db: Db, input: NewSecurityAuditInput): number {
  const errors = validateNewSecurityAuditInput(input);
  if (errors.length > 0) throw new InvalidNewSecurityAuditInputError(errors);

  // Section 16.2: accepts scheme-less input ("api.example.com"), a full
  // URL, or a trailing-dotted hostname — the persisted Target DNS is
  // always just the bare, normalized hostname.
  const hostname = normalizeHostname(input.targetDns!);

  const targetInput: TargetInput = {
    name: input.projectName!,
    hostname,
    scope: computeAllowedScope(hostname, scopeOptionsFor(input)),
  };
  if (input.scanMode !== undefined) targetInput.defaultScanMode = input.scanMode;
  if (input.rateLimitRps !== undefined) targetInput.rateLimitRps = input.rateLimitRps;
  if (input.environment !== undefined) targetInput.environment = input.environment;
  return createTarget(db, targetInput);
}
