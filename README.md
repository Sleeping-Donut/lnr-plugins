# LNReader extension repo: Kavita

A personal [LNReader](https://github.com/LNReader/lnreader) extension repository that adds a
single source: **[Kavita](https://www.kavitareader.com/)**, a self-hosted reading server.

This repository is a trimmed fork of the
[LNReader plugins tooling](https://github.com/lnreader/lnreader-plugins). It keeps the build,
manifest, playground, and publishing scripts, but ships only the Kavita plugin.

## The plugin

- `plugins/multi/kavita.ts` — `id = 'kavita'`, `name = 'Kavita'`.
- `public/static/src/multi/kavita/icon.png` — 96×96 icon.

Kavita is a **self-hosted** source, like the upstream Komga plugin. After installing it in the
app you must point it at your own server:

1. Install the `Kavita` plugin from this repository.
2. Open the installed plugin's settings (cog icon).
3. Fill in:
   - **Kavita server URL** — e.g. `http://192.168.1.10:5000` (no trailing slash).
   - **API key** — from Kavita: *User Settings → Account → API Key* (or the key embedded in
     Kavita's *3rd Party Clients / OPDS* URL).
4. Save and restart the app.

The server URL and API key are user-configurable plugin settings, so the same plugin works against
any Kavita instance on your network. Use the **Library** filter in the source's browse view to
switch between libraries.

## Add this repo to LNReader

Once the publish workflow has run, add this URL to the app's plugin repository list:

```
https://raw.githubusercontent.com/Sleeping-Donut/lnr-plugins/plugins/v0.1.0/.dist/plugins.min.json
```

The `plugins/v0.1.0` segment comes from `package.json`'s `version`; keep that fixed so this URL
stays valid. Plugin updates are delivered by bumping the plugin's own `version` in
`plugins/multi/kavita.ts`.

## Development

This repo defines a Nix devshell with Node.js 22, pnpm, and git.

```sh
nix develop          # or: direnv allow
pnpm install
pnpm dev:start       # playground at http://localhost:3000
```

Useful commands (same as upstream):

- `pnpm dev:start` — regenerate generated plugins and launch the plugin playground.
- `pnpm check:plugin plugins/<lang>/<plugin>.ts` — bundle and exercise a plugin against its live
  site. Kavita is skipped via `.livecheckignore` because it is self-hosted and needs user-specific
  configuration; verify it in the playground or the app instead.
- `pnpm lint` / `pnpm format:check`
- `pnpm build:compile` / `pnpm build:manifest`
- `pnpm publish:plugins` — compile and force-push the built manifest to the
  `plugins/v<version>` branch.

## Publishing

Pushing to `main` runs `.github/workflows/publish-plugins.yml`, which builds the plugins and
pushes the compiled output plus `plugins.min.json` to the `plugins/v<version>` branch. That
branch is what the app reads; do not edit it by hand.

## Credits

Build tooling and plugin API come from
[lnreader/lnreader-plugins](https://github.com/lnreader/lnreader-plugins) (MIT). See `LICENSE`.
