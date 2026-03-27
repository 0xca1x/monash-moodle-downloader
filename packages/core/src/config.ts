import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MONASH_BASE_URL,
  DEFAULT_PANOPTO_BASE_URL
} from "@monash-moodle-downloader/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findRepoRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    const workspaceFile = path.join(current, "pnpm-workspace.yaml");
    const packageFile = path.join(current, "package.json");
    if (fs.existsSync(workspaceFile) && fs.existsSync(packageFile)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
}

export const REPO_ROOT = findRepoRoot(__dirname);
export const SESSION_DIR = path.join(REPO_ROOT, ".session");
export const SESSION_META_PATH = path.join(SESSION_DIR, "moodle-session.meta.json");
export const SESSION_BLOB_PATH = path.join(SESSION_DIR, "moodle-session.blob");
export const ENV_PATH = path.join(REPO_ROOT, ".env");
export const DOWNLOADS_DIR = path.join(REPO_ROOT, "downloads");
export const DEFAULT_COURSE_URL = DEFAULT_MONASH_BASE_URL;
export const DEFAULT_PANOPTO_URL = DEFAULT_PANOPTO_BASE_URL;
