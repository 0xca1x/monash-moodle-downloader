# monash-moodle-downloader

Download Monash Moodle course files, Panopto video references, videos, and subtitles with a TypeScript CLI.

This project is mainly for Monash students who want to save course materials locally for review, backup, or offline study.

## What It Does

- Log in to Monash Moodle in a real browser
- Save your local Moodle session for later CLI use
- Scan a course or section before downloading
- Download course files into a local `downloads/` folder
- Download across multiple course URLs from a text file
- Save video links and subtitles discovered from Panopto resources
- Translate `.srt` subtitle files into another language

## Current Status

The current runnable app is the CLI in `apps/cli`.

The browser extension workspace exists as a future placeholder:

- `apps/extension`

Shared logic lives in:

- `packages/core`
- `packages/shared`

## Requirements

- Node.js 20 or newer recommended
- `pnpm`
- A local browser environment for Monash login and 2FA
- Your Monash account must already have access to the target Moodle course

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

2. Create a local env file:

```bash
cp .env.example .env
```

3. Set `MONASH_SESSION_SECRET` in `.env` to a long random string.

4. Build the workspace:

```bash
pnpm build
```

5. Log in and save a session:

```bash
pnpm cli -- auth login
```

6. Download one course:

```bash
pnpm cli -- course download-files --course-url "https://learning.monash.edu/course/view.php?id=0001"
```

## First-Time Setup Notes

- `MONASH_SESSION_SECRET` is strongly recommended and is used to encrypt the saved local session.
- If you do not set it, the CLI will refuse to save session data unless you explicitly pass `--allow-plaintext-session`.
- During `auth login`, the browser will open and you must finish Monash login and 2FA yourself.
- After Moodle login succeeds, the tool will try to establish a Panopto session automatically.
- If Panopto login cannot be completed automatically, video downloads may be incomplete unless you explicitly allow a Moodle-only session with `--allow-partial-session`.

## Typical Usage

### 1. Check login status

```bash
pnpm cli -- auth status
```

### 2. Log in

```bash
pnpm cli -- auth login
```

Useful options:

- `--course-url <url>` to choose a different starting page
- `--headless` to launch a headless browser
- `--allow-plaintext-session` to opt in to plaintext local session storage
- `--allow-partial-session` to save a Moodle-only session when Panopto auth is not completed

### 3. List sections in a course

```bash
pnpm cli -- course sections --course-url "https://learning.monash.edu/course/view.php?id=0001"
```

### 4. Scan a course before downloading

```bash
pnpm cli -- course scan --course-url "https://learning.monash.edu/course/view.php?id=0001"
```

This is useful when you want to:

- verify the course URL is correct
- preview how many sections and files were found
- avoid writing downloads yet

### 5. Download one course or one section

Whole course:

```bash
pnpm cli -- course download-files --course-url "https://learning.monash.edu/course/view.php?id=0001"
```

Single section:

```bash
pnpm cli -- course download-files --course-url "https://learning.monash.edu/course/view.php?id=0002&section=11"
```

Useful options:

- `--download-dir <path>` to change the output root
- `--max-depth <n>` to follow linked pages below the section page
- `--scan-only` to run the same command without writing downloads

### 6. Download multiple courses from a file

The file should contain one course URL per line.
Blank lines and lines starting with `#` are ignored.

Example input file:

```text
https://learning.monash.edu/course/view.php?id=0001
https://learning.monash.edu/course/view.php?id=0002
https://learning.monash.edu/course/view.php?id=0003
```

Run:

```bash
pnpm cli -- course download-batch --input ./courses.txt
```

If you only want a dry run:

```bash
pnpm cli -- course scan-batch --input ./courses.txt
```

### 7. Translate subtitles

Set these values in `.env` if you want subtitle translation:

- `SUBTITLE_TRANSLATION_API_KEY`
- `SUBTITLE_TRANSLATION_BASE_URL`
- `SUBTITLE_TRANSLATION_MODEL`

Then run:

```bash
pnpm cli -- subtitles translate-batch --input ./downloads
```

Useful options:

- `--lang <code>` target language code, default `zh-CN`
- `--force` overwrite existing translated subtitle files

## Output Layout

By default, downloads are written under:

```text
downloads/<COURSE_CODE>/
```

The downloader may create:

- course folders
- per-section folders
- `files/` subfolders
- saved file attachments
- saved video reference files
- subtitle files
- batch reports such as `_batch-report.json` and `_batch-report.md`

## Important Behavior

- `pnpm cli -- ...` runs the already-built CLI
- `pnpm cli:fresh -- ...` rebuilds first, then runs the CLI
- default download root is `./downloads`
- default crawl depth is `0`
- session files are stored under `./.session`
- downloaded runtime files and sessions should not be committed

## Common Commands

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm cli -- --help
pnpm cli -- auth status
pnpm cli -- auth login
pnpm cli -- auth logout --yes
pnpm cli -- course sections --course-url "https://learning.monash.edu/course/view.php?id=0001"
pnpm cli -- course scan --course-url "https://learning.monash.edu/course/view.php?id=0001"
pnpm cli -- course download-files --course-url "https://learning.monash.edu/course/view.php?id=0002&section=11"
pnpm cli -- course download-batch --input ./courses.txt
pnpm cli -- subtitles translate-batch --input ./downloads
```

## Troubleshooting

### Login succeeds in Moodle but videos are missing

- Panopto authentication may not have completed.
- Run `pnpm cli -- auth login` again and make sure the browser finishes the Monash flow cleanly.
- If you save a partial session with `--allow-partial-session`, some Panopto-protected resources may still be unavailable.

### The tool refuses to save the session

- Check that `MONASH_SESSION_SECRET` is set in `.env`.
- If you really want plaintext local storage for testing, use `--allow-plaintext-session`.

### A course returns no sections

- Confirm the URL is a real Moodle course page such as `https://learning.monash.edu/course/view.php?id=...`
- Try `course sections` first before `download-files`
- If you are passing a section URL, make sure the session can access that course

### Command changes are not showing up

- Rebuild first:

```bash
pnpm cli:fresh -- --help
```

## Security Notes

- Keep `.env` private
- Do not share `.session/`
- Treat downloaded course material as potentially sensitive
- Review course copyright or teaching staff guidance before redistributing downloaded materials

## Project Docs

- See [CONTRIBUTING.md](/Users/hohin/Desktop/MO/CONTRIBUTING.md) for development workflow and commit rules
- See [SECURITY.md](/Users/hohin/Desktop/MO/SECURITY.md) for security handling notes
- See [docs/architecture.md](/Users/hohin/Desktop/MO/docs/architecture.md) for package boundaries and dependency direction
