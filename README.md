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
   - **Default library ID** *(optional)* — a Kavita library id to browse when not using the
     `Latest` button.
4. Save and restart the app.

Both the server URL and the API key are user-configurable plugin settings, so the same plugin
works against any Kavita instance on your network.

## Add this repo to LNReader

Once the publish workflow has run, add this URL to the app's plugin repository list:

```
https://raw.githubusercontent.com/<your-user>/<your-repo>/plugins/v0.1.0/.dist/plugins.min.json
```

Replace `<your-user>/<your-repo>`, and keep the `plugins/v<version>` part in sync with the
`version` field in `package.json` (currently `0.1.0`).

## Development

This repo defines a Nix devshell with Node.js 22 and git.

```sh
nix develop          # or: direnv allow
npm install
npm run dev:start    # playground at http://localhost:3000
```

Useful commands (same as upstream):

- `npm run dev:start` — regenerate generated plugins and launch the plugin playground.
- `npm run check:plugin -- plugins/multi/kavita.ts` — bundle and exercise the plugin against a
  live server (expect `INCONCLUSIVE` unless a reachable Kavita with valid credentials is set as
  the plugin's default settings; self-hosted plugins are normally verified manually).
- `npm run lint` / `npm run format:check`
- `npm run build:compile` / `npm run build:manifest`
- `npm run publish:plugins` — compile and force-push the built manifest to the
  `plugins/v<version>` branch.

## Publishing

Pushing to `main` runs `.github/workflows/publish-plugins.yml`, which builds the plugins and
pushes the compiled output plus `plugins.min.json` to the `plugins/v<version>` branch. That
branch is what the app reads; do not edit it by hand.

## Credits

Build tooling and plugin API come from
[lnreader/lnreader-plugins](https://github.com/lnreader/lnreader-plugins) (MIT). See `LICENSE`.
