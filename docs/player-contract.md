# Player contract

What every player, and the standalone export that carries it, must do. Per-player behavior lives in
[players/](players/). Schema and JSON shape live in [../README.md](../README.md).

Status as of schema v10 and the Map player (without its tour). Sections say **Must** for a rule new work has to keep, and **As built** for
what the code does today. **Gap** marks somewhere the two differ, or where nothing has been decided.

## 1. The product promise

The artifact is one `.timeline.html` file that:

- opens in a browser by double-click (`file://`), with no server, account or install;
- needs no network to render, apart from images the author chose to link, and map tiles when the author chose the Map player (see 2.6 and 3.2);
- contains everything: the timeline data, the player code and the styles;
- can be loaded back into the app, losslessly.

Everything below serves that. A feature that only works from a server, or that needs a network
request to render, breaks the promise. The one deliberate exception is the Map player, whose tiles
come from a tile server: the author accepts that by choosing it. A player that needs the network must
still degrade to something usable without it (the map shows its dots, lines and panels on a plain
background).

## 2. The standalone export

### 2.1 What the file contains

Built by `buildStandaloneHtml` in [../src/htmlExport.js](../src/htmlExport.js):

| Part | Element | Notes |
|---|---|---|
| Timeline data | `<script type="application/json" id="timeline-data">` | The full normalized timeline, including `media[]`. Every `<` is written as the JSON escape for U+003C, so data can't close the `<script>` tag. |
| Player choice | `<script type="application/json" id="player-data">` | The player descriptor from `players.js` (`value`, `label`, ...). |
| Styles | one `<style>` | `standaloneCss()` plus each player's CSS file ([../src/timelinePlayer.css](../src/timelinePlayer.css), [../src/slideshowPlayer.css](../src/slideshowPlayer.css), [../src/mapPlayer.css](../src/mapPlayer.css)), listed in `PLAYER_CSS_URLS`. |
| Vendored library | one classic `<script>`, before the runtime | **Map player only.** Leaflet (`vendor/leaflet/leaflet.js`), with its stylesheet ahead of the other styles. See 3.6. |
| Runtime | one classic `<script>` | [../src/exportRuntime.js](../src/exportRuntime.js) and its imports, bundled by [../src/exportBundle.js](../src/exportBundle.js). |

**Must:**
- Contain no external script, stylesheet, font or image URL that the author didn't choose (linked images excepted; map tiles are requested at run time, not written into the file).
- Render from the embedded data alone. Nothing may be fetched, apart from the map tiles the Map player asks its library for (3.2).
- Keep `#timeline-data` and `#timeline-title` / `#timeline-summary` / `#timeline` as the ids the runtime and the importer rely on.

### 2.2 Round trip

`player.html` and the editor load a `.timeline.html` file by reading `#timeline-data`
([../src/fileLoad.js](../src/fileLoad.js)). **Must:** the embedded timeline normalizes back to the
exported one unchanged. [../scripts/check_export.mjs](../scripts/check_export.mjs) enforces this.

Loading a file restores the timeline only. The `#player-data` choice is ignored, so `player.html` shows
whichever player its own `?player=` URL selects.

### 2.3 Page chrome

The export page is `.shell` (a 960px-wide centered column) with a header (eyebrow, `<h1>` title, summary line)
and the `#timeline` container. It has no nav, no load button, no player switcher and no persisted state.

A player that wants the whole viewport (the slideshow) doesn't need the page's help: it builds a
`position: fixed; inset: 0` overlay and appends it to `<body>`, which covers `.shell`, the header and
(in `player.html`) the nav. See 3.2.

### 2.4 Failure behavior

If the embedded data can't be parsed or normalized, the title becomes "Could not show this timeline" and
the summary shows the error message. An unknown or unavailable player value falls back to Simple
(`normalizePlayerType`). A missing player choice is an error, not a fallback.

### 2.5 What the author controls at export time

From the save dialog ([../src/editor.js](../src/editor.js), `getExportTimeline`):

- **Title.** Overrides the timeline title in the file.
- **Player.** One of the players marked `available`.
- **Scope.** All events, selected collections (events in them, with `collectionIds` and `collections[]`
  cut down to the selection), or selected event types (events of those types, with `eventTypes[]` cut
  down and `hiddenEventTypes[]` set).
- **Format.** JSON or single-file HTML. No ZIP.

The viewer of the exported file gets no control over any of this.

### 2.6 Linked images

Linked images (`kind: "link"`) are kept as bare URLs. Opening the file loads them from their hosts.
The save dialog warns about this, naming the hosts. Uploaded images are embedded as JPEG data URLs
(see the README for the size cap). **Gap:** when Map is chosen the dialog should also name the tile hosts
(`tile.openstreetmap.org`, `server.arcgisonline.com`). It doesn't yet.

## 3. Renderer contract

### 3.1 Signature

```js
renderer({ container, timeline, events, player })
```

Registered in `PLAYER_RENDERERS` ([../src/playerRenderers.js](../src/playerRenderers.js)) and listed in
`PLAYER_TYPES` ([../src/players.js](../src/players.js)).

| Input | Meaning |
|---|---|
| `container` | The `#timeline` element, empty, with class `timeline`. In `player.html` it sits in a padded panel. In an export it is a direct child of the `.shell` column. |
| `timeline` | The normalized timeline document. Read-only. Use it for `media`, `eventTypes`, `collections`. |
| `events` | `timeline.events` sorted by `sortEvents`: wall-clock date and time ascending, then title. Read-only. |
| `player` | The player descriptor (`value`, `label`, `description`, `available`). |

The host, not the player, sets the page's title and summary line and the browser tab title (`document.title`, the
timeline's title). `player.html` restores its own title when it has no timeline loaded. A player never sets these,
so every player gets them.

A renderer may return `{ destroy() }`. `renderPlayer` always returns a handle (an empty one if the renderer
returned nothing), so callers can call `destroy()` without checking. `player.html` destroys the current view
before it renders again on the same container, whether for a new file, a player switch or the empty state.
The export renders once and never destroys.

### 3.2 Must

- **Handle an empty timeline.** `events.length === 0` shows the "This timeline does not contain any events." empty state.
- **Escape every user string.** Use `escapeHtml` from [../src/eventCard.js](../src/eventCard.js) for anything put into `innerHTML`. Titles, locations, field values, captions and collection names are all user text.
- **Take images only from `resolveEventImages`, filtered by `canRenderImageMedia` for embedded ones.** That is what keeps `javascript:` and non-JPEG sources out. Skip an image that fails the check, silently.
- **Not mutate** `timeline` or `events`.
- **Not touch the network.** One exception: the Map player's tiles, only through the vendored map library and only from the source list in [../src/mapTiles.js](../src/mapTiles.js). The player never geocodes.
- **Work without a frame around it.** The same code runs in `player.html` as an ES module and in the export as one classic script. A player must not assume nav, the load dialog or a particular container width.
- **Clean up after itself.** `player.html` calls the renderer again on the same container when the player is switched or a new file is loaded, after clearing the container's children. Anything the renderer set up beyond those children must be undone in `destroy()`: classes added to `container`, observers, timers, listeners on `document` or `window`, and elements appended elsewhere in the page.
- **Own anything it puts outside `container`.** The slideshow's stage is a full-viewport overlay appended to `<body>`. It, its document listeners and any page-level class (`ss-lock` on `<html>`) are removed by `destroy()`. It also must give the user a way back out (Exit, Esc), since it hides the page's own controls.
- **Guard browser features it can do without.** `ResizeObserver` and `scrollIntoView` are already used behind `typeof` or `?.` checks. Do the same for anything newer.

### 3.3 Bundler constraints

The export bundler is deliberately small and rejects what it doesn't understand, rather than emitting a broken file:

- Imports are `import { a, b } from "./x.js"`, relative, with the `.js` extension. No default or namespace imports.
- Exports are `export function`, `export const`, `export let` or `export class`. No `export default`, no `export { }`, no `export *`.
- Top-level names must be unique across all bundled modules, because the modules are concatenated into one scope.
- Cost: no tree-shaking. Every export carries all of `timeline.js` (about 48 KB of script).

### 3.4 Styling

- Style with the shared custom properties: `--bg`, `--panel`, `--text`, `--muted`, `--line`, `--accent`. `--accent-dark`, `--panel-soft` and `--tl-pin-bg` are optional and used with fallbacks.
- Put a player's CSS in its own file next to its module (see `timelinePlayer.css`). `player.html` links it and the export inlines every file in `PLAYER_CSS_URLS` (`htmlExport.js`), so a new file needs a `<link>` in `player.html` and an entry in that list.
- The event card (`renderEventListItem`) is styled by `styles.css` in the app and by the hand-written `standaloneCss()` in the export. **Gap:** these are two copies. A new card class has to be added to both.

### 3.5 Availability

A player with `available: false` shows as "coming soon" in the export dialog, is missing from the nav menu, and
can't be selected by URL. Flip it to `true` when the renderer works.

### 3.6 Vendored libraries

A player may depend on a third-party library only if all of this holds:

- It is copied into `vendor/<name>/` at a pinned version, with its licence, and nothing is loaded from a CDN.
- It is a classic script (not an ES module), so it stays out of the bundler. `player.html` loads it with a
  `<script>` tag; the export inlines it in its own `<script>` block ahead of the runtime, and its CSS in the
  `<style>`, **only when that player is chosen**, so other exports don't grow.
- The exporter escapes `</script` in the library text, and drops every `url()` from the inlined CSS, so the file
  carries no reference to a file it doesn't contain. `check_export.mjs` asserts both.
- The player reaches it as a global and copes with it being missing (the Map says "The map library didn't load").
- It is left out of the `check_js.py` syntax check.

Today that is Leaflet 1.9.4 for the Map player.

## 4. Adding a player

1. Add the renderer module and register it in `PLAYER_RENDERERS`.
2. Flip `available` in `PLAYER_TYPES`. Update the description.
3. Add its CSS file, link it in `player.html`, and add it to `PLAYER_CSS_URLS` in `htmlExport.js`.
4. Add the module to `JS_FILES` in [../scripts/check_js.py](../scripts/check_js.py).
5. Put DOM-free logic (layout, selection, stepping) in its own module and give it a Node test, as `timelineLayout.js` does.
6. Extend `check_export.mjs`: the export builds with the new player, its styles are inlined and the runtime compiles.
7. Write `docs/players/<name>.md` before or with the code.
8. Try it in a browser: `player.html` with a loaded file, and an exported file opened from disk.

## 5. Cross-cutting behavior, as built

| Concern | State |
|---|---|
| Works from `file://` | Yes, by design. |
| Keyboard | Simple and Timeline: native controls only. Slideshow: Space, arrows, Home/End, F, H and Esc (see its spec). Map: arrows, L, D, F and Esc (see its spec). |
| Screen readers | The timeline player has a live status region. Otherwise unspecified. |
| Reduced motion | Slideshow: no fades or transitions. Map: the camera jumps instead of flying. The timeline player still scrolls smoothly on mark click. |
| Dark mode | None. The export forces `color-scheme: light`. |
| Print | No `@media print` rules anywhere. |
| Mobile | One breakpoint at 760px (the date column stacks above the card). Otherwise the app's layout is desktop-shaped. The slideshow stage handles tap and swipe. The map's flyouts become full-width sheets, one at a time. |
| Time zones | Shown neither in the card date nor on the chart. Ordering is by wall-clock text. See 6. |

**Gap:** none of these has been set as a requirement across players. The slideshow answered keyboard, motion
and full screen for itself. Print is still open.

## 6. Time handling

Events are ordered by their date and time as written, not by absolute instant. The time zone is only a
tie-breaker for identical date and time. Displayed dates leave out the time zone and leave out `00:00`.
The timeline player also reads wall-clock time as UTC when placing events. All players inherit this.

An event with no date gets today's date when the file is loaded. A date that isn't `YYYY-MM-DD` is kept
as written, sorts as text, and can't be placed by the timeline player.

## 7. Verification

- `python scripts/check_js.py`: syntax of every module, schema fixtures, the export round trip,
  the media Blob round trip and the timeline layout maths.
- `renderPlayer`'s handle behavior is tested in `check_export.mjs`. That the timeline player's `destroy`
  really removes its class and observers is not, since it needs a real DOM.
- **Not automated:** anything that needs a real DOM (player behavior, layout, keyboard, scroll) and
  IndexedDB. These were checked by hand in Edge.

## 8. Known gaps

- `standaloneCss()` duplicates part of `styles.css` by hand.
- The export doesn't remember which player it was made with when it is re-imported (2.2).
