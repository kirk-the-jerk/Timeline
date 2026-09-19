// "Look up missing coordinates" for a timeline made before events had `geo`
// (docs/players/map.md, section 1.4). No DOM: the dialog drives it and the Node
// test runs it with a fake geocoder.
//
// Events go through the same geocoder as the editor's single lookup, so the
// queue's rate limit and the cache apply. Only an event with a location and no
// `geo` is touched.

// A run stops after this many failures in a row (service unreachable), so an
// offline editor doesn't wait out a timeout for every event.
export const BATCH_FAILURE_LIMIT = 3;

export function eventsMissingCoordinates(events) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => !event?.geo && String(event?.location ?? "").trim());
}

// `geocoder.geocode(query)` is the interface from geocode.js. `isCancelled` is
// checked before each event, and again after a lookup returns, so Cancel stops
// at the next event boundary and keeps what has been found.
//
// Resolves to:
// - `matched`: `{ id, title, location, label, lat, lng, others }` per event that
//   got a top match (`others` counts the matches not used).
// - `notFound`: `{ id, title, location }` where the service answered with no match.
// - `failed`: `{ id, title, location }` where no service could be reached.
// - `notTried`: the events left when the run was cancelled or gave up.
// - `cancelled` / `gaveUp`: why it ended early, if it did.
export async function lookUpMissingCoordinates({
  events,
  geocoder,
  onProgress = () => {},
  isCancelled = () => false,
  failureLimit = BATCH_FAILURE_LIMIT
}) {
  const targets = eventsMissingCoordinates(events);
  const result = { matched: [], notFound: [], failed: [], notTried: [], cancelled: false, gaveUp: false };
  let consecutiveFailures = 0;

  for (let index = 0; index < targets.length; index += 1) {
    const event = targets[index];
    if (isCancelled()) {
      result.cancelled = true;
      result.notTried = targets.slice(index).map(describe);
      break;
    }
    if (consecutiveFailures >= failureLimit) {
      result.gaveUp = true;
      result.notTried = targets.slice(index).map(describe);
      break;
    }

    onProgress({ done: index, total: targets.length, event });
    let matches;
    try {
      matches = await geocoder.geocode(event.location);
    } catch {
      consecutiveFailures += 1;
      result.failed.push(describe(event));
      continue;
    }
    consecutiveFailures = 0;

    if (matches.length === 0) {
      result.notFound.push(describe(event));
    } else {
      const [top] = matches;
      result.matched.push({ ...describe(event), label: top.label, lat: top.lat, lng: top.lng, others: matches.length - 1 });
    }
  }

  onProgress({ done: targets.length - result.notTried.length, total: targets.length, event: null });
  return result;
}

function describe(event) {
  return { id: event.id, title: event.title || "", location: String(event.location).trim() };
}
