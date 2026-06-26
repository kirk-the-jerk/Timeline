# AGENTS.md

## Project

Timeline POC is a dependency-free, local-first scrapbook/timeline prototype.

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

Before finishing JavaScript changes, run:

```sh
python scripts/check_js.py
```

## Conventions

- Keep the app dependency-free unless explicitly asked otherwise.
- Preserve schema compatibility in `src/timeline.js`.
- Avoid committing exported timelines, private data, browser downloads, or large media files.
- Prefer focused changes over broad refactors.
- Browser IndexedDB behavior should be tested through a local server, not direct file opens.
