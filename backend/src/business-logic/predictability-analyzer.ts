/**
 * Scaffold — filled in by Section 13.12 (Predictability Analysis).
 * Classifies a legitimately-observed identifier sequence as SEQUENTIAL,
 * RANDOM_LOOKING, INSUFFICIENT_DATA, or POTENTIALLY_PREDICTABLE — never
 * attempting a cryptographic attack; a finding is only raised once
 * predictability is shown to enable actual unauthorized access.
 */
export type PredictabilityClassification = "SEQUENTIAL" | "RANDOM_LOOKING" | "INSUFFICIENT_DATA" | "POTENTIALLY_PREDICTABLE";
