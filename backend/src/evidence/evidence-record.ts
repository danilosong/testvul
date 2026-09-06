export interface EvidenceRecord {
  id: number;
  candidateId?: number;
  authProfileId?: number;
  endpoint: string;
  fieldPath: string;
  requestSanitized: unknown;
  responseSanitized: unknown;
  originalValueSanitized: unknown;
  testValueSanitized: unknown;
  verificationOutcome: string;
  restoreStatus?: string;
  truncated: boolean;
  originalSize?: number;
  contentHash?: string;
  createdAt: string;
}
