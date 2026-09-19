# Timeline player

Source: [../../src/timelinePlayer.js](../../src/timelinePlayer.js), with layout maths in
[../../src/timelineLayout.js](../../src/timelineLayout.js) and styles in
[../../src/timelinePlayer.css](../../src/timelinePlayer.css). Rules shared by all players are in
[../player-contract.md](../player-contract.md).

**Purpose:** see the shape of a life or a trip at a glance (what overlaps, what is long, where the gaps
are), then read the detail. It's the Simple player's cards with a chart, a date window and filters on top.

## Behavior

### Regions, top to bottom
1. **Controls.** A search box, then a chip group for event types and one for collections.
2. **Pinned block** (sticks to the top while the cards scroll): the chart, the scrubber, and a status line.
3. **Empty message**, shown only when nothing matches.
4. **Card list.** The same cards as the Simple player, all built once.

### Chart
- Shows the events inside the chosen date window, after search and chips have been applied.
- A **range** event is a bar. A **point** event is a dot. An event is a point if it has no end or its end is not after its start.
- A label sits inside the bar if it fits, otherwise beside it, flipping to the left of the mark near the right edge. Labels are the type emoji (if any) and the title.
- Marks are packed into lanes so they don't overlap. The plot is capped at 26vh (22vh at 760px or narrower) and scrolls inside when there are more lanes.
- The axis has round ticks (hours, days, months or years, whichever gives at most about 3–10 ticks for the width) with a light grid.
- **Clicking a mark** scrolls its card to just below the pinned block and outlines it for 1.6 seconds.
- Hovering shows a tooltip: title and date range. Marks are `<button>`s, so they take keyboard focus.
- It redraws when the plot's width changes.

### Scrubber
- A strip under the chart showing every filtered event across the whole span (searching and chips apply, the window does not).
- Two handles choose the date window, as thousandths of the span. They can't come closer than 10‰. The span is the earliest start to the latest end, padded by 3% (a day either side if all events share one moment).
- Handles are range inputs, so arrow keys work.

### Filters
- **Search.** Every word typed must appear (substring, case-insensitive) somewhere in: title, location, type, displayed date, collection titles, field labels and values, and image captions.
- **Chips.** Event types and collections toggle. None selected means no filtering on that group. Within a group, selecting several means "any of them"; across groups it is "and". Chip counts are the totals for the whole timeline and don't change as other filters do. A group with fewer than 2 options isn't shown.
- **Window.** An event is in the window if its span overlaps it.
- **Undated events** (a date that isn't `YYYY-MM-DD`) aren't drawn and are never hidden by the window. Search and chips still apply.
- The list and the chart use the same result, so the cards always match the marks.

### Status line
"Showing N of M events", plus "between X and Y" when the window is narrowed. It's a polite live region. A **Show everything** button appears when the window is narrowed or any filter is on, and clears all of them.

### Empty cases
- No events at all: "This timeline does not contain any events."
- Filters leave nothing: "No events match. Try widening the dates or clearing the filters."
- No event has a placeable date: no chart or scrubber, only the controls, the status line and the cards.

### Pinning
The pinned block is `position: sticky` and its height is published as `--tl-pin-height`, so scrolled-to cards
stop below it. When the window is 560px tall or less the block is not pinned.

## Not in scope
Selecting an event to show a detail view, stepping through events, highlighting the chart as the list scrolls
(see [../../todo.md](../../todo.md), P4), zooming with the wheel, editing.

## Open questions
- Chip counts ignoring the other filters can promise events that then don't show. Should they follow the current search and window?
- Time zones are ignored for placing marks (wall-clock as UTC). Fine for a life timeline, wrong for a trip that crosses zones. Is that acceptable?
- The status region announces on every keystroke in the search box. That may be noisy for a screen reader.
- Is the smooth scroll on click something reduced-motion users should be spared?

## Tests
`scripts/check_timeline_layout.mjs` covers the DOM-free maths: spans, domain, window, overlap, search, lane packing
and ticks. `check_export.mjs` checks only that the export builds and compiles with this player. **Not
automated:** the DOM, sticky pinning, scrubber dragging, chart redraw and click-to-scroll. These were checked by hand in Edge.
