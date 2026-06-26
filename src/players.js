export const PLAYER_TYPES = [
  {
    value: "simple",
    label: "Simple",
    description: "Basic event-list player."
  },
  {
    value: "timeline",
    label: "Timeline",
    description: "Timeline player placeholder."
  },
  {
    value: "slideshow",
    label: "Slideshow",
    description: "Slideshow player placeholder."
  },
  {
    value: "map",
    label: "Map",
    description: "Map player placeholder."
  }
];

export const DEFAULT_PLAYER_TYPE = "simple";

export function normalizePlayerType(value) {
  return PLAYER_TYPES.some((player) => player.value === value) ? value : DEFAULT_PLAYER_TYPE;
}

export function getPlayerType(value) {
  return PLAYER_TYPES.find((player) => player.value === normalizePlayerType(value));
}

