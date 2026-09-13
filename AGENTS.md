# Repository Guidelines

## Project Structure & Module Organization

YOMU is a local-first Vite/TypeScript PWA. `index.html` defines the page and dialogs; `src/main.ts` coordinates UI state, editing, analytics, and imports/exports. Keep reusable domain logic in focused modules: `src/data.ts` for schemas and migrations, `src/csv.ts` for CSV handling, `src/openbd.ts` for ISBN/openBD access, `src/book-search.ts` for Open Library catalog search, `src/google-books.ts` for Google Books ISBN cover lookup, and `src/book-covers.ts` for ordered cover resolution. `src/shelf-state.ts` owns shelf filtering and device display preferences; `src/navigation.ts` owns browser-history transitions. Styles live in `src/styles.css`. PWA metadata, service-worker code, icons, and vendored browser assets belong in `public/`. The end-to-end regression entrypoint is `tests/verify_app.py`, which also runs `tests/verify_mobile_ux.py`; generated `dist/`, `artifacts/`, and `node_modules/` are not source files.

## Build, Test, and Development Commands

- `npm ci`: install the lockfile-pinned dependencies used in CI.
- `npm run dev`: start Vite at `http://localhost:8056` (the configured `0.0.0.0` host also permits LAN testing at `http://<current IPv4>:8056`).
- `npm run typecheck`: run strict TypeScript checks without emitting files.
- `npm run build`: type-check and create the production bundle in `dist/`.
- `npm run preview`: serve the production build on port 4173.
- `npm test`: build, launch Vite preview on `127.0.0.1:4173`, and run the Playwright regression script in `tests/verify_app.py`.

## Coding Style & Naming Conventions

Use ES modules, strict TypeScript, two-space indentation, double-quoted strings, and semicolons. Prefer `camelCase` for functions and variables, `PascalCase` for interfaces/types, and `UPPER_SNAKE_CASE` for module constants. Use kebab-case for multiword filenames. Python uses four spaces and `snake_case`. No formatter or linter is configured, so match nearby code and keep functions narrowly scoped.

## Testing Guidelines

Add coverage to `tests/verify_app.py` for user-visible changes. Tests should exercise persisted state, reload behavior, responsive layouts, and the external catalog/cover flows, while mocking openBD, Google Books, and Open Library calls. There is no numeric coverage threshold; `npm test` must pass, including console-error checks. On Windows, the suite currently expects Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`.

## Commit & Pull Request Guidelines

Follow the existing concise imperative convention: `feat: add camera ISBN and book search`, `docs: record GitHub Pages release`, or `chore: preserve working baseline`. Keep commits focused. Pull requests should explain behavior and data-migration impact, list verification commands, link relevant issues, and include before/after screenshots for UI changes (prefer 360, 768, and 1440 px widths).

## Data Safety & Deployment

Never delete legacy `:v1` localStorage keys or weaken the exact ID-and-title check used to remove old demo books. Do not commit user exports, secrets, or generated builds. Pushes to `main` deploy through `.github/workflows/deploy-pages.yml`; verify the Actions run and public Pages URL after release changes.
