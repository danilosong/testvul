export interface ObservedPropertyInput {
  scanRunId: number;
  objectType: string;
  propertyOrAction: string;
  observedValue: unknown;
  evidenceId?: number;
}

export interface ObservedProperty extends ObservedPropertyInput {
  id: number;
  createdAt: string;
}
