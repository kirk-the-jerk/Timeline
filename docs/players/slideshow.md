# Slideshow player

**Status: spec agreed in outline, not implemented.** `available` is still `false` in [../../src/players.js](../../src/players.js).
Rules shared by all players are in [../player-contract.md](../player-contract.md).

**Purpose:** unattended or lightly-attended playback of the timeline's photos with their event details,
meant for a full-screen display. It plays photos only. Everything else in the timeline is ignored.

Items marked **(default)** are my choices where the brief was silent. They are easy to change.

## 1. Shape

The player has two parts:

- **Setup panel.** An ordinary in-page panel, inside the normal page (`player.html`'s nav, or the export's
  header). It shows what will play and the settings, and has a **Play** button.
- **Stage.** A full-viewport overlay (`position: fixed; inset: 0`, black, above everything) created when
  Play is pressed. It has no header. This is what "looks good at fullscreen" applies to. Because it
  covers the page, it doesn't depend on the export's 960px `.shell` column.

**Exit** (Esc or the bar's Exit button) removes the stage and returns to the setup panel. That is also how
a user in `player.html` gets back to the nav to switch players or load another file. **(default)**

## 2. Slides

### 2.1 What plays

- Events, in the order `events` arrives (chronological), that have at least one renderable image. Renderable means `resolveEventImages` returns it and, for embedded images, `canRenderImageMedia` passes.
- Events without renderable images are ignored, and so is everything else in the timeline (types, fields, notes).
- One slide per **image**. Slides for an event's images run in the event's image order.

### 2.2 Collection title cards

Walking the events in order, before an event's first image, add a **title card** for each collection the event
belongs to that hasn't had one yet. If an event is in several new collections, it gets one card for each,
in the order of `timeline.collections`. A collection gets a card only the first time it appears, and only if
one of its events has a renderable image.

A title card is the collection's title in large type, centered on the stage. It stays up for the same delay
as an image. **(default)**

### 2.3 Building the list

```
slides = []
introduced = {}
for event in events with renderable images:
  for collection in event's collections, in timeline order, not in introduced:
    slides.push({ kind: "collection", collection }); introduced.add(collection)
  for (image, index) in event's renderable images:
    slides.push({ kind: "image", event, image, first: index == 0 })
```

This is pure and DOM-free. It lives in its own module, `src/slideshowModel.js`, with a Node test.

## 3. Setup panel

Shown when the player opens.

- **What will play**, from the slides above and not the whole timeline: title; date span (earliest start to latest end among the events that will play); number of photos; number of events; number of collections.
- **Settings**, the same set as the bar (section 5).
- **Play** button, also Space and Enter. **(default)**
- A **Start in full screen** checkbox, on by default. Play is a user gesture, so it may request browser full screen on the stage. **(default)**
- No images to play: the panel says so ("This timeline has no photos to show") and Play is disabled.

## 4. Stage

### 4.1 Image slide

- The image is shown whole (`object-fit: contain`), never cropped.
- Behind it: the same image, scaled to fill, blurred and dimmed, to fill the letterbox. **(default)**
- **Event details** (only on the event's first image slide), overlaid at the **top**: the title, then the date or date range, then the location. Empty parts are left out.
- **Caption** (any image that has one), overlaid at the **bottom**.
- Both overlays sit on a soft gradient so they read on any photo. The playback bar, when open, is drawn above the details.
- Fields and notes are never shown. **(default)**

### 4.2 Details timing

The event details fade in with the slide and fade out again after about 4 seconds, or when the slide ends if
that's sooner. The caption stays for the whole slide. While paused, and while auto-advance is off, both stay
visible. **(default)**

**Show details** off hides the event details and the caption. **(default)**

### 4.3 Transition

A quick dip: the current slide fades out (about 300ms), then the next fades in (about 300ms). A true
crossfade is deferred. The delay counts from when the fade-in finishes. The next image is loaded ahead of time. With
`prefers-reduced-motion`, the swap is instant and the overlays don't animate.

### 4.4 Broken images

A linked image can fail to load. The slide is dropped from the list and playback moves on. The counter shrinks
to match.

## 5. Playback bar

At the top of the stage. Contents, left to right:

| Control | Notes |
|---|---|
| Back to start | First slide (which may be a collection card). |
| Back 1 | |
| Play / pause | Disabled while auto-advance is off. |
| Forward 1 | |
| Forward to end | The last slide. |
| Counter | "12 / 87". Collection cards count. |
| **Show details** | Checkbox. |
| **Auto-advance** | Checkbox. On by default. |
| **Delay** | Whole seconds, 1 to 60, default 5. Disabled (not "invalid") while auto-advance is off. Out-of-range input is clamped when it loses focus. |
| **Loop** | Checkbox. Off by default. |
| **Full screen** | Toggle (pressed while in browser full screen), same as the F key. |
| Exit | Leaves the stage. |

Icons are inline SVG in the same style as the rest of the app, with labels and titles.

### 5.1 State

`paused` and `autoAdvance` are separate. The timer runs only when `autoAdvance && !paused`. Any manual step
restarts the delay. When auto-advance is off the show is effectively manual: the play/pause button is disabled
and the bar counts as paused for visibility (5.2).

### 5.2 Showing and hiding

- **Playing:** the bar is hidden and the mouse cursor hides after it has been idle for a short time.
- **The reveal button:** a small, mostly transparent button at the top-left. It's visible while paused (or auto-advance is off), or for 1 second after the mouse last moved.
- **Opening the bar:** hover or click the reveal button. The bar appears and the button hides.
- **Closing the bar:** 2 seconds after the pointer leaves it, unless focus is inside it.
- **Keyboard:** the bar and reveal button don't have to be reachable by keyboard. The keyboard shortcuts in section 6 cover play/pause, stepping, full screen and details. The bar's controls are ordinary buttons and inputs, so they still work if focused, but nothing is built around it.
- **Touch:** there is no mouse movement, so tapping the stage opens the bar with the same 2-second close. Swipe left or right steps forward or back. Controls need touch-sized targets.

The visibility rules are a small state machine. They should be a DOM-free module driven by an injected clock,
so the timings can be tested in Node.

### 5.3 Reaching the end

- **Loop off:** stop on the last slide (paused). Play then means "start again from the first slide".
- **Loop on:** wrap to the first slide. Collection cards show again on the second pass, since they are slides.
- In manual mode, Forward on the last slide does nothing (or wraps when Loop is on).

## 6. Keyboard

| Key | Action |
|---|---|
| Space | Play / pause. In manual mode (auto-advance off), next slide. **(default)** |
| ← / → | Back 1 / forward 1 |
| Home / End | Back to start / forward to end |
| F | Toggle full screen |
| H | Toggle **Show details** |
| Esc | Leave browser full screen if in it, otherwise exit the stage |

Keys are ignored while a text or number field has focus. The handler is removed when the stage closes.
Keyboard media keys (play/pause, next, previous) are not bound.

## 7. Settings memory

Settings (details, auto-advance, delay, loop, start in full screen) are remembered in `localStorage`, per viewer,
wrapped in try/catch, and the player works without it. **(default)** Author-chosen defaults baked into the
export are a later idea.

## 8. Image quality

Uploaded images are capped at 960px and re-encoded at JPEG q0.72 (see the README). At full screen on a
1080p display that is a 2× upscale, and the letterbox blur (4.1) only hides some of it. Accepted: the
slideshow works with these images as they are, and embedded photos will look soft when stretched. It
would look best with larger ones. **Optional, as a separate change:** raise the cap to 1600px on the long edge at q0.8. I haven't measured the file sizes.
Expect roughly 250–350 KB per photo, so a 100-photo export would be about 35–45 MB. That is a decision
about the whole product and belongs in P5 of [../../todo.md](../../todo.md), not in the slideshow. Linked
images are shown at whatever size they are, so they are the way to get full quality today.

## 9. Changes this needs elsewhere

1. **A teardown hook.** Done: a renderer may return `{ destroy() }`, and `player.js` calls it before it re-renders. The slideshow uses it to remove timers, document-level key listeners, the stage overlay and full-screen state. The timeline player uses it too, which fixed the `timeline-chart-mode` class it used to leave behind.
2. **Register the player:** `PLAYER_RENDERERS`, `available: true`, a real description, its CSS linked in `player.html` and inlined in `htmlExport.js`, its modules in `JS_FILES` (contract, section 4).
3. **Update the contract** for the stage-overlay pattern.

## 10. Not in scope

Video, audio, keyboard media keys, keyboard access to the bar, crossfade, Ken Burns pan and zoom, per-slide durations, a slide list or thumbnail strip, screen wake lock, ZIP
export, editing, fields and notes.

## 11. Tests

- `slideshowModel.js`: slide list building (order, collection cards once each, multi-collection events, events without images, unrenderable images, broken-link removal). Node test.
- Bar visibility state machine with a fake clock. Node test.
- `check_export.mjs`: the export builds and compiles with this player and inlines its styles.
- **By hand, in a browser:** fades, letterbox blur, full screen, Esc handling, the bar and reveal button, tap and swipe, and a real exported file opened from disk.
