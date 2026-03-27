import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface TranslateSubtitleBatchOptions {
  inputPath: string;
  targetLang?: string;
  force?: boolean;
}

export interface TranslateSubtitleBatchResult {
  inputPath: string;
  targetLang: string;
  scanned: number;
  translated: number;
  skipped: number;
  failed: number;
  outputs: string[];
}

interface SrtCue {
  index: string;
  timing: string;
  text: string;
}

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface SubtitleTranslationMeta {
  sourceSha256: string;
  targetLang: string;
  model: string;
}

function getTranslationConfig(): { apiKey: string; baseUrl: string; model: string } {
  const apiKey = process.env.SUBTITLE_TRANSLATION_API_KEY?.trim() ?? "";
  const baseUrl = (
    process.env.SUBTITLE_TRANSLATION_BASE_URL?.trim() || "https://api.openai.com/v1"
  ).replace(/\/+$/g, "");
  const model = process.env.SUBTITLE_TRANSLATION_MODEL?.trim() ?? "";

  if (!apiKey) {
    throw new Error("Missing SUBTITLE_TRANSLATION_API_KEY.");
  }
  if (!model) {
    throw new Error("Missing SUBTITLE_TRANSLATION_MODEL.");
  }

  return { apiKey, baseUrl, model };
}

function isTranslatableSrtFile(filePath: string, targetLang: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith(".srt") && !lower.endsWith(`.${targetLang.toLowerCase()}.srt`);
}

async function collectSrtFiles(inputPath: string, targetLang: string): Promise<string[]> {
  const stat = await fs.stat(inputPath);
  if (stat.isFile()) {
    return isTranslatableSrtFile(inputPath, targetLang) ? [inputPath] : [];
  }

  const results: string[] = [];
  const stack = [inputPath];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && isTranslatableSrtFile(fullPath, targetLang)) {
        results.push(fullPath);
      }
    }
  }
  results.sort();
  return results;
}

function buildTargetSubtitlePath(sourcePath: string, targetLang: string): string {
  const parsed = path.parse(sourcePath);
  return path.join(parsed.dir, `${parsed.name}.${targetLang}.srt`);
}

function buildTargetMetaPath(targetPath: string): string {
  return `${targetPath}.meta.json`;
}

function parseSrt(text: string): SrtCue[] {
  return text
    .trim()
    .split(/\r?\n\r?\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/g);
      const [index = "", timing = "", ...textLines] = lines;
      return {
        index: index.trim(),
        timing: timing.trim(),
        text: textLines.join("\n").trim()
      };
    })
    .filter((cue) => cue.timing.includes("-->"));
}

function stringifySrt(cues: SrtCue[]): string {
  return `${cues
    .map((cue, index) => [String(index + 1), cue.timing, cue.text, ""].join("\n"))
    .join("\n")
    .trim()}\n`;
}

function chunkCues<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function sha256Text(text: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  hash.update(text, "utf8");
  return hash.digest("hex");
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const fencedMatch = /```(?:json)?\s*([\s\S]+?)\s*```/i.exec(trimmed);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

async function translateTextBatch(
  texts: string[],
  targetLang: string,
  model: string
): Promise<string[]> {
  const { apiKey, baseUrl } = getTranslationConfig();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You translate subtitle lines. Preserve meaning, punctuation, and line order. Return strict JSON with key translated and value an array of translated strings."
            },
            {
              role: "user",
              content: JSON.stringify({
                targetLanguage: targetLang,
                lines: texts
              })
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`Translation API failed. HTTP ${response.status}`);
      }

      const payload = (await response.json()) as OpenAICompatibleResponse;
      const content = payload.choices?.[0]?.message?.content ?? "";
      const parsed = JSON.parse(extractJsonObject(content)) as { translated?: string[] };
      const translated = parsed.translated ?? [];
      if (!Array.isArray(translated) || translated.length !== texts.length) {
        throw new Error("Translation response did not return the expected number of lines.");
      }
      return translated.map((item) => String(item));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("Translation API failed.");
}

async function translateSrtFile(
  sourcePath: string,
  targetLang: string,
  force: boolean
): Promise<{ status: "translated" | "skipped"; outputPath: string }> {
  const { model } = getTranslationConfig();
  const targetPath = buildTargetSubtitlePath(sourcePath, targetLang);
  const sourceText = await fs.readFile(sourcePath, "utf8");
  const sourceSha256 = await sha256Text(sourceText);
  const targetMetaPath = buildTargetMetaPath(targetPath);
  if (!force) {
    const [targetExists, targetMeta] = await Promise.all([
      fs
        .stat(targetPath)
        .then(() => true)
        .catch(() => false),
      readJsonFile<SubtitleTranslationMeta>(targetMetaPath)
    ]);
    if (
      targetExists &&
      targetMeta?.sourceSha256 === sourceSha256 &&
      targetMeta?.targetLang === targetLang &&
      targetMeta?.model === model
    ) {
      return { status: "skipped", outputPath: targetPath };
    }
  }

  const cues = parseSrt(sourceText);
  if (cues.length === 0) {
    throw new Error(`No subtitle cues found in ${sourcePath}`);
  }

  const translatedTexts: string[] = [];
  for (const chunk of chunkCues(cues, 40)) {
    const chunkTranslations = await translateTextBatch(
      chunk.map((cue) => cue.text),
      targetLang,
      model
    );
    translatedTexts.push(...chunkTranslations);
  }

  const translatedCues = cues.map((cue, index) => ({
    ...cue,
    text: translatedTexts[index] ?? cue.text
  }));
  await fs.writeFile(targetPath, stringifySrt(translatedCues), "utf8");
  await fs.writeFile(
    targetMetaPath,
    JSON.stringify(
      {
        sourceSha256,
        targetLang,
        model
      } satisfies SubtitleTranslationMeta,
      null,
      2
    ),
    "utf8"
  );
  return { status: "translated", outputPath: targetPath };
}

export async function translateSubtitlesBatch({
  inputPath,
  targetLang = "zh-CN",
  force = false
}: TranslateSubtitleBatchOptions): Promise<TranslateSubtitleBatchResult> {
  const resolvedInputPath = path.resolve(inputPath);
  const srtFiles = await collectSrtFiles(resolvedInputPath, targetLang);
  const outputs: string[] = [];

  let translated = 0;
  let skipped = 0;
  let failed = 0;

  for (const [index, srtFile] of srtFiles.entries()) {
    console.log(
      `[subtitle] ${(index + 1).toString().padStart(2, "0")}/${srtFiles.length.toString().padStart(2, "0")} ${srtFile}`
    );
    try {
      const result = await translateSrtFile(srtFile, targetLang, force);
      outputs.push(result.outputPath);
      if (result.status === "translated") {
        translated += 1;
        console.log(`[subtitle:TRANSLATED] ${result.outputPath}`);
      } else {
        skipped += 1;
        console.log(`[subtitle:SKIPPED] ${result.outputPath}`);
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[subtitle:FAILED] ${srtFile} -> ${message}`);
    }
  }

  return {
    inputPath: resolvedInputPath,
    targetLang,
    scanned: srtFiles.length,
    translated,
    skipped,
    failed,
    outputs
  };
}
