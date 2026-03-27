# Architecture

`monash-moodle-downloader` is a TypeScript monorepo with a Node.js runtime for the current CLI.

## Runtime Model

- Source code is written in TypeScript only.
- Packages are compiled with `tsc`.
- The runnable CLI executes compiled JavaScript with Node.js.
- The repository root is a workspace orchestrator, not an application runtime layer.

## Workspace Layout

```text
apps/
  cli/         # current runnable app
  extension/   # reserved for future WXT app
packages/
  core/        # reusable domain logic
  shared/      # shared types and constants
```

## Dependency Direction

```text
apps/cli -> packages/core -> packages/shared
```

Rules:

- `apps/*` may depend on `packages/*`.
- `packages/core` may depend on `packages/shared`.
- `packages/shared` should stay dependency-light and domain-neutral.
- `packages/*` must not depend on `apps/*`.

## Package Responsibilities

### `packages/shared`

Use this package for:

- public types
- cross-package constants
- small, stable shared primitives

Keep it free of app-specific behavior and heavy runtime dependencies.

### `packages/core`

Use this package for reusable business logic:

- auth/session lifecycle
- course section discovery
- download orchestration
- resource parsing
- Panopto handling
- subtitle translation

Current internal shape:

```text
packages/core/src/
  auth/
    auth-service.ts
    browser-launch.ts
    session-crypto.ts
    session-store.ts
  config.ts
  course/
    course-service.ts
  download/
    download-service.ts
    download-storage.ts
    panopto.ts
    resource-parser.ts
    section-crawler.ts
  env.ts
  index.ts
  subtitles/
    subtitle-translate-service.ts
```

Internal guidance:

- `auth/` owns browser login, session storage, and encryption concerns.
- `course/` owns course-level discovery APIs such as section listing.
- `download/` owns crawling, parsing, Panopto enrichment, file/reference persistence, and download orchestration.
- `subtitles/` owns subtitle translation workflows.
- `config.ts` and `env.ts` stay as shared runtime configuration entrypoints for the CLI-facing core package.
- `index.ts` should remain the stable public entrypoint that re-exports supported APIs.

### `apps/cli`

Use this package for:

- command definitions
- option parsing
- process exit code behavior
- human-readable terminal output

Current shape:

```text
apps/cli/src/
  commands/
    auth.ts
    course.ts
    subtitles.ts
  utils.ts
  index.ts
```

CLI guidance:

- `index.ts` should mainly assemble the command tree.
- Command modules should call `packages/core` APIs, not reimplement business logic.
- Shared CLI-only helpers belong in `apps/cli/src/utils.ts`.
- Batch input parsing, confirmation prompts, and report writing helpers that are purely terminal-oriented can stay in CLI utilities.

## Storage Model

Runtime residue is local-only and not committed:

- `.session/`
  encrypted session blob + metadata
- `downloads/`
  downloaded course content

Defaults:

- session files: `.session/moodle-session.*`
- download root: `downloads/<COURSE_CODE>/...`

## Extension Boundary

`apps/extension` is intentionally a placeholder for now.

Current shape:

```text
apps/extension/src/
  index.ts
```

Current rule:

- do not build product logic there yet
- keep core logic in `packages/core`
- only add platform-specific wiring when the extension work actually starts

This keeps the current CLI stable while preserving a clean path to a future WXT app.

## Design Principles

- TypeScript-only source
- Node.js runtime for the current CLI
- one implementation of domain logic
- app-specific code only at the app boundary
- explicit public exports through package entrypoints
- no legacy compatibility layers unless product value clearly justifies them

## Current Focus

Given the current codebase shape, the main architectural priority is not another folder split. It is keeping boundaries clean as features grow.

Prefer these directions next:

1. Keep CLI output and report formatting in `apps/cli`, not in `packages/core`.
2. Add more tests around parsing, crawling, and downloader behavior before larger feature expansion.
3. Treat `apps/extension` as a thin integration layer when it eventually starts, reusing `packages/core` instead of duplicating logic.
