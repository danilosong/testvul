import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // 96-bit nonce, the standard/recommended size for GCM
const KEY_ENV_VAR = "AUTH_CREDENTIAL_ENCRYPTION_KEY";

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super(`${KEY_ENV_VAR} is not configured — refusing to store or read a credential without it`);
    this.name = "MissingEncryptionKeyError";
  }
}

export class InvalidEncryptionKeyError extends Error {
  constructor() {
    super(`${KEY_ENV_VAR} must decode (base64) to exactly 32 bytes for AES-256-GCM`);
    this.name = "InvalidEncryptionKeyError";
  }
}

export interface EncryptedCredential {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

/** No default, no hardcoded fallback — an unconfigured key fails closed. */
function getKey(env: NodeJS.ProcessEnv): Buffer {
  const raw = env[KEY_ENV_VAR];
  if (!raw) throw new MissingEncryptionKeyError();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new InvalidEncryptionKeyError();
  return key;
}

export function encryptCredential(plaintext: string, env: NodeJS.ProcessEnv = process.env): EncryptedCredential {
  const key = getKey(env);
  const iv = randomBytes(IV_LENGTH_BYTES); // unique per encryption
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

/** Throws if the authentication tag doesn't verify — a tampered ciphertext
 * or IV/tag never silently decrypts to the wrong (or garbage) plaintext. */
export function decryptCredential(encrypted: EncryptedCredential, env: NodeJS.ProcessEnv = process.env): string {
  const key = getKey(env);
  const decipher = createDecipheriv(ALGORITHM, key, encrypted.iv);
  decipher.setAuthTag(encrypted.tag);
  const plaintext = Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
