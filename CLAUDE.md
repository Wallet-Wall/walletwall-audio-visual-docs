# CLAUDE.md

Read [AGENTS.md](AGENTS.md) first; its rules apply to Claude Code without exception.

Working notes for Claude Code sessions:

- Node 24 runs the TypeScript sources directly (type stripping). Use `import type` for types, `.ts` extensions in imports, and no TypeScript-only runtime syntax (no parameter properties, enums, or namespaces).
- Run the full gate before reporting work as done: `npm run check`, then `npm run render:stills migration-readiness` for anything visual. Report results exactly; a skipped gate is reported as skipped.
- Remotion renders the props resolved by `selectComposition`, so every render variant (for example the characterless design-test stills) selects its own composition.
- Rendered output goes to `dist/` and is never committed.
- Never commit, push, open a PR, or publish unless the maintainer asked for it in this session.
