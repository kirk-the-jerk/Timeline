export const PLAYER_TYPES = [
  {
    value: "simple",
    label: "Simple",
    description: "Basic event-list player.",
    available: true
  },
  {
    value: "timeline",
    label: "Timeline",
    description: "Chart of events over time, with range bars, a date scrubber, search and filters.",
    available: true
  },
  {
    value: "slideshow",
    label: "Slideshow",
    description: "Full-screen slideshow of the photos, with event details, collection title cards and auto-advance.",
    available: true
  },
  {
    value: "map",
    label: "Map",
    description: "Map player placeholder.",
    available: false
  }
];

export const DEFAULT_PLAYER_TYPE = "simple";

// Unfinished players stay listed (so the export dialog can show them as coming
// soon) but never resolve, so a hand-typed ?player= URL or a stale value falls
// back to the default instead of rendering a placeholder.
export function normalizePlayerType(value) {
  return PLAYER_TYPES.some((player) => player.available && player.value === value) ? value : DEFAULT_PLAYER_TYPE;
}

export function getPlayerType(value) {
  return PLAYER_TYPES.find((player) => player.value === normalizePlayerType(value));
}

