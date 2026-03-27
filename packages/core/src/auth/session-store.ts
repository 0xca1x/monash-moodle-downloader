import fs from "node:fs";
import type { BrowserContextOptions } from "playwright";
import { SESSION_STORAGE_VERSION } from "@monash-moodle-downloader/shared";

import { SESSION_BLOB_PATH, SESSION_DIR, SESSION_META_PATH } from "../config.js";
import { decryptJson, encryptJson } from "./session-crypto.js";

export interface SessionPayload {
  savedAt: string;
  courseUrl: string;
  storageState: BrowserContextOptions["storageState"];
}

export interface SessionMeta {
  savedAt: string;
  courseUrl: string;
  encrypted: boolean;
  storageStateVersion: number;
}

export interface SessionStatus {
  exists: boolean;
  encrypted: boolean;
  savedAt: string | null;
  courseUrl: string | null;
  sessionDir: string;
  blobPath: string;
  metaPath: string;
}

interface SaveSessionOptions {
  allowPlaintext?: boolean;
}

function ensureSessionDir(): void {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

export function getSessionSecret(): string {
  return process.env.MONASH_SESSION_SECRET || "";
}

export function saveSession(
  payload: SessionPayload,
  options: SaveSessionOptions = {}
): { encrypted: boolean; metaPath: string; blobPath: string } {
  const allowPlaintext = options.allowPlaintext === true;
  const secret = getSessionSecret();
  const encrypted = Boolean(secret) && !allowPlaintext;

  if (!encrypted && !allowPlaintext) {
    throw new Error(
      "Missing MONASH_SESSION_SECRET. Refusing to save cookies/session in plaintext. Set the secret in .env or pass --allow-plaintext-session."
    );
  }

  ensureSessionDir();
  const meta: SessionMeta = {
    savedAt: payload.savedAt,
    courseUrl: payload.courseUrl,
    encrypted,
    storageStateVersion: SESSION_STORAGE_VERSION
  };

  const blobText = encrypted ? encryptJson(payload, secret) : JSON.stringify(payload, null, 2);
  fs.writeFileSync(SESSION_BLOB_PATH, blobText, "utf8");
  fs.writeFileSync(SESSION_META_PATH, JSON.stringify(meta, null, 2), "utf8");
  return { encrypted, metaPath: SESSION_META_PATH, blobPath: SESSION_BLOB_PATH };
}

export function loadSession(): { meta: SessionMeta; payload: SessionPayload } | null {
  if (!fs.existsSync(SESSION_BLOB_PATH)) {
    return null;
  }

  const meta = fs.existsSync(SESSION_META_PATH)
    ? (JSON.parse(fs.readFileSync(SESSION_META_PATH, "utf8")) as SessionMeta)
    : ({ encrypted: false } as SessionMeta);
  const blobText = fs.readFileSync(SESSION_BLOB_PATH, "utf8");

  if (meta.encrypted) {
    const secret = getSessionSecret();
    if (!secret) {
      throw new Error("Session is encrypted. Set MONASH_SESSION_SECRET before reading it.");
    }
    return { meta, payload: decryptJson<SessionPayload>(blobText, secret) };
  }

  return { meta, payload: JSON.parse(blobText) as SessionPayload };
}

export function clearSession(): string[] {
  const removed: string[] = [];
  for (const filePath of [SESSION_BLOB_PATH, SESSION_META_PATH]) {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
      removed.push(filePath);
    }
  }
  return removed;
}

export function getSessionStatus(): SessionStatus {
  const hasBlob = fs.existsSync(SESSION_BLOB_PATH);
  const meta = fs.existsSync(SESSION_META_PATH)
    ? (JSON.parse(fs.readFileSync(SESSION_META_PATH, "utf8")) as Partial<SessionMeta>)
    : null;

  return {
    exists: hasBlob,
    encrypted: Boolean(meta?.encrypted),
    savedAt: meta?.savedAt ?? null,
    courseUrl: meta?.courseUrl ?? null,
    sessionDir: SESSION_DIR,
    blobPath: SESSION_BLOB_PATH,
    metaPath: SESSION_META_PATH
  };
}
