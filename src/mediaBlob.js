// Conversion between the data URLs used in timeline JSON and the Blobs that
// IndexedDB stores natively (about a quarter smaller than base64 text). Only base64 data URLs are
// handled; anything else returns null and stays as a data URL.

const BASE64_DATA_URL_PATTERN = /^data:([^;,]+);base64,/;

export function dataUrlToBlob(dataUrl) {
  const match = BASE64_DATA_URL_PATTERN.exec(dataUrl);
  if (!match) return null;
  let binary;
  try {
    binary = atob(dataUrl.slice(match[0].length));
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: match[1] });
}

export async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}
