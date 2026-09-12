# Plan: A Tapas source plugin for LNReader

Status: research complete — no code written
Date: 2026-09-12

## 1. Goal

Add an LNReader source plugin for the webnovels hosted on [tapas.io](https://tapas.io) so a user
can browse, search, read, and (optionally) keep comics working in the same source.

Non-goals (for v1):

- Logging in / unlocking paid ("must-pay") or early-access episodes.
- Bypassing mature/NSFW age gates.
- Shipping an official Tapas client; all APIs below are undocumented and reverse-engineered from
  the website and the Android app.

## 2. Background: how LNReader plugins work

A plugin is a default-exported instance of `Plugin.PluginBase` (`src/types/plugin.ts`):

| Method | Must return |
| --- | --- |
| `popularNovels(pageNo, options)` | `NovelItem[]` (`name`, `path`, `cover?`) |
| `searchNovels(term, pageNo)` | `NovelItem[]` |
| `parseNovel(path)` | `SourceNovel` (metadata + `chapters: ChapterItem[]`) |
| `parseChapter(chapterPath)` | **an HTML string** |

Runtime constraints that matter:

- Plugins run in an ES5/Hermes/React Native sandbox. No Node/browser globals, no filesystem, no
  `fetch` — use `fetchApi`/`fetchText` from `@libs/fetch`.
- Only the injected libraries listed in `docs/docs.md` § Other libraries are available
  (`cheerio`, `dayjs`, `htmlparser2`, `@libs/*`). A JSON API plus Cheerio for the novel HTML is
  enough; no extra dependency is needed.
- The playground (`src/main.tsx`) overrides `window.fetch` to route non-`localhost` URLs through
  the Vite `/https:` proxy, so cross-origin calls to `api.tapas.io` work during dev. In the app,
  requests run natively (no CORS). `pnpm run check:plugin` runs in Node.

The consequence for Tapas: `parseChapter` for a **novel** must fetch a small HTML file and return
its body HTML; for a **comic** it must return `<img>` tags.

## 3. The two Tapas APIs (both verified live, 2026-09-12)

Tapas has two separate backends. Both are "unofficial" in that Tapas publishes no docs for them.

### 3.1 App API (recommended) — `https://api.tapas.io/v3`

A Spring JSON API used by the Tapas Android/iOS app. Public (no login) for browsing, search,
metadata, chapter lists, and free chapter content. This should be the plugin's primary backend:
it is ID-based, paginated, and avoids HTML scraping for everything except novel chapter text.

Required headers on **every** request (the wrapper `fetchApi` merges these over its defaults):

| Header | Value | Notes |
| --- | --- | --- |
| `accept` | `application/panda+json` | Without it the API returns `401 error.unauthorized`. |
| `x-device-type` | `ANDROID` (or `WEB`) | Without it: `400 ... X-DEVICE-TYPE is required headers.` |
| `x-device-uuid` | any non-empty string | Header must be present; value is not validated. Use a fixed constant, e.g. a 16-char hex string. |

Working reference implementation of this API (Go, MIT): <https://github.com/bake/tapas>
(covers series/episodes/episode/search only; the browse endpoints below were found by probing).

Example:

```sh
curl 'https://api.tapas.io/v3/series/4242' \
  -H 'accept: application/panda+json' \
  -H 'x-device-type: ANDROID' \
  -H 'x-device-uuid: 0123456789abcdef'
```

#### Verified endpoints

| Purpose | Endpoint | Shape / notes |
| --- | --- | --- |
| Comic genres | `GET /v3/genres` | Array of genre objects. `books=false`. |
| Novel genres | `GET /v3/genres?books=true` | Array of genre objects. `books=true`. |
| Genre groups | `GET /v3/genres/groups` | Array of 16 parent genre groups; no series route under it. |
| One genre | `GET /v3/genres/{id}` | Single genre object. |
| Browse by genre | `GET /v3/genres/{id}/series?page={n}&sort={SORT}` | `{pagination:{page,has_next,sort}, series:[...]}`. `pagination.page` is the **next** page. |
| Full novel search | `GET /v3/search/books?q={term}&page={n}` | `{result:[{series}], pagination:{page,has_next,since}}`, 20/page. |
| Full comic search | `GET /v3/search/comics?q={term}&page={n}` | Same shape. |
| Composite search (landing) | `GET /v3/search?q={term}` | `{books, top, comics, people, tags}`, only 3 series each — do **not** use for `searchNovels`. |
| Global trending | `GET /v3/search/trending` | `{result:[{series}], pagination}`, 10 items. Not filterable by type (`books=true`/`category_type` ignored). |
| Curated collections | `GET /v3/collections?page={n}` | `{pagination, collections:[{id,title,description,series:[...],banner_url,...}]}`. |
| One collection | `GET /v3/collections/{id}` | Single collection. |
| Series detail | `GET /v3/series/{id}` | Full metadata (see 3.3). |
| Chapter list | `GET /v3/series/{id}/episodes` | Full array; **ignores `page`/`sort`** and returns every episode (verified 189/189). |
| Chapter content | `GET /v3/series/{id}/episodes/{episodeId}` | Adds `contents`, `next_episode`, `prev_episode`, etc. |
| Recommendations | `GET /v3/series/{id}/recommendations` | Array of series. |
| User | `GET /v3/users/{id}` | Public profile. |

Verified `sort` values for `/v3/genres/{id}/series`: `POPULARITY`, `NEWEST`, `RECENT`, `UPDATED`,
`TRENDING`, `OLDEST`, `LIKE`, `VIEW`. Invalid values return `500`, so validate before sending.

No global "latest updates" endpoint was found (`/v3/series`, `/v3/novels`, `/v3/books`,
`/v3/series/updates`, `/v3/landing/*` all 404/400). `/v3/search/trending` exists but is
comics-heavy (see §3.4), so `showLatestNovels` is ignored and the default is the Romance genre.

#### Genre object

```json
{ "id": 16, "name": "Romance", "abbr": "Romance", "books": true,
  "description": "", "display_order": 2, "group_id": 16, "shortcut": true, "series_cnt": 0 }
```

The 15 **novel** genres (`?books=true`), stable ids (the genre picker is populated live from this
endpoint — see §4.4 — but these ids are useful for testing and defaults):

| id | name | id | name | id | name |
| --- | --- | --- | --- | --- | --- |
| 31 | Romance Fantasy | 16 | Romance | 18 | Drama |
| 33 | Action Fantasy | 28 | Action | 19 | Thriller/Horror |
| 23 | BL | 26 | GL | 27 | LGBTQ+ |
| 12 | Comedy | 20 | Slice of life | 17 | Mystery |
| 15 | Science fiction | 14 | Non-fiction | 11 | Fantasy |

(The comic set has the same names but different ids, minus Non-fiction and plus Gaming — not
needed for a novels-first plugin, but useful if comics are supported later.)

### 3.2 Website API — `https://tapas.io`

The Next.js website uses a different backend under `/api/v1/...`. **Most `/api/*` routes require
an authenticated session** and return `401 error.unauthorized` to anonymous requests
(`/api/v1/landing/*`, `/api/v1/layout`, `/api/v1/menu/list`, `/api/v1/source`, `/api/series/{id}/info`).

Two **public** JSON routes were found (no auth), which can serve as a fallback if the app API ever
changes:

- `GET /series/{idOrUrlName}` with `accept: application/json` → the series object (fields mirror
  the app API, e.g. `thumb_url`, `genre`, `episode_cnt`).
- `GET /series/{id}/episodes?page={n}&sort=NEWEST|OLDEST` with `accept: application/json` →
  `{data:{pagination:{page,has_next,total,max_limit,...}, body:"<li ... data-href=\"/episode/{id}\" ...>"}}`.
  `max_limit` must be ≤ 20; the body is HTML, parsed with Cheerio.

Discovery data is not exposed anonymously, but it *is* embedded in the server-rendered pages under
`__NEXT_DATA__` (`props.pageProps.dehydratedState.queries`): `menu-list`, `layout`,
`landing-list/{id}` (with `items[].seriesId`). Parsing that JSON is possible but brittle and
unnecessary given the app API.

**Decision:** use the app API for all functionality; keep the two public website routes in mind as
a contingency only.

### 3.3 Data shapes

Series detail (`GET /v3/series/{id}`) — fields the plugin cares about:

- `id`, `title`, `human_url`, `description`, `blurb`, `colophon`
- `type` (`BOOKS`, `COMICS`, `COMMUNITY`, `COMMUNITY_BOOKS`, ...), `sale_type`
- `thumb` `{width,height,file_size,file_url}`, `book_cover_url` (may be `null`)
- `creators[]` `{id, uname, display_name, profile_pic_url, ...}`
- `genre` `{id,name,abbr,books}`, `tags[]`
- `age_rating` (or `null`), `restricted`, `restricted_msg`
- `completed` (boolean) — the only status signal
- `episode_cnt`, `must_pay_cnt`, `early_access_ep_cnt`
- `updated_date`, `last_episode_updated_date`, `desc_order`
- `subscribe_cnt`, `like_cnt`, `view_cnt`, `comment_cnt`

Browse/search series item (compact): `{id,title,type,sale_type,thumb,book_cover_url,creators,
age_rating,restricted,completed,updated_date,blurb,genre,badges}`; search results use a flat
`thumb_url` string instead of the `thumb` object.

Episode metadata (`/episodes` and `/episodes/{id}`):

```json
{ "id": 44180, "title": "Down in the Dungeon", "scene": 1, "free": true,
  "downloadable": true, "thumb": {"file_url": "..."}, "created_date": "2014-06-12T17:33:50Z",
  "nsfw": false, "unlocked": false, "early_access": false, "must_pay": false,
  "content_size": 2326041,
  "contents": [ {"width":800,"height":2949,"file_size":2326041,"file_url":"https://us-a.tapas.io/...jpg?version=v3"} ],
  "next_episode": {...}, "prev_episode": {...} }
```

`scene` is the canonical 1-based order; `/episodes` returns them ascending (`desc_order=false` for
the series checked; use `scene` for `chapterNumber`).

Chapter content:

- **Comic:** `contents[]` is a list of page images (`us-a.tapas.io/...jpg?version=v3`).
- **Novel:** `contents[]` is a single entry whose `file_url` is an `.html` file, in one of two
  forms:
  - **Plain:** `https://us-a.tapas.io/n/...html?version=v3` — the body is
    `<div id="viewport">` with `<p>`/`<blockquote>` markup.
  - **Encrypted (newer novels):**
    `https://d30womf5coomej.cloudfront.net/r/r.tapas.io/1/pn/...html?version=v3` — the body is a
    **base64 blob of non-HTML bytes** (not zlib/gzip; no key is exposed in the API). Verified on
    `I Made a Deal with the Devil` (227351) and `The Enemy Alpha's Unwilling Mate` (329742).

  Because of the encrypted form, the plugin must **not** rely on the `.html` file. Instead it
  fetches the public website reader page `https://tapas.io/episode/{episodeId}` and returns the
  inner HTML of `article.viewer__body` — the server has already decrypted the body there for both
  forms. The raw `.html` `#viewport` parse is kept only as a fallback if the website page fails.
  Example body from the website page (encrypted novel): `article.viewer__body` contains
  `<div class="ep-epub-content" id="epub-…">` wrapping `<p>` tags; for a plain novel it contains
  the `<p>`/`<blockquote>` tags directly. Both render fine.

- **Locked / must-pay:** locked episodes still return `contents` with a **single preview item**
  (`unlocked:false`, `free:false`). The plugin can render the preview and/or append a "locked"
  notice; it cannot return the full chapter without a logged-in session.

Images load without a `Referer` (verified), so `imageRequestInit` is not required.

### 3.4 Is there an "all" genre / global listing?

No. Checked against the live app API:

- `/v3/genres` and `/v3/genres?books=true` each return exactly 15 genres; there is no "All".
- `/v3/genres/groups` returns 16 genre **groups** (Action, Romance, …) — also no "All", and
  `/v3/genres/groups/{id}/series` does not exist.
- `/v3/genres/{0,-1,999999}/series` → `404`; `/v3/genres/all/series` → `400`; `/v3/series`,
  `/v3/novels`, `/v3/books`, `/v3/series/updates`, `/v3/landing/*` → `404`/`400`. There is no
  global series-listing endpoint.

The website's "All Genre" (Novels → All Genre, subtab 24) is a `landingType: ENTIRE_GENRE` landing
whose data comes from the auth-gated `/api/v1/landing/...`, so it is not usable anonymously either.
Its title suggests a **genre directory**, not a global series feed.

Consequence: `/v3/search/trending` is mixed and its top items are **all comics/community** (no
`BOOKS`), so it is unusable as a novels default. The plugin defaults to the **Romance** novel genre
(`16`) with `sort=POPULARITY` instead. A true global all-novels view would require fanning out
across the 15 novel genres.

## 4. Plugin design (proposed)

### 4.1 Identity and location

- `id = 'tapas'`, `name = 'Tapas'`, `site = 'https://tapas.io'`, `version = '1.0.0'`.
- Source: `plugins/english/tapas.ts` (novels are English-language on this source).
- Icon: `public/static/src/en/tapas/icon.png` (96x96), referenced as
  `icon = 'src/en/tapas/icon.png'`. Note the trimmed repo currently has no `plugins/english/`
  folder; the manifest/live-check scripts skip missing language dirs, so creating it is safe.

### 4.2 Path encoding

The app API is ID-based and chapter content needs **both** ids, so:

- Novel: `series:{seriesId}`
- Chapter: `episode:{seriesId}:{episodeId}`

`parseChapter` splits on `:` to recover both. (There is no global `/v3/episodes/{id}` route.)

### 4.3 Request helper

A private `api(path, params?)` that builds `https://api.tapas.io/v3/{path}` and calls `fetchText`
with the three required headers, then `JSON.parse`es the body (guarding `fetchText`'s
empty-string-on-failure behaviour). `resolveUrl(path, isNovel)` returns the website URL for
reference (`https://tapas.io/series/{human_url}` / `.../episode/{id}`) — mainly for debugging.

### 4.4 Filters (populated from the API, Kavita-style)

The user-facing filter set is a **genre** picker and a **sort** picker. Follow the Kavita plugin's
pattern: a private cache plus a `get filters()` accessor, filled from `/v3/genres?books=true` the
first time `popularNovels` runs (the app reads `plugin.filters` to render the filter sheet, so the
genre options appear once the source has been opened — exactly how Kavita loads its libraries).

- `genre` — `Picker` populated from the API, default **Romance** (`16`). There is no "All genres"
  option: `/v3/search/trending` is comics-only and there is no global novel listing, so a concrete
  novel genre is the default. The picker falls back to a single `Romance` option until
  `/v3/genres?books=true` has loaded.
- `sort` — `Picker`, static options: Popular (`POPULARITY`, default), New (`NEWEST`), Recently
  Updated (`UPDATED`), Trending (`TRENDING`), Oldest (`OLDEST`), Most Liked (`LIKE`), Most Viewed
  (`VIEW`). (`NEWEST`/`RECENT`/`UPDATED` returned the same first item in one probe — verify before
  finalising labels.) `sort` applies to the selected genre's listing.

No `status` filter in v1: the API has no status query parameter, and filtering a 20-item page
client-side would be misleading.

The cache stores `{ key, options }` like Kavita's `libraryCache`; `popularNovels` refreshes it on
`page <= 1` so a later `/v3/genres` change is picked up.

### 4.5 Method mapping

- `popularNovels(pageNo, { showLatestNovels, filters })`
  - `showLatestNovels` is **ignored**: the app renders the "Latest" button unconditionally on every
    source (`SourcesTab.tsx`), and the plugin has no way to hide it. Returning the same view keeps
    the button harmless.
  - `GET /v3/genres/{genreId}/series?page={n}&sort={sort}`, with
    `genreId = filters.genre.value || '16'` (Romance) and
    `sort = filters.sort.value || 'POPULARITY'`.
  - Map each item to `{ name: title, path: 'series:'+id, cover: book_cover_url || thumb.file_url }`.
- `searchNovels(term, pageNo)` → `GET /v3/search/books?q={term}&page={n}`; map `result[].series`
  (search items use `thumb_url` for the cover).
- `parseNovel('series:{id}')`
  - `GET /v3/series/{id}` for name/cover/summary/author/genre/status.
  - `GET /v3/series/{id}/episodes`, sort by `scene`, emit one `ChapterItem` per episode
    (`path = episode:{sid}:{eid}`, `chapterNumber = scene`, `releaseTime = created_date`).
  - Locked episodes get a `🔒` prefix in the chapter name:
    `name = (locked ? '🔒 ' : '') + title`. "Locked" = `!free || must_pay` (also consider
    `early_access`). This is the in-list indicator the user asked for.
- `parseChapter('episode:{sid}:{eid}')`
  - `GET /v3/series/{sid}/episodes/{eid}`.
  - If the episode is locked (`!free || must_pay`), **throw** a clear `Error` — see §4.8 for why,
    and the fallback.
  - If `contents[0].file_url` ends in `.html` (a novel): `fetchText`
    `https://tapas.io/episode/{eid}`, load with Cheerio, and return
    `$('article.viewer__body').html()` — this handles both plain and encrypted novels. Fall back to
    the raw `.html`'s `#viewport` if the website page is empty.
  - Else: `contents.map(c => '<img src="' + c.file_url + '">').join('\n')`.

### 4.6 Status and metadata mapping

- `status`: `completed ? NovelStatus.Completed : NovelStatus.Ongoing` (no hiatus/cancelled signal
  exists in the API; use `Unknown` only if the field is missing).
- `author` / `artist`: join `creators[].display_name` (the API does not separate writer vs artist).
- `genres`: `genre.name` plus `tags[]`.
- `summary`: `description` (fall back to `blurb`).
- `cover`: `book_cover_url || thumb.file_url`.
- `rating`: not exposed by the API — omit.

### 4.7 Settings / auth

No settings are required for v1 (the app API is public). Hard-code a fixed `x-device-uuid`
constant. A future `sessionCookie`/token setting could unlock paid chapters, but the app API's
auth flow (device registration / login) is out of scope and was not reverse-engineered here.

**Language filtering is not possible.** LNReader supports a `CheckboxGroup` setting, so a language
toggle UI could be built, but the Tapas app API exposes no language field on series/search items and
ignores every language signal (`?language=`, `Accept-Language`, `x-language`, `x-locale`, `locale`,
`x-device-country`), and has no language endpoint. The only (unreliable) signal is a translated
title suffix like `(Español)`/`(Français)`/`(Bahasa Indonesia)`, which is not used. So no language
selector is shipped.

### 4.8 Locked chapters: what the app actually supports

The desired "toast when opening a locked chapter" is **not possible** from a plugin. The plugin
sandbox in `lnreader/lnreader` (`src/plugins/pluginManager.ts`) exposes only this `require` map:
`cheerio`, `htmlparser2`, `dayjs`, `urlencode`, and
`@libs/{novelStatus,fetch,isAbsoluteUrl,filterInputs,defaultCover,aes,utils,storage}`. There is no
toast/alert API; the app's own `showToast` (React Native `ToastAndroid`) is internal to the app.

What happens instead when `parseChapter` throws: the reader catches it (`useChapter.ts`) and renders
`ErrorScreenV2` with the error message and a Retry button. So throwing a clear message is the
closest equivalent to the requested toast and is the recommended v1 behaviour:

```ts
throw new Error(
  '🔒 This Tapas episode is locked. Unlock it in the Tapas app/site to read it here.',
);
```

The message can include Tapas' wait interval. The series detail carries `timer_interval` (seconds)
and a `badges` entry like `{"type":"WAIT_SCHEDULED_3HR","period":10800}`; `must_pay` marks episodes
that can only be bought. Anonymous requests have no per-user countdown (`key_timer`/`wop_key_timer`
are `null`), so the best available text is the wait interval, e.g. "…wait-or-pay timer is 3 hours…".
`parseChapter` can re-fetch the series (or the interval can be encoded in the chapter path) to build
this.

Note the "Latest" button cannot be removed by a plugin: `SourcesTab.tsx` renders it for every
source unconditionally. The plugin simply treats `showLatestNovels` the same as the default view.

Fallback if a full error screen feels too heavy: return a small styled HTML notice as the chapter
body, e.g. `<h2>🔒 Locked chapter</h2><p>Unlock this episode on Tapas to read it.</p>`. That keeps
the reader flow but reads like an empty chapter, so it is the second choice. Either way the chapter
list still shows the episode with a `🔒` prefix, which is fully supported (`ChapterItem.name` is
free text).

## 5. Repository setup

This is a single-plugin fork; the same build/publish machinery as Kavita applies:

- Add `plugins/english/tapas.ts` and `public/static/src/en/tapas/icon.png`.
- `pnpm run lint`, `pnpm run format:check`, `pnpm run build:compile`,
  `pnpm run build:manifest`.
- Publish branch is `plugins/v0.1.0` (from `package.json` `version`); pushing to `main` touching
  `plugins/**` or `public/**` rebuilds and force-pushes it.
- Unlike Kavita, Tapas is **not** self-hosted and needs no user config, so it does not belong in
  `.livecheckignore` — `pnpm run check:plugin plugins/english/tapas.ts` should actually exercise it
  in CI.

## 6. Milestones

1. Research (this document).
2. Skeleton: identity, `api()` helper, headers, path scheme, filters.
3. Catalog: `popularNovels` + `searchNovels` against `/v3/genres/*` and `/v3/search/books`.
4. Metadata + chapter list: `parseNovel` via `/v3/series/{id}` + `/episodes`.
5. Reading: `parseChapter` novel-HTML path and comic-image path; locked `🔒` handling (§4.8).
6. Live verification in the playground and via `pnpm run check:plugin`.
7. Polish: filter defaults, pagination edge cases, version bump.

## 7. Risks and open questions

- **Unofficial API stability.** All endpoints are reverse-engineered; Tapas can change or gate
  them at any time. Keep the website's public `/series/{id}` and `/series/{id}/episodes` JSON
  routes documented as a fallback.
- **Chapter-list cap.** `/v3/series/{id}/episodes` returned all 189 episodes for the largest
  series checked. Confirm it has no hidden cap (e.g. 200/500) for very large series; if it does,
  fall back to the website route, which paginates at 20.
- **Locked content.** `must_pay`/`unlocked:false` episodes return only one preview item. Planned UX:
  show them in the list with a `🔒` prefix and throw a clear error on open (the reader renders
  `ErrorScreenV2`); no plugin-level toast is available (§4.8).
- **No global "all"/latest endpoint.** Confirmed absent from the app API (§3.4), and
  `/v3/search/trending` is comics-only. The default view is therefore the Romance novel genre; the
  "Latest" button is treated the same as the default (it cannot be hidden — §4.8). A true
  all-novels view would need a 15-genre fan-out, not done in v1.
- **Search has no sort/filter.** `/v3/search/books` ignores `sort`/`genre`/`order` (only `q` +
  `page`), and LNReader's `searchNovels(term, pageNo)` receives no filters, so neither the API nor
  the UI can sort/filter search results.
- **Encrypted novel bodies.** Newer novels serve a base64 encrypted `.html` blob. The plugin reads
  the decrypted body from the public website episode page (`article.viewer__body`) instead. That
  adds a dependency on the legacy reader page's markup; if it changes, plain novels still fall back
  to the `.html` `#viewport`, but encrypted novels could not be read without reversing the cipher.
- **Mature/NSFW gating.** `age_rating`, `restricted`, and `nsfw` exist; some content may require
  an age-confirmation cookie. Test a mature series; do not attempt to bypass the gate.
- **Status fidelity.** Only a `completed` boolean is exposed; no hiatus/cancelled.
- **`sort=NEWEST` vs `RECENT` vs `UPDATED`.** They returned the same first id in one test; verify
  their exact meaning before labelling filters.
- **Page size.** Observed 20/page for `/v3/genres/{id}/series` and `/v3/search/books`; confirm.
- **`genres/{id}/series` pagination.** `pagination.page` is the next page number, not the current
  one; make sure the plugin passes the LNReader page number straight through and relies on
  `has_next`.
- **Rate limiting.** Not observed, but a fixed device UUID and no backoff could get throttled;
  keep request counts low.

## 8. Testing

- Local: `pnpm run dev:start` → `http://localhost:3000`, exercise `popularNovels` (each sort and a
  few genres), `searchNovels` (pagination), `parseNovel` (a novel and a comic), and `parseChapter`
  (novel HTML, comic images, a locked episode).
- `pnpm run check:plugin plugins/english/tapas.ts` (should PASS; it runs in Node, no CORS).
- `pnpm run lint`, `pnpm run format:check`, `pnpm run build:compile`, `pnpm run build:manifest`.

## 9. References

- LNReader plugin API: `docs/docs.md`, `docs/plugin-template.ts`, `docs/testing.md`
- Existing plan for style: `kavita-opds-plugin-plan.md`
- App API reference client (Go, MIT): <https://github.com/bake/tapas>
- App API reference client (Svelte/Capacitor; confirms headers, series/episode/search shapes):
  <https://github.com/TriLinder/OpenTapasReader>
- LNReader app plugin runtime (no toast API; thrown `parseChapter` errors render `ErrorScreenV2`):
  `lnreader/lnreader` — `src/plugins/pluginManager.ts`, `src/screens/reader/hooks/useChapter.ts`,
  `src/components/ErrorScreenV2/ErrorScreenV2.tsx`
- Website (for the two public JSON routes): <https://tapas.io>
- Community downloaders consulted for the website API shape:
  `TilCreator/Tapas-Comic-Downloader`, `l1m3r/tapas.io-phpDLer`
