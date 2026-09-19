// When the slideshow's controls are visible: a small reveal button at the corner
// and the playback bar it opens. Time is injected, so the rules can be tested in
// Node. See "Showing and hiding" in docs/players/slideshow.md.
//
//  - While the show runs, controls are hidden and the cursor hides once the mouse
//    has been still for `cursorMs`.
//  - The reveal button shows while paused, or for `buttonMs` after the mouse moved.
//  - Opening the bar (hover or click on the button, or a tap) hides the button.
//  - The bar closes `barMs` after the pointer leaves it.
//
// Callers ask `update()` for the current state, apply it, then schedule another
// `update()` after `nextChangeIn()` milliseconds.

export function createChromeState({ now = () => Date.now(), buttonMs = 1000, barMs = 2000, cursorMs = 2000 } = {}) {
  let paused = true;
  let lastMove = -Infinity;
  let barOpen = false;
  let pointerInBar = false;
  let leftAt = 0;

  return {
    // True whenever the show isn't advancing by itself (paused, or manual mode).
    setPaused(value) {
      paused = Boolean(value);
    },
    pointerMoved() {
      lastMove = now();
    },
    // `pointerInside` is true when it opened because the pointer is on the reveal
    // button, which sits inside the bar's area, so the pointer starts out "in" it.
    openBar({ pointerInside = false } = {}) {
      barOpen = true;
      pointerInBar = pointerInside;
      leftAt = now();
    },
    closeBar() {
      barOpen = false;
      pointerInBar = false;
    },
    toggleBar() {
      if (barOpen) this.closeBar();
      else this.openBar();
    },
    barEntered() {
      if (barOpen) pointerInBar = true;
    },
    barLeft() {
      if (!barOpen || !pointerInBar) return;
      pointerInBar = false;
      leftAt = now();
    },
    update() {
      if (barOpen && !pointerInBar && now() - leftAt >= barMs) barOpen = false;
      const idle = now() - lastMove;
      return {
        barOpen,
        buttonVisible: !barOpen && (paused || idle < buttonMs),
        cursorHidden: !paused && !barOpen && idle >= cursorMs
      };
    },
    // Milliseconds until the state could change by itself, or null if it can't.
    nextChangeIn() {
      const time = now();
      const deadlines = [];
      if (barOpen && !pointerInBar) deadlines.push(leftAt + barMs);
      if (!barOpen && !paused) deadlines.push(lastMove + buttonMs, lastMove + cursorMs);
      const waits = deadlines.filter((deadline) => deadline > time).map((deadline) => deadline - time);
      return waits.length > 0 ? Math.min(...waits) : null;
    }
  };
}
