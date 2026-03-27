import fs from "node:fs";

import { ENV_PATH } from "./config.js";

export function loadEnvFile(filePath: string = ENV_PATH): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const parsed: Record<string, string> = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
  return parsed;
}
