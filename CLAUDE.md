# Doppelpunkt — notes for contributors and agents

- Monorepo with npm workspaces: `apps/web`, `packages/*`, `tools`. Node 20+.
- Packages are consumed as TS source; no build step for packages. Import as `@doppelpunkt/<name>`.
- The content contract is `packages/content-schema/src/index.ts`. Do not change field names without
  updating `docs/CONTENT_FORMAT.md`, the tools and the app.
- Every exercise needs a stored solution and an explanation. AI is never required to grade closed exercises.
- Tag every German sentence with its variety: `de`, `ch-std`, `gsw-zh`, `gsw-be`. Swiss German uses
  Dieth-style spelling; graders accept listed alternatives.
- UI colours: gold = Standard German, red = Swiss German. Keep both themes (light/dark) working.
- API keys never leave the device except in the request to the chosen provider (or the optional relay).
- Commands: `npm install`, `npm run dev`, `npm test`, `npm run typecheck`, `npm run content:lint`,
  `npm run build`, `npm run test:e2e`.
- Roadmap and versions: `docs/ROADMAP.md`.
