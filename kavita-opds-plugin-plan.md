# Plan: An OPDS / Kavita source plugin for LNReader

Status: in progress — repo scaffolded, plugin skeleton implemented, live verification pending
Date: 2026-09-11

## 1. Goal

Add an LNReader source plugin that reads a self-hosted library server — Kavita first,
generic OPDS where practical — so a user can browse their own series, see chapters, and
read them inside LNReader.

Non-goals (for v1):

- Hosting or bundling content.
- Adding EPUB/PDF/CBZ file parsing to LNReader core.
- Making a single plugin that magically supports every OPDS server's reading model.

## 2. Background: how LNReader plugins work

The plugin repo compiles one TypeScript file per source. A plugin is a default-exported
instance of `Plugin.PluginBase` (`src/types/plugin.ts`):

| Method | Must return |
| --- | --- |
| `popularNovels(pageNo, options)` | `NovelItem[]` (`name`, `path`, `cover?`) |
| `searchNovels(term, pageNo)` | `NovelItem[]` |
| `parseNovel(path)` | `SourceNovel` (metadata + `chapters: ChapterItem[]`) |
| `parseChapter(chapterPath)` | **an HTML string** |

Runtime constraints that matter:

- Plugins run in an ES5/Hermes/React Native sandbox. No Node/browser globals, no
  filesystem, no `fetch` — use `fetchApi`/`fetchText` from `@libs/fetch`.
- The only injected libraries are `cheerio`, `@libs/fetch`, `dayjs`, `urlencode`,
  `htmlparser2`, `@libs/storage`, `@libs/isAbsoluteUrl`, `@libs/filterInputs`,
  `@libs/novelStatus`, `@libs/defaultCover`, `@libs/aes`, `@libs/utils`
  (see `docs/docs.md` § Other libraries). **There is no ZIP/EPUB parser available.**
- Configurable values come from `pluginSettings` + the `storage` helper. The settings
  screen writes to `storage` but does **not** reload the plugin instance, so read a
  setting inside the method that uses it if it must react immediately.

The critical consequence: `parseChapter` must produce renderable HTML. A plugin can
render text (with inline `<img>` tags) but cannot unzip an `.epub` in the sandbox.

## 3. The central problem

OPDS is a **catalog/distribution** protocol. An OPDS acquisition entry typically points at
a downloadable file (`application/epub+zip`, `application/pdf`, `application/vnd.comicbook+zip`).
It does **not** define how to get the *text* of a chapter.

- **Komga works** because it also implements Readium OPDS v2
  (`/opds/v2/books/{id}/manifest`), which exposes each EPUB's reading order as individual
  HTML pages. The existing upstream `plugins/multi/komga.ts` fetches those pages and returns
  HTML.
- **Kavita does not** expose HTML pages through OPDS. Its OPDS feed gives series → volumes
  → chapters, where each chapter entry's acquisition link is a file download. Pure OPDS
  would let us list series but not read them.

So "an OPDS plugin" splits into two problems: (a) catalog discovery, and (b) reading.
Kavita solves (b) through its REST API (see §5), which is why the plugin is
**Kavita-aware** rather than purely generic.

## 4. Options considered

### Option A — Kavita-specific plugin (chosen)

Use Kavita's OPDS feed for discovery and its REST API (`/api/Book/{id}/book-page`) for
chapter text. Delivers a fully working reader for EPUB libraries. Kavita also serves
comics/manga via page-image endpoints, which we map to `<img>` HTML.

Pros: actually readable; accurate metadata; API-key auth is simple.
Cons: Kavita only; not reusable for Calibre/Komga-style servers.

### Option B — Generic OPDS 1.2/2.0 plugin

Parse Atom XML / OPDS JSON navigation and acquisition feeds. Works for browsing any OPDS
server. Reading is only possible when the server exposes HTML (Readium OPDS 2, like Komga)
or page images (OPDS-PSE); for plain EPUB acquisition feeds there is no way to render text
inside the current plugin sandbox.

### Option C — Generic OPDS core + per-server reader adapters

Ship one OPDS catalog layer, then a small adapter interface (`getChapterHtml(entry)`) with a
Kavita adapter (REST book-page) and a Komga/Readium adapter. Best long-term shape, more work.

**Decision:** build **Option A** first, but keep the catalog code as an internal "OPDS
client" so it can become Option C later. Do not ship Option B alone — it lists books it
cannot open.

## 5. Kavita API surface (verified against `Kareadita/Kavita@develop`)

Auth: an API key, accepted as the `?apiKey=` query parameter, an `X-Api-Key`-style header,
or embedded in the OPDS route. The plugin appends `?apiKey=` to every request.

OPDS (Atom XML, `Produces("application/xml")`):

| Purpose | Endpoint |
| --- | --- |
| Root / navigation | `GET /api/opds/{apiKey}` |
| Libraries | `GET /api/opds/{apiKey}/libraries` |
| Library series | `GET /api/opds/{apiKey}/libraries/{libraryId}?pageNumber=N` |
| Recently added / updated / on-deck | `GET /api/opds/{apiKey}/recently-added` · `/recently-updated` · `/on-deck` |
| Series detail (volumes) | `GET /api/opds/{apiKey}/series/{seriesId}` |
| Volume (chapters) | `GET /api/opds/{apiKey}/series/{seriesId}/volume/{volumeId}` |
| Chapter entry (acquisition links) | `GET /api/opds/{apiKey}/series/{seriesId}/volume/{volumeId}/chapter/{chapterId}` |
| Search | `GET /api/opds/{apiKey}/series?query={term}` |
| Cover image | `GET /api/image/series-cover?seriesId={id}&apiKey={apiKey}` (also chapter-cover, volume-cover) |

REST (JSON; `?apiKey=`):

| Purpose | Endpoint |
| --- | --- |
| Series metadata | `GET /api/Series/{seriesId}` |
| Volumes in series | `GET /api/Series/volumes?seriesId={id}` |
| Chapters in volume | `GET /api/Series/chapter?volumeId={id}` |
| Book info (format + page count) | `GET /api/Book/{chapterId}/book-info` |
| EPUB table of contents | `GET /api/Book/{chapterId}/chapters` |
| **EPUB page HTML** | `GET /api/Book/{chapterId}/book-page?page={n}` |
| EPUB resource (css/img) | `GET /api/Book/{chapterId}/book-resources?file={path}` |
| Comic/archive page image | `GET /api/Reader/image?chapterId={id}&page={n}` |

`book-info` returns `seriesFormat` (`Epub`, `Pdf`, `Archive`, `Image`, `Unknown`) and
`pages`. `book-page` returns a single EPUB spine document with CSS scoped and image/link
URLs rewritten to Kavita's `/api/book/{chapterId}/...` routes (which carry an embedded
image-only key, so they need no extra auth from us).

## 6. Plugin design (implemented skeleton: `plugins/multi/kavita.ts`)

### 6.1 Identity and user-configurable endpoints

- `id = 'kavita'`, `name = 'Kavita'`, `icon = 'src/multi/kavita/icon.png'`, `version = '0.1.0'`.
- `site = 'https://www.kavitareader.com'` (project URL; the manifest can't evaluate the
  runtime setting, so this is metadata only).

All endpoints are **derived from user-configurable settings**, so the plugin points at any
Kavita instance. There are no hard-coded server URLs:

| Setting | Type | Purpose |
| --- | --- | --- |
| `url` | Text | Kavita base URL, e.g. `http://192.168.1.10:5000`. Supports a reverse-proxy subpath (`https://host/kavita`) and strips trailing slashes. |
| `apiKey` | Text | Kavita API key (User Settings → Account / 3rd Party Clients). |
| `libraryId` | Text | Optional default library id used when browsing instead of `Latest`. |

The private `baseUrl` and `apiKey` getters read `storage` on every call (not cached as
class fields), so changing settings takes effect without relying on a reload. `url(path,
params)` builds `{url}/api/{path}` and always appends `apiKey`, which is why both the OPDS
routes (`opds/{key}/...`) and REST routes (`Series/{id}`, `Book/{id}/...`) work against the
same configurable base. Because the base can include a subpath, no separate endpoint setting
is needed for reverse-proxied installs.

### 6.2 Path encoding

Kavita is ID-based, and LNReader `path` values must round-trip through `parseNovel` /
`parseChapter`:

- Novel: `series:{seriesId}`
- Chapter: `chapter:{chapterId}`

### 6.3 Method mapping (as implemented)

- `popularNovels(pageNo, { showLatestNovels, filters })`
  - `showLatestNovels` (or no library set) → `GET /api/opds/{key}/recently-added?pageNumber=N`.
  - library set → `GET /api/opds/{key}/libraries/{libraryId}?pageNumber=N`.
  - Parses the Atom feed with Cheerio `xmlMode`; maps each entry to a `NovelItem`
    (`path = series:{id}` derived from the `subsection` link, `cover` from the thumbnail link).
- `searchNovels(term, pageNo)` → `GET /api/opds/{key}/series?query={term}&pageNumber=N`,
  same mapping.
- `parseNovel('series:{id}')`
  - `GET /api/Series/{id}` for name/summary/author/genres/status/cover.
  - `GET /api/Series/volumes?seriesId={id}` then `GET /api/Series/chapter?volumeId={id}`
    (skipped when the volume payload already embeds chapters).
  - Emits one `ChapterItem` per Kavita chapter, `path = chapter:{chapterId}`.
- `parseChapter('chapter:{id}')`
  - `GET /api/Book/{id}/book-info` → `{ seriesFormat, pages }`.
  - EPUB: fetch `book-page?page=0..pages-1`, concatenate; the response is unwrapped if it
    arrives JSON-quoted; root-relative `/api/...` asset URLs are prefixed with the base URL.
  - Archive/Image: build `<img src="{base}/api/Reader/image?chapterId=..&page=..&apiKey=..">`
    per page.
  - PDF/unknown: return an HTML notice (no text renderer available).
  - All requests guard against `fetchText`'s empty-string-on-failure behaviour.
- Filters: `library` (`TextInput`); status mapping via `mapStatus`.

### 6.4 Reusable OPDS layer

Atom parsing lives in `parseFeed` / `entryToNovel` / `url`. If we later do Option C these
lift out unchanged into a shared module.

## 7. Repository setup (extension repo)

This directory is a **minimal fork** of the LNReader plugins tooling: it keeps the build,
manifest, playground, and publishing scripts, but ships only the Kavita plugin.

```
.
├── plugins/
│   ├── multi/kavita.ts                     # the plugin (compilable skeleton)
│   └── multisrc/generate-multisrc-plugins.js  # kept so build scripts are unchanged
├── public/static/src/multi/kavita/icon.png # 96x96 icon
├── scripts/                                # upstream build/manifest/publish/live-check
├── src/                                    # Vite playground, @libs runtime helpers, types
├── docs/                                   # plugin API docs
├── flake.nix / flake.lock                  # Node.js 22 + git devshell
├── package.json                            # name lnreader-kavita-plugins, version 0.1.0
├── tsconfig.json / tsconfig.production.json
└── .github/workflows/{publish-plugins,lint}.yml
```

Add it to the LNReader app as a plugin repository:

```
https://raw.githubusercontent.com/<your-user>/<your-repo>/plugins/v0.1.0/.dist/plugins.min.json
```

The `plugins/v<version>` branch is produced by the publish workflow and tracks `version` in
`package.json`. Pushing to `main` (touching `plugins/**`, `public/**`, `scripts/**`, or
`package.json`) builds and force-pushes that branch. Generated `.js/`, `.dist/`, and
`total.svg` are gitignored.

Two small tooling adjustments were needed for a single-plugin repo:

- `tsconfig.production.json` sets `rootDir: "./plugins"` so the emitted path keeps the
  `multi/` segment (`tsc` otherwise infers the common root as `plugins/multi` and the
  manifest can't find it).
- `scripts/build-plugin-manifest.js` guards the "broken plugins" scan with
  `fs.existsSync`, since absent language folders would otherwise crash it.

### Nix devshell

```sh
nix develop          # or: direnv allow
pnpm install
pnpm run dev:start    # playground at http://localhost:3000
```

The devshell provides Node.js 22 and git. Note: inside a git repo, `nix develop` only sees
tracked files, so `git add` the repo (or use `nix develop path:.`) before the first run.

## 8. Milestones

1. ✅ **Repo scaffold** — minimal extension repo, flake devshell, publish/lint workflows.
2. ✅ **Skeleton + auth** — settings (`url`, `apiKey`, `libraryId`), `?apiKey=` request
   helper, path scheme.
3. ✅ **Catalog** — `popularNovels` + `searchNovels` via OPDS feeds.
4. ✅ **Metadata + chapter list** — `parseNovel` via REST.
5. ✅ **Reading (EPUB)** — `parseChapter` via `book-page`; archive/image `<img>` path.
6. ⏳ **Live verification** — point the plugin at a real Kavita, confirm page indexing,
   `book-page` encoding, image loading, ordering, filters. Fix as needed.
7. ⏳ **Polish** — status/genre mapping against real data, PDF messaging, version bump.

## 9. Risks and open questions (resolve against a real Kavita)

- **Page indexing.** `BookService.GetBookPage` compares against a counter starting at 0,
  suggesting `page` is 0-based. Confirm with `book-info.pages` vs the last page.
- **Response encoding of `book-page`.** `ActionResult<string>` may serialize as a JSON
  string (quoted/escaped) rather than raw HTML; the skeleton unwraps a leading `"`. Confirm
  with `curl`.
- **Asset URLs.** `book-page` rewrites to `/api/book/...`; confirm those load in LNReader's
  WebView and that the base-prefix logic handles reverse-proxy subpaths.
- **`Series/volumes` shape.** Whether volumes embed `chapters` varies by version; the
  skeleton falls back to `Series/chapter`.
- **Comics in a novel reader.** LNReader can display `<img>`, but the UX is text-oriented.
  Decide whether to invest in archive libraries or document them as limited.
- **Auth secrecy.** `pluginSettings` has no password field; an API key is stored as plain
  Text. Acceptable for a self-hosted key, but note it.
- **CI live check.** `pnpm run check:plugin` runs against default (empty) settings, so a
  self-hosted plugin reports `INCONCLUSIVE`/`FAIL` in CI. Verify manually; that's expected.

## 10. Testing

- Local: `pnpm run dev:start` → `http://localhost:3000`, configure URL + API key, exercise
  `popularNovels`, `searchNovels`, `parseNovel`, `parseChapter` by eye (pagination, filters,
  chapter ordering, covers, image loading).
- `pnpm run check:plugin plugins/multi/kavita.ts` (expect `INCONCLUSIVE` without a
  reachable server).
- `pnpm run lint`, `pnpm run format:check`, `pnpm run build:compile`, `pnpm run build:manifest`.
- This is a personal extension repo, so there is no upstream PR; commit with Conventional
  Commits (`feat(multi): add Kavita plugin`) and push to trigger publishing. If upstreaming
  later, reference `lnreader/lnreader-plugins#432` (Self hosted source — Kavita/OPDS).

## 11. References

- LNReader plugin API: `docs/docs.md`, `docs/plugin-template.ts`
- Self-hosted precedent: upstream `plugins/multi/komga.ts`, `docs/komga-plugin.md`
- OPDS 1.2 / 2.0 specs: https://specs.opds.io
- OPDS-PSE (page streaming): http://vaemendis.net/opds-pse
- Kavita OPDS controller: `Kavita.Server/Controllers/OPDSController.cs`
- Kavita book reader API: `Kavita.Server/Controllers/BookController.cs`,
  `Kavita.Services/BookService.cs` (`GetBookPage`)
