# AGENTS.md

## Project

Timeline is a dependency-free, local-first scrapbook/timeline tool.

## Run

Use a local server:

```sh
python scripts/dev_server.py --restart
```

or:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/`.

## Check

Before finishing JavaScript or schema changes, run:

```sh
python scripts/check_js.py
```

This performs JavaScript syntax checks and schema compatibility fixture tests.

## Conventions

- Keep the app dependency-free unless explicitly asked otherwise.
- Preserve schema compatibility in `src/timeline.js`.
- Avoid committing exported timelines, private data, browser downloads, or large media files.
- Prefer focused changes over broad refactors.
- Browser IndexedDB behavior should be tested through a local server, not direct file opens.
- Player or standalone-export changes: read `docs/player-contract.md` first, and keep it and the matching `docs/players/*.md` in step with the code.
