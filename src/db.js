import { createEmptyTimeline, normalizeTimeline } from "./timeline.js";

const DB_NAME = "timeline-poc";
const DB_VERSION = 1;
const STORE_NAME = "documents";
const ACTIVE_ID = "active";

export async function loadActiveTimeline() {
  const db = await openDatabase();
  const existing = await requestToPromise(db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(ACTIVE_ID));
  db.close();
  return existing ? normalizeTimeline(existing.timeline) : createEmptyTimeline();
}

export async function saveActiveTimeline(timeline) {
  const db = await openDatabase();
  const document = {
    id: ACTIVE_ID,
    timeline: normalizeTimeline({
      ...timeline,
      updatedAt: new Date().toISOString()
    }),
    savedAt: new Date().toISOString()
  };
  await requestToPromise(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(document));
  db.close();
  return document.timeline;
}

export async function clearActiveTimeline() {
  const db = await openDatabase();
  await requestToPromise(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(ACTIVE_ID));
  db.close();
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
