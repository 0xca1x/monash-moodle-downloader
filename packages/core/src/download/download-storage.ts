import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { APIRequestContext, APIResponse } from "playwright";
import type { DownloadedFile, ResourceLink } from "@monash-moodle-downloader/shared";

export interface SaveOutcome {
  status: DownloadedFile["status"];
  absolutePath?: string;
  filename?: string;
  reason?: string;
}

function classifyDownloadError(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name.toLowerCase();
    const message = error.message.toLowerCase();
    if (name.includes("timeout") || message.includes("timeout")) {
      return "timeout";
    }
    return slugify(error.message, 80);
  }
  return "download_error";
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function slugify(text: string, maxLength = 80): string {
  const value = normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const result = value.slice(0, maxLength).replace(/-+$/g, "");
  return result || "item";
}

function safeFsName(text: string, fallback = "item", maxLength = 120): string {
  const value = normalizeText(text)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\.+$/g, "")
    .trim();
  const result = value.slice(0, maxLength).trim();
  return result || fallback;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const buffer = await fs.readFile(filePath);
  hash.update(buffer);
  return hash.digest("hex");
}

function parseContentDispositionFilename(headerText: string): string | null {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(headerText);
  return match?.[1]?.trim() ?? null;
}

function inferExtensionFromContentType(contentType: string): string {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase();
  const mapping: Record<string, string> = {
    "application/pdf": ".pdf",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/zip": ".zip",
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "text/plain": ".txt",
    "text/csv": ".csv"
  };
  return mapping[normalized] ?? "";
}

function shouldPreferTitleBasedFilename(
  candidateName: string,
  resourceType: ResourceLink["resourceType"]
): boolean {
  if (resourceType !== "video" && resourceType !== "subtitle") {
    return false;
  }
  const parsed = path.parse(candidateName.toLowerCase());
  return new Set(["fragmented", "master", "index", "playlist", "manifest"]).has(parsed.name);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function downloadResource(
  requestContext: APIRequestContext,
  url: string,
  title: string,
  downloadDir: string,
  orderPrefix?: number,
  resourceType: ResourceLink["resourceType"] = "file"
): Promise<SaveOutcome> {
  await fs.mkdir(downloadDir, { recursive: true });
  const downloadUrl =
    url.includes("/mod/resource/view.php") && !url.includes("redirect=1")
      ? `${url}${url.includes("?") ? "&" : "?"}redirect=1`
      : url;

  try {
    const response: APIResponse = await requestContext.get(downloadUrl, {
      timeout: 0,
      failOnStatusCode: false
    });
    if (!response.ok()) {
      return { status: "failed", reason: `http_${response.status()}` };
    }

    const finalUrl = response.url();
    const headers = response.headers();
    const contentDisposition = headers["content-disposition"] ?? "";
    const contentType = headers["content-type"] ?? "";
    const candidateName =
      parseContentDispositionFilename(contentDisposition) ||
      path.basename(new URL(finalUrl).pathname);
    const candidateExt = path.extname(candidateName) || inferExtensionFromContentType(contentType);
    const preferredBaseName = shouldPreferTitleBasedFilename(candidateName, resourceType)
      ? title
      : candidateName || title;
    let filename = safeFsName(preferredBaseName, slugify(title, 60));
    if (!path.extname(filename)) {
      const fallbackExt = resourceType === "subtitle" ? ".srt" : ".bin";
      filename = `${filename}${candidateExt || fallbackExt}`;
    }
    if (orderPrefix !== undefined) {
      filename = `${orderPrefix.toString().padStart(2, "0")}_${filename}`;
    }

    const targetPath = path.join(downloadDir, filename);
    const tempPath = path.join(
      downloadDir,
      `.download-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.tmp`
    );
    const body = Buffer.from(await response.body());
    if (resourceType === "subtitle" && body.byteLength === 0) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      return { status: "failed", reason: "empty_subtitle_response" };
    }
    await fs.mkdir(path.dirname(tempPath), { recursive: true });
    await fs.writeFile(tempPath, body);

    if (await exists(targetPath)) {
      const [existingHash, downloadedHash] = await Promise.all([
        sha256File(targetPath),
        sha256File(tempPath)
      ]);
      if (existingHash === downloadedHash) {
        await fs.rm(tempPath, { force: true });
        return { status: "skipped", absolutePath: targetPath, filename, reason: "unchanged" };
      }
      await fs.rm(targetPath, { force: true });
      await fs.rename(tempPath, targetPath);
      return { status: "updated", absolutePath: targetPath, filename, reason: "content_changed" };
    }

    await fs.rename(tempPath, targetPath);
    return { status: "downloaded", absolutePath: targetPath, filename, reason: "new_file" };
  } catch (error) {
    return { status: "failed", reason: classifyDownloadError(error) };
  } finally {
    const tempCandidates = await fs.readdir(downloadDir).catch(() => []);
    await Promise.all(
      tempCandidates
        .filter((name) => name.startsWith(".download-") && name.endsWith(".tmp"))
        .map((name) => fs.rm(path.join(downloadDir, name), { force: true }).catch(() => undefined))
    );
  }
}

export async function saveReferenceFile(
  url: string,
  title: string,
  outputDir: string,
  resourceType: ResourceLink["resourceType"],
  orderPrefix?: number
): Promise<SaveOutcome> {
  await fs.mkdir(outputDir, { recursive: true });
  const suffix = resourceType === "subtitle" ? ".subtitle.url.txt" : ".video.url.txt";
  let filename = `${safeFsName(title, slugify(title, 60))}${suffix}`;
  if (orderPrefix !== undefined) {
    filename = `${orderPrefix.toString().padStart(2, "0")}_${filename}`;
  }

  const targetPath = path.join(outputDir, filename);
  const nextBody = [`TITLE=${title}`, `TYPE=${resourceType}`, `URL=${url}`, ""].join("\n");
  const existingBody = await fs.readFile(targetPath, "utf8").catch(() => null);
  if (existingBody === nextBody) {
    return { status: "skipped", absolutePath: targetPath, filename, reason: "reference_unchanged" };
  }

  await fs.writeFile(targetPath, nextBody, "utf8");
  return {
    status: existingBody === null ? "downloaded" : "updated",
    absolutePath: targetPath,
    filename,
    reason: existingBody === null ? "reference_saved" : "reference_changed"
  };
}

export async function saveInlineTextFile(
  text: string,
  title: string,
  outputDir: string,
  resourceType: ResourceLink["resourceType"],
  orderPrefix?: number,
  preferredExtension?: string,
  exactFilename?: string
): Promise<SaveOutcome> {
  await fs.mkdir(outputDir, { recursive: true });
  const extension = preferredExtension ?? (resourceType === "subtitle" ? ".txt" : ".txt");
  let filename = exactFilename ?? `${safeFsName(title, slugify(title, 60))}${extension}`;
  if (!exactFilename && orderPrefix !== undefined) {
    filename = `${orderPrefix.toString().padStart(2, "0")}_${filename}`;
  }

  const targetPath = path.join(outputDir, filename);
  const existingBody = await fs.readFile(targetPath, "utf8").catch(() => null);
  if (existingBody === text) {
    return { status: "skipped", absolutePath: targetPath, filename, reason: "inline_unchanged" };
  }

  await fs.writeFile(targetPath, text, "utf8");
  return {
    status: existingBody === null ? "downloaded" : "updated",
    absolutePath: targetPath,
    filename,
    reason: existingBody === null ? "inline_saved" : "inline_changed"
  };
}

export async function writeCourseDownloadReport(
  courseDir: string,
  result: unknown
): Promise<string> {
  const reportPath = path.join(courseDir, "_download-report.json");
  await fs.mkdir(courseDir, { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return reportPath;
}
