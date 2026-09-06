export type AuthMethod = "BEARER" | "COOKIE" | "API_KEY" | "CUSTOM_HEADERS";

export interface AuthProfileInput {
  name: string;
  method: AuthMethod;
  /** Plaintext — only ever held in memory here; the repository encrypts it before it touches disk. */
  credential?: string;
  browserAuthLoginUrl?: string;
  browserAuthSelectors?: Record<string, string>;
}

export interface AuthProfile {
  id: number;
  name: string;
  method: AuthMethod;
  hasCredential: boolean;
  browserAuthLoginUrl?: string;
  browserAuthSelectors?: Record<string, string>;
}
