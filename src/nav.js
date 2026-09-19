import { DEFAULT_PLAYER_TYPE, PLAYER_TYPES } from "./players.js";

// Turns the page's static "Player" nav link into a split button: the main part
// opens the default player, the caret opens a menu of the available players.
// Without JS the plain link still works. Pass onSelectPlayer to switch players
// in place (the player page does, so a loaded timeline isn't thrown away);
// otherwise the menu items are ordinary links to player.html?player=....
export function initNav({ selectedPlayer = null, onSelectPlayer = null } = {}) {
  const playerLink = document.querySelector('.nav-links a[data-nav="player"]');
  if (!playerLink) {
    return { setSelectedPlayer() {} };
  }

  const split = document.createElement("div");
  split.className = "split-button";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "button split-toggle";
  toggle.setAttribute("aria-label", "Choose player");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "player-menu");
  if (playerLink.hasAttribute("aria-current")) {
    toggle.setAttribute("aria-current", playerLink.getAttribute("aria-current"));
  }

  const menu = document.createElement("div");
  menu.className = "dropdown-panel";
  menu.id = "player-menu";
  menu.hidden = true;

  const items = new Map();
  for (const player of PLAYER_TYPES.filter((candidate) => candidate.available)) {
    const item = document.createElement("a");
    item.href = playerHref(player.value);
    item.textContent = player.label;
    item.title = player.description;
    item.addEventListener("click", (event) => {
      closeMenu();
      if (onSelectPlayer) {
        event.preventDefault();
        onSelectPlayer(player.value);
      }
    });
    items.set(player.value, item);
    menu.append(item);
  }

  playerLink.replaceWith(split);
  split.append(playerLink, toggle, menu);

  if (onSelectPlayer) {
    playerLink.addEventListener("click", (event) => {
      event.preventDefault();
      onSelectPlayer(DEFAULT_PLAYER_TYPE);
    });
  }

  toggle.addEventListener("click", () => {
    if (menu.hidden) {
      openMenu();
    } else {
      closeMenu();
    }
  });
  document.addEventListener("click", (event) => {
    if (!split.contains(event.target)) {
      closeMenu();
    }
  });
  split.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      closeMenu();
      toggle.focus();
    }
  });

  setSelectedPlayer(selectedPlayer);
  return { setSelectedPlayer };

  function openMenu() {
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
  }

  function closeMenu() {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  }

  function setSelectedPlayer(value) {
    for (const [playerValue, item] of items) {
      if (playerValue === value) {
        item.setAttribute("aria-current", "true");
      } else {
        item.removeAttribute("aria-current");
      }
    }
  }
}

function playerHref(playerValue) {
  return playerValue === DEFAULT_PLAYER_TYPE ? "player.html" : `player.html?player=${encodeURIComponent(playerValue)}`;
}
