import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

interface EncryptedPayload {
  algorithm: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

function deriveKey(secret: string): Buffer {
  return crypto.scryptSync(secret, "monash-moodle-downloader", KEY_LENGTH);
}

export function encryptJson(data: unknown, secret: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(secret);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: encrypted.toString("base64")
  };

  return JSON.stringify(payload, null, 2);
}

export function decryptJson<T>(blobText: string, secret: string): T {
  const payload = JSON.parse(blobText) as EncryptedPayload;
  const key = deriveKey(secret);
  const decipher = crypto.createDecipheriv(
    payload.algorithm || ALGORITHM,
    key,
    Buffer.from(payload.iv, "base64")
  ) as crypto.DecipherGCM;
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}
