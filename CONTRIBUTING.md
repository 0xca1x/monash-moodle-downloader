# Contributing

Thanks for contributing to `monash-moodle-downloader`.

This repository is a TypeScript monorepo with a Node.js runtime. The current active app is the CLI under `apps/cli`, with reusable logic in `packages/core` and `packages/shared`.

## Ground Rules

- Keep source code in TypeScript.
- Do not reintroduce Python implementations for active product logic.
- Prefer shared logic in `packages/core` or `packages/shared` over app-specific duplication.
- Do not commit runtime residue such as `downloads/`, `.session/`, or build output.
- Preserve the repo's `TypeScript-only source, Node.js runtime` model.

## Setup

```bash
pnpm install
pnpm build
pnpm typecheck
```

Useful commands:

```bash
pnpm lint
pnpm lint:fix
pnpm format
pnpm format:check
pnpm cli -- --help
```

## Local Development Workflow

1. Create or update code in `apps/*/src` or `packages/*/src`.
2. Run:

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm build
```

3. Test the CLI manually for the area you changed.

Examples:

```bash
pnpm cli -- auth status
pnpm cli -- course sections --course-url "https://learning.monash.edu/course/view.php?id=0001"
pnpm cli -- course scan --course-url "https://learning.monash.edu/course/view.php?id=0002&section=15"
```

## Session And Downloads Safety

- Do not commit `.env`
- Do not commit `.session`
- Do not commit `downloads`
- Use `MONASH_SESSION_SECRET` for encrypted local session storage
- Treat saved Moodle and Panopto session state as sensitive

## Architecture Guidance

- `apps/cli`
  Runnable CLI application
- `apps/extension`
  Future WXT browser extension shell
- `packages/core`
  Shared downloader, auth, parsing, and subtitle logic
- `packages/shared`
  Shared types and constants

When in doubt:

- app-specific UX goes in `apps/*`
- reusable logic goes in `packages/*`

## Pull Request Checklist

- The change fits the TypeScript-only source model
- `pnpm format:check` passes
- `pnpm lint` passes
- `pnpm typecheck` passes
- `pnpm build` passes
- Any new CLI behavior is reflected in help text or docs
