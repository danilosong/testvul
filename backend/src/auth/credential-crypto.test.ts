import { describe, expect, it } from "vitest";
import { encryptCredential, decryptCredential, MissingEncryptionKeyError, InvalidEncryptionKeyError } from "./credential-crypto";

const TEST_KEY_ENV = { AUTH_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") } as NodeJS.ProcessEnv;

describe("encryptCredential / decryptCredential", () => {
  it("round-trips a plaintext credential", () => {
    const encrypted = encryptCredential("super-secret-token", TEST_KEY_ENV);
    expect(decryptCredential(encrypted, TEST_KEY_ENV)).toBe("super-secret-token");
  });

  it("uses a unique IV/nonce for every encryption, even of the same plaintext", () => {
    const a = encryptCredential("same-value", TEST_KEY_ENV);
    const b = encryptCredential("same-value", TEST_KEY_ENV);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("fails closed when no key is configured", () => {
    expect(() => encryptCredential("x", {})).toThrow(MissingEncryptionKeyError);
    expect(() => decryptCredential({ ciphertext: Buffer.alloc(0), iv: Buffer.alloc(12), tag: Buffer.alloc(16) }, {})).toThrow(
      MissingEncryptionKeyError,
    );
  });

  it("rejects a key that doesn't decode to exactly 32 bytes", () => {
    const shortKeyEnv = { AUTH_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") } as NodeJS.ProcessEnv;
    expect(() => encryptCredential("x", shortKeyEnv)).toThrow(InvalidEncryptionKeyError);
  });

  it("fails to decrypt a tampered ciphertext", () => {
    const encrypted = encryptCredential("secret", TEST_KEY_ENV);
    const tampered = { ...encrypted, ciphertext: Buffer.from(encrypted.ciphertext) };
    tampered.ciphertext[0] = tampered.ciphertext[0]! ^ 0xff;
    expect(() => decryptCredential(tampered, TEST_KEY_ENV)).toThrow();
  });

  it("fails to decrypt when the authentication tag has been tampered with", () => {
    const encrypted = encryptCredential("secret", TEST_KEY_ENV);
    const tampered = { ...encrypted, tag: Buffer.from(encrypted.tag) };
    tampered.tag[0] = tampered.tag[0]! ^ 0xff;
    expect(() => decryptCredential(tampered, TEST_KEY_ENV)).toThrow();
  });

  it("fails to decrypt with the wrong key", () => {
    const encrypted = encryptCredential("secret", TEST_KEY_ENV);
    const wrongKeyEnv = { AUTH_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") } as NodeJS.ProcessEnv;
    expect(() => decryptCredential(encrypted, wrongKeyEnv)).toThrow();
  });
});
