import type { Command } from "commander";

import { translateSubtitlesBatch } from "@monash-moodle-downloader/core";

import { resolveRepoPath } from "../utils.js";

export function registerSubtitleCommands(program: Command): void {
  const subtitles = program.command("subtitles").description("Translate generated subtitle files");

  subtitles
    .command("translate-batch")
    .description("Translate .srt files under a file or directory into a target language")
    .requiredOption("--input <path>", "Input subtitle file or directory")
    .option("--lang <code>", "Target language code", "zh-CN")
    .option("--force", "Overwrite existing translated subtitles", false)
    .action(async (options: { input: string; lang: string; force: boolean }) => {
      const result = await translateSubtitlesBatch({
        inputPath: resolveRepoPath(options.input),
        targetLang: options.lang,
        force: options.force
      });

      console.log(`Subtitle translation finished for ${result.inputPath}`);
      console.log(`Target language: ${result.targetLang}`);
      console.log(`Scanned: ${result.scanned}`);
      console.log(`Translated: ${result.translated}`);
      console.log(`Skipped: ${result.skipped}`);
      console.log(`Failed: ${result.failed}`);
      if (result.failed > 0) {
        process.exitCode = 1;
      }
    });
}
