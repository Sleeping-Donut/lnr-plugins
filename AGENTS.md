# AGENTS.md

## Repository overview

This is a personal LNReader extension repository. It is a trimmed fork of the upstream
[LNReader plugins](https://github.com/lnreader/lnreader-plugins) tooling that ships a single source:
the self-hosted [Kavita](https://www.kavitareader.com/) plugin. Changes are usually one of:

- the Kavita plugin (`plugins/multi/kavita.ts`) or its icon;
- the build, manifest, and publish tooling under `scripts/`;
- the React/Vite plugin playground under `src/`; or
- the Nix devshell and the CI workflows.

Read `README.md` for the app-install URL and dev commands, `docs/docs.md` for the plugin API, and
`docs/testing.md` for the live check.

## Environment and package management

- Use Node.js 22 or newer. The Nix devshell (`nix develop`) provides Node 22, pnpm, and git.
- Use pnpm for all repository commands. CI installs with `pnpm install --frozen-lockfile`.
- `pnpm-workspace.yaml` allows the `@swc/core`, `esbuild`, and `protobufjs` build scripts; add to
  its `allowBuilds` map if a new dependency needs a postinstall.
- Keep `pnpm-lock.yaml` consistent with `package.json` when dependencies change.
- Copy `.env.template` to `.env` only when local serving needs a custom `USER_CONTENT_BASE`.
  Never commit `.env` or credentials.

## Repository map

- `plugins/multi/kavita.ts`: the Kavita plugin. Server-based sources live under `multi/`.
- `plugins/multisrc/generate-multisrc-plugins.js`: the multi-source generator entry point. No
  generators exist yet; it is kept so a CMS/theme family can be added later.
- `public/static/src/multi/kavita/icon.png`: the 96x96 plugin icon.
- `src/types/plugin.ts`: canonical plugin interfaces.
- `src/libs/`: runtime helpers available to plugins through the `@libs/*` alias.
- `src/`: the React/Vite playground used for interactive testing.
- `scripts/`: compilation, manifest, publish, icon, site, and live-check tooling.
- `docs/plugin-template.ts`: starting point for a new standalone plugin.
- `.livecheckignore`: plugin ids excluded from the live check.

## Plugin implementation rules

- Kavita is self-hosted: the server URL and API key are user-configurable `pluginSettings`, and every
  endpoint is derived from them. Never hard-code a user's server.
- Implement `Plugin.PluginBase` and export one instantiated plugin as the default export. Keep the
  plugin `id` unique and stable.
- Use imports from `@libs/*` for plugin runtime helpers. In particular, use `@libs/fetch`, not
  `@/lib/fetch`.
- Plugins are compiled for an ES5/Hermes/React Native environment. Do not assume Node-only or
  browser-only globals and APIs are available in the app runtime.
- Use semantic versions. Increment the plugin `version` on every change: patch for a fix, minor for
  a feature, major for a breaking change. The app only picks up a change when the version bumps.
- Keep the 96x96 icon at `public/static/src/multi/kavita/icon.png` and `icon` set to
  `src/multi/kavita/icon.png` (without `public/static/`).
- Keep returned paths and `resolveUrl` behavior consistent. Exercise pagination, filters, chapter
  ordering, covers, status, summaries, and chapter cleanup.
- Use `defaultCover` when a source has no usable image. Do not invent metadata the source does not
  provide.

## Multi-source plugins

Only relevant if a generator is added under `plugins/multisrc/`:

- Treat files named like `plugins/<language>/<name>[<generator>].ts` as generated output. Do not
  edit or commit them; they are gitignored and Oxlint intentionally ignores them.
- Change the generator's `sources.json`, `template.ts`, filters, custom assets, or `generator.js`
  instead, then run `pnpm run build:multisrc` to regenerate.
- Generated files are disposable and may be removed with `pnpm run clean:multisrc`.

## Coding style

- Follow `.oxfmtrc.json` (two spaces, single quotes, trailing commas, no parentheses around a single
  arrow-function parameter). `.oxlintrc.json` enforces `type` over `interface`.
- Keep changes focused; reuse patterns from the plugin and the playground rather than adding
  abstractions.
- Do not edit generated artifacts under `.js/` or `.dist/`.

## Development and validation

- `pnpm run lint` — Oxlint.
- `pnpm run format:check` — Oxfmt.
- `pnpm run dev:start` — launch the playground at `http://localhost:3000`.
- `pnpm run build:compile` — compile production plugin sources.
- `pnpm run build:manifest` — build `.dist/plugins.json` (needs `USER_CONTENT_BASE` or a git remote).
- `pnpm run serve:dev` — compile, build the manifest, and serve the repo for the app (port 3000).
- `pnpm run check:plugin plugins/<language>/<plugin>.ts` — live check. Kavita is excluded via
  `.livecheckignore` because it needs user-specific configuration.

For a plugin change, run `pnpm run lint`, `pnpm run format:check`, and `pnpm run build:compile`, then
verify behavior in the playground or the app. The live check cannot validate Kavita.

For playground/UI changes, run `pnpm run dev:start` and exercise the flow in the browser; run
`pnpm exec oxfmt --check "./src/**/*.{ts,tsx,js,css}"` and `pnpm run lint`.

There is no unit-test suite. Compilation and linting do not prove a source works, because the server
API and the plugin's parsing can change independently.

## Publishing

- `package.json` `version` names the publish branch: `plugins/v<version>`. Keep it fixed (currently
  `0.1.0`) unless you also update the app's repository URL.
- Pushing to `main` (touching `plugins/**`, `public/**`, `scripts/**`, or `package.json`) runs
  `.github/workflows/publish-plugins.yml`, which builds and force-pushes the compiled output plus
  `.dist/plugins.min.json` to that branch.
- Add this repo to the app as
  `https://raw.githubusercontent.com/<user>/<repo>/plugins/v0.1.0/.dist/plugins.min.json`.
- Do not commit `.js/`, `.dist/`, `total.svg`, or local environment files.

## Commit messages

Use Conventional Commits: `type(scope): description`.

- type: feat (new plugin/feature), fix, perf, chore, docs, refactor.
- scope: the plugin folder, e.g. `multi/kavita`, or a tooling area.
- Lowercase type, imperative mood ("add" not "added"/"adds").

Examples:

- feat(multi/kavita): add library picker filter
- fix(multi/kavita): handle protocol-relative image URLs

If a commit was authored (fully or partly) by an AI agent, add a generic
`Co-Authored-By: LLM <noreply@invalid>` trailer so reviewers can weight their review accordingly.
