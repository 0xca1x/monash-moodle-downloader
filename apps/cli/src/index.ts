#!/usr/bin/env node
import { Command } from "commander";

import { loadEnvFile } from "@monash-moodle-downloader/core";

import { registerAuthCommands } from "./commands/auth.js";
import { registerCourseCommands } from "./commands/course.js";
import { registerSubtitleCommands } from "./commands/subtitles.js";

loadEnvFile();

const program = new Command();
program
  .name("monash-moodle-downloader")
  .description("Download Monash Moodle course files, videos, and subtitles with a TypeScript CLI.")
  .showHelpAfterError()
  .version("0.1.0");

registerAuthCommands(program);
registerCourseCommands(program);
registerSubtitleCommands(program);

program.addHelpText(
  "after",
  `
Notes:
  - default login URL is https://learning.monash.edu/
  - default downloads directory is ./downloads
  - default download crawl depth is 0
  - course scan / scan-batch only scans sections/files without writing downloads or reports
  - download commands still accept --scan-only for compatibility
  - subtitle translation scans .srt files and writes sibling *.zh-CN.srt files
  - set MONASH_SESSION_SECRET in .env to encrypt saved session cookies/storage
  - set SUBTITLE_TRANSLATION_API_KEY / SUBTITLE_TRANSLATION_MODEL for subtitle translation
  - plaintext session saving is blocked by default and requires --allow-plaintext-session
  - Panopto login is required by default for video downloads; use --allow-partial-session to save a Moodle-only session
`
);

const argv = [
  process.argv[0],
  process.argv[1],
  ...process.argv.slice(2).filter((arg) => arg !== "--")
];

await program.parseAsync(argv);
