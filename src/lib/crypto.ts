import crypto from "crypto";

// AES-256-GCM helpers for encrypting secrets (e.g. per-domain SMTP relay
// passwords) at rest. If ENCRYPTION_KEY is not set, values pass through
// unchanged so the app still works without configuration — matching the prior
// plaintext behavior of `smtp_credentials`.
//
// ENCRYPTION_KEY must be 32 bytes encoded as 64 hex chars: `openssl rand -hex 32`.

const ENC_PREFIX = "enc:v1:";

function getKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters"
    );
  }
  return key;
}

export function isEncryptionEnabled(): boolean {
  return !!process.env.ENCRYPTION_KEY;
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext; // plaintext fallback when no key configured

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return (
    ENC_PREFIX +
    [
      iv.toString("base64"),
      tag.toString("base64"),
      encrypted.toString("base64"),
    ].join(":")
  );
}

export function decryptSecret(value: string): string {
  if (!value.startsWith(ENC_PREFIX)) return value; // stored plaintext

  const key = getKey();
  if (!key) {
    throw new Error(
      "Value is encrypted but ENCRYPTION_KEY is not set; cannot decrypt"
    );
  }

  const [ivB64, tagB64, dataB64] = value.slice(ENC_PREFIX.length).split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8"
  );
}
