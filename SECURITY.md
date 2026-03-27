# Security Policy

## Scope

This repository handles:

- authenticated Moodle sessions
- Panopto session state
- downloaded course files
- generated subtitle files

Please treat these as potentially sensitive.

## Supported Security Posture

Current expectations:

- source code remains TypeScript-only
- session storage is encrypted by default
- plaintext session storage requires explicit opt-in
- runtime residue such as `.session/` and `downloads/` is not committed

## Reporting A Vulnerability

Please report security issues privately.

Do not open a public issue for:

- session leakage
- cookie or token exposure
- path traversal in downloads
- unsafe file overwrite behavior
- command injection
- sensitive data disclosure

When reporting, include:

- affected command or module
- clear reproduction steps
- expected vs actual behavior
- impact assessment
- logs or screenshots if useful

## Sensitive Areas In This Repository

Review changes carefully when they touch:

- `packages/core/src/auth-service.ts`
- `packages/core/src/session-store.ts`
- `packages/core/src/session-crypto.ts`
- `packages/core/src/download-service.ts`
- CLI commands that read or write local session files

## Local Security Notes

- Keep `MONASH_SESSION_SECRET` in `.env`, not in source control
- Avoid using `--allow-plaintext-session` except for temporary local debugging
- Do not share files from `.session/`
- Review downloaded files before redistributing them

## Dependency Hygiene

Before release or sharing:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

For formatting and staged-file checks:

```bash
pnpm format:check
```

## Disclosure Preference

Please allow time to investigate, reproduce, and patch issues before public disclosure.
