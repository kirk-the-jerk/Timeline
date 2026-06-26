# Timeline POC

A small local-first proof of concept for a private scrapbook/timeline product.

This prototype is intentionally dependency-free:

- `index.html` is the product page.
- `editor.html` creates, imports, exports, and locally saves a simple timeline.
- `player.html` opens a timeline JSON file and displays its events.
- `src/db.js` stores the active editor draft in IndexedDB.
- `src/timeline.js` defines the shared timeline JSON shape.

## Run Locally

From this folder:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8000/
```

The editor uses browser IndexedDB, so it is best to run through a local server instead of opening the files directly.

## Basic Test Flow

1. Open `http://127.0.0.1:8000/editor.html`.
2. Add a few dummy events.
3. Click **Save to JSON** for an editable backup/debug file.
4. Click **Save to HTML** for a standalone timeline viewer that embeds the player and timeline data.
5. Open `http://127.0.0.1:8000/player.html`.
6. Pick or drop the exported `.timeline.json` file.

The exported `.timeline.html` file can be opened directly in a browser. It contains its own CSS, player script, timeline JSON, and any embedded low-resolution JPEG images.

## JSON Shape

```json
{
  "format": "local-timeline-poc",
  "version": 2,
  "title": "Untitled timeline",
  "updatedAt": "2026-06-25T00:00:00.000Z",
  "events": [
    {
      "id": "uuid",
      "type": "job",
      "title": "Started a new project",
      "timestamp": {
        "date": "2026-06-25",
        "time": "09:00",
        "tz": "America/Vancouver"
      },
      "location": "Vancouver, BC",
      "image": {
        "id": "uuid",
        "mimeType": "image/jpeg",
        "dataUrl": "data:image/jpeg;base64,...",
        "width": 960,
        "height": 640,
        "originalName": "photo.jpg",
        "encodedAt": "2026-06-25T00:00:00.000Z"
      },
      "imageLink": "https://example.com/photo.jpg",
      "fields": [
        {
          "id": "uuid",
          "key": "role",
          "label": "Role",
          "type": "text",
          "value": "Lead developer"
        }
      ]
    }
  ]
}
```

## VS Code Debugging

Use the built-in terminal to run the local server, then debug in your normal browser with DevTools.

For IndexedDB inspection in Chrome or Edge:

1. Open DevTools.
2. Go to **Application**.
3. Open **Storage > IndexedDB**.
4. Look for the `timeline-poc` database.

## GitHub From VS Code

Recommended first-time flow:

1. Install Git for Windows if VS Code does not detect Git.
2. Sign in to GitHub from VS Code using the Accounts icon in the lower-left corner.
3. Open the Source Control panel.
4. Review changed files before committing.
5. Write a short commit message, for example `Initial timeline proof of concept`.
6. Click **Commit**.
7. Use **Publish Branch** to create the GitHub repository.

Avoid committing browser downloads, exported timelines with private data, or large media files unless you intend to share them.
