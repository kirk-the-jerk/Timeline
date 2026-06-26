import { createEmptyTimeline, normalizeTimeline } from "./timeline.js";

const DB_NAME = "timeline-poc";
const DB_VERSION = 2;
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
  const storedMedia = media
    .filter((item) => item.timelineId === ACTIVE_ID)
    .map(removeStoreMetadata);
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

  const transaction = db.transaction([DOCUMENT_STORE, MEDIA_STORE], "readwrite");
  const documentStore = transaction.objectStore(DOCUMENT_STORE);
  const mediaStore = transaction.objectStore(MEDIA_STORE);
  await requestToPromise(documentStore.put(document));

  const existingMedia = await requestToPromise(mediaStore.getAll());
  const keepIds = new Set(safeTimeline.media.map((item) => item.id));
  for (const item of existingMedia) {
    if (item.timelineId === ACTIVE_ID && !keepIds.has(item.id)) {
      await requestToPromise(mediaStore.delete(item.id));
    }
  }

  for (const item of safeTimeline.media) {
    await requestToPromise(mediaStore.put({
      ...item,
      timelineId: ACTIVE_ID
    }));
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

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENT_STORE)) {
        db.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        db.createObjectStore(MEDIA_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function removeStoreMetadata(item) {
  const { timelineId, ...media } = item;
  return media;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
