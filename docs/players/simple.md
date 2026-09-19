# Simple player

Source: `renderSimplePlayer` in [../../src/playerRenderers.js](../../src/playerRenderers.js) and
`renderEventListItem` in [../../src/eventCard.js](../../src/eventCard.js). Rules shared by all players are in
[../player-contract.md](../player-contract.md).

**Purpose:** the reference view. Every event, in date order, with everything the event holds. It's the
default player, and the one that has to keep working when nothing else does.

## Behavior

### Layout
- A vertical list of event cards in the order `events` arrives (wall-clock ascending, then title).
- Each row has a right-aligned date on the left, a vertical line with a dot in the gutter, and the card on the right.
- At 760px wide or less the line and dots go away and the date stacks above the card, left-aligned.
- The list is the whole page. There is no chart, header controls or pagination.

### The card
In order:

1. **Gallery** (if the event has renderable images). A grid of up to 4 images, in 2 columns. One image spans the full width. Each is a 4:3 crop (`object-fit: cover`). An icon marks it as embedded or linked. The caption, if any, shows under the image. If there are more than 4 images, the 4th shows a `+N` badge.
2. **Title.** `Untitled event` if empty.
3. **Meta line.** Event type (emoji and label), then collection titles, then location, joined by ` / `. Empty parts are left out.
4. **Fields.** A label and value list of the fields that have a value. Blank fields are left out.

The date column shows the start date, or `start – end` for a range. Time is shown only if it isn't `00:00`. The time zone is never shown.

### Empty timeline
"This timeline does not contain any events."

### Images
Embedded images render only if they are JPEG data URLs. Linked images render only for `http(s)` URLs. Anything
else is dropped without a message. Images can't be clicked or enlarged.

## Not in scope
Search, filtering, grouping, collapsing, deep links, keyboard shortcuts.

## Open questions
- **Images past the fourth can't be reached.** The `+N` badge counts them but there is no way to see them in this player. Either a lightbox, or a rule that the Simple player shows all of them.
- Should a card with a range show its duration, or is `start – end` enough?
- An event whose date isn't `YYYY-MM-DD` is kept as written and sorted as text, so it can land anywhere. Should undated or unparseable events be grouped at the end instead?

## Tests
No Node test covers the Simple player. `check_export.mjs` renders it against a stub DOM and asserts:
order, title escaping, embedded and linked images, and range text.
