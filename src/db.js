import { blobToDataUrl, dataUrlToBlob } from "./mediaBlob.js";
import { createEmptyTimeline, normalizeTimeline } from "./timeline.js";

const DB_NAME = "timeline-poc";
const DB_VERSION = 3;
const DOCUMENT_STORE = "documents";
const MEDIA_STORE = "media";
const ACTIVE_ID = "active";

export async function loadActiveTimeline() {
  const db = await openDatabase();
  const transaction = db.transaction([DOCUMENT_STORE, MEDIA_STORE], "readonly");
  const existing = await requestToPromise(transaction.objectStore(DOCUMENT_STORE).get(ACTIVE_ID));
  const media = await requestToPromise(transaction.objectStore(MEDIA_STORE).getAll());
  db.close();
  if (!existing) return createEmptyTimeline();
  const storedMedia = await Promise.all(media
    .filter((item) => item.timelineId === ACTIVE_ID)
    .map(rowToMedia));
  return normalizeTimeline({
    ...existing.timeline,
    media: [
      ...(Array.isArray(existing.timeline.media) ? existing.timeline.media : []),
      ...storedMedia
    ]
  });
}

export async function saveActiveTimeline(timeline) {
  const db = await openDatabase();
  const safeTimeline = normalizeTimeline({
    ...timeline,
    updatedAt: new Date().toISOString()
  });
  const document = {
    id: ACTIVE_ID,
    timeline: {
      ...safeTimeline,
      media: []
    },
    savedAt: new Date().toISOString()
  };

  // Built before the transaction opens: awaiting non-IndexedDB work inside one
  // would let it auto-commit.
  const rows = safeTimeline.media.map(mediaToRow);

  const transaction = db.transaction([DOCUMENT_STORE, MEDIA_STORE], "readwrite");
  const documentStore = transaction.objectStore(DOCUMENT_STORE);
  const mediaStore = transaction.objectStore(MEDIA_STORE);
  await requestToPromise(documentStore.put(document));

  const existingMedia = await requestToPromise(mediaStore.getAll());
  const existingById = new Map(existingMedia
    .filter((item) => item.timelineId === ACTIVE_ID)
    .map((item) => [item.id, item]));
  const keepIds = new Set(rows.map((row) => row.id));
  for (const id of existingById.keys()) {
    if (!keepIds.has(id)) {
      await requestToPromise(mediaStore.delete(id));
    }
  }

  for (const row of rows) {
    if (isSameRow(existingById.get(row.id), row)) continue;
    await requestToPromise(mediaStore.put(row));
  }

  db.close();
  return safeTimeline;
}

export async function clearActiveTimeline() {
  const db = await openDatabase();
  const transaction = db.transaction([DOCUMENT_STORE, MEDIA_STORE], "readwrite");
  await requestToPromise(transaction.objectStore(DOCUMENT_STORE).delete(ACTIVE_ID));
  const mediaStore = transaction.objectStore(MEDIA_STORE);
  const existingMedia = await requestToPromise(mediaStore.getAll());
  for (const item of existingMedia) {
    if (item.timelineId === ACTIVE_ID) {
      await requestToPromise(mediaStore.delete(item.id));
    }
  }
  db.close();
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENT_STORE)) {
        db.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        db.createObjectStore(MEDIA_STORE, { keyPath: "id" });
      }
      if (event.oldVersion > 0 && event.oldVersion < 3) {
        convertStoredMediaToBlobs(request.transaction.objectStore(MEDIA_STORE));
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Rows written before version 3 hold the data URL as text; rewrite them as Blobs.
function convertStoredMediaToBlobs(mediaStore) {
  mediaStore.openCursor().onsuccess = (event) => {
    const cursor = event.target.result;
    if (!cursor) return;
    if (typeof cursor.value.dataUrl === "string") {
      const row = mediaToRow(cursor.value);
      if (row.blob) cursor.update(row);
    }
    cursor.continue();
  };
}

// Stored media keeps its bytes as a Blob in place of the dataUrl text.
function mediaToRow(item) {
  const { dataUrl, ...rest } = item;
  const blob = typeof dataUrl === "string" ? dataUrlToBlob(dataUrl) : null;
  return blob
    ? { ...rest, blob, timelineId: ACTIVE_ID }
    : { ...item, timelineId: ACTIVE_ID };
}

async function rowToMedia(row) {
  const { timelineId, blob, ...media } = row;
  return blob ? { ...media, dataUrl: await blobToDataUrl(blob) } : media;
}

// Media ids are UUIDs, so a row with the same id, byte size and metadata is
// already stored and need not be rewritten on every save.
function isSameRow(existing, row) {
  if (!existing || !existing.blob || !row.blob) return false;
  if (existing.blob.size !== row.blob.size || existing.blob.type !== row.blob.type) return false;
  const { blob: existingBlob, ...existingRest } = existing;
  const { blob: rowBlob, ...rowRest } = row;
  return JSON.stringify(sortKeys(existingRest)) === JSON.stringify(sortKeys(rowRest));
}

function sortKeys(value) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
