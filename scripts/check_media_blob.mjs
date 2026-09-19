import assert from "node:assert/strict";
import { blobToDataUrl, dataUrlToBlob } from "../src/mediaBlob.js";

// Bytes covering every value 0-255, including the ones that break naive text handling.
const bytes = Uint8Array.from({ length: 256 * 300 }, (_, index) => index % 256);
const dataUrl = `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;

const blob = dataUrlToBlob(dataUrl);
assert.equal(blob.type, "image/jpeg");
assert.equal(blob.size, bytes.length);
assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);

// Round trip is exact, including a payload larger than one encoding chunk.
assert.equal(await blobToDataUrl(blob), dataUrl);

// Anything that isn't a base64 data URL is left alone by the caller.
assert.equal(dataUrlToBlob(""), null);
assert.equal(dataUrlToBlob("https://example.com/a.jpg"), null);
assert.equal(dataUrlToBlob("data:text/plain,hello"), null);
assert.equal(dataUrlToBlob("data:image/jpeg;base64,***not base64***"), null);

console.log("OK media blob round trip");
