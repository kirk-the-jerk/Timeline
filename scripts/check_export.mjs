import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { bundleModules } from "../src/exportBundle.js";
import {
  EXPORT_RUNTIME_URL,
  LEAFLET_CSS_URL,
  LEAFLET_JS_URL,
  PLAYER_CSS_URLS,
  buildStandaloneHtml,
  escapeScriptText,
  stripCssUrls
} from "../src/htmlExport.js";
import { PLAYER_RENDERERS, renderPlayer } from "../src/playerRenderers.js";
import { normalizeTimeline } from "../src/timeline.js";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const readFromDisk = async (url) => readFileSync(fileURLToPath(url), "utf8");

async function main() {
  await checkExportRoundTrip();
  await checkTimelinePlayerExport();
  await checkMapExport();
  await checkBundlerRejectsUnsafeInput();
  checkRendererHandle();
  console.log("OK export runtime");
}

// renderPlayer always hands back something destroyable, and passes through a
// renderer's own destroy, so the player page can undo a view before the next.
function checkRendererHandle() {
  const document = makeStubDocument({});
  const container = document.get("timeline");
  const player = { value: "simple" };

  const plain = renderPlayer({ container, timeline: makeTimeline(), events: [], player });
  assert.equal(typeof plain.destroy, "function", "a renderer that returns nothing still gets a handle");
  assert.doesNotThrow(() => plain.destroy());

  let destroyed = 0;
  PLAYER_RENDERERS.test = () => ({ destroy: () => { destroyed += 1; } });
  try {
    const view = renderPlayer({ container, timeline: makeTimeline(), events: [], player: { value: "test" } });
    view.destroy();
    assert.equal(destroyed, 1, "the renderer's own destroy is the one returned");
  } finally {
    delete PLAYER_RENDERERS.test;
  }
}

// The exported file is the product's shareability promise, so this checks the
// whole path: build the HTML, parse the inlined script (the syntax check that
// `node --check` cannot do for a template string), run it against a stub DOM,
// and read the embedded data back the way an importer would.
async function checkExportRoundTrip() {
  const timeline = makeTimeline();
  const runtime = await bundleModules(EXPORT_RUNTIME_URL, readFromDisk);
  const html = buildStandaloneHtml(timeline, "simple", runtime);

  const scripts = [...html.matchAll(/<script(?: type="application\/json" id="([^"]+)")?>([\s\S]*?)<\/script>/g)];
  const byId = Object.fromEntries(scripts.filter((match) => match[1]).map((match) => [match[1], match[2]]));
  const runtimeSource = scripts.find((match) => !match[1])[2];

  const imported = normalizeTimeline(JSON.parse(byId["timeline-data"]));
  assert.deepEqual(imported, timeline, "embedded timeline must survive export then import unchanged");
  assert.equal(JSON.parse(byId["player-data"]).value, "simple");

  assert.doesNotThrow(() => new vm.Script(runtimeSource, { filename: "export-runtime.js" }), "export runtime must be valid JavaScript");

  const document = makeStubDocument(byId);
  vm.runInNewContext(runtimeSource, { document, URL });

  assert.equal(document.get("timeline-title").textContent, timeline.title);
  assert.equal(document.title, timeline.title, "the browser tab takes the timeline's name");
  assert.equal(document.get("timeline-summary").textContent, `Simple player / ${timeline.events.length} events`);

  const rows = document.get("timeline").children;
  assert.equal(rows.length, timeline.events.length);
  assert.ok(rows[0].innerHTML.includes("Range event"), "events render in date order");
  assert.ok(rows.some((row) => row.innerHTML.includes("&lt;/script&gt;")), "titles are escaped");
  assert.ok(rows.some((row) => row.innerHTML.includes("data:image/jpeg;base64,")), "embedded images render");
  assert.ok(rows.some((row) => row.innerHTML.includes("https://example.com/photo.jpg")), "linked images render");
  assert.ok(rows.some((row) => row.innerHTML.includes("–")), "time ranges render");
}

// The timeline and slideshow players need a real DOM (listeners, layout), so here
// they are only checked to build, carry their styles, and compile as part of the export.
async function checkTimelinePlayerExport() {
  const timeline = makeTimeline();
  const runtime = await bundleModules(EXPORT_RUNTIME_URL, readFromDisk);
  const playerCss = (await Promise.all(PLAYER_CSS_URLS.map(readFromDisk))).join("\n");

  for (const [player, styleMarker, renderer] of [
    ["timeline", ".tl-player", "renderTimelinePlayer"],
    ["slideshow", ".ss-stage", "renderSlideshowPlayer"],
    ["map", ".mp-stage", "renderMapPlayer"]
  ]) {
    const html = buildStandaloneHtml(timeline, player, runtime, playerCss);
    assert.equal(JSON.parse(html.match(/id="player-data">([\s\S]*?)<\/script>/)[1]).value, player);
    assert.ok(html.includes(styleMarker), `${player} player styles are inlined`);
    assert.ok(html.includes("@media print"), `${player} export carries the print styles`);
    assert.ok(playerCss.lastIndexOf("@media print") > playerCss.lastIndexOf(".mp-stage"), "print styles come last, so they win over the card styles");
    const runtimeSource = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
    assert.doesNotThrow(() => new vm.Script(runtimeSource, { filename: `export-runtime-${player}.js` }));
    assert.ok(runtimeSource.includes(renderer), `${player} renderer is bundled`);
  }
}

// Leaflet is a classic script that rides along only with the Map player: inlined
// ahead of the runtime, its stylesheet stripped of image references, and unable
// to close its own <script> tag. Every other player's export is left as it was.
async function checkMapExport() {
  const timeline = makeTimeline();
  const runtime = await bundleModules(EXPORT_RUNTIME_URL, readFromDisk);
  const playerCss = (await Promise.all(PLAYER_CSS_URLS.map(readFromDisk))).join("\n");
  const vendor = { js: await readFromDisk(LEAFLET_JS_URL), css: await readFromDisk(LEAFLET_CSS_URL) };
  assert.ok(vendor.css.includes("url("), "the vendored stylesheet does reference images, so stripping has something to do");

  const html = buildStandaloneHtml(timeline, "map", runtime, playerCss, vendor);
  const scripts = [...html.matchAll(/<script(?: type="application\/json" id="[^"]+")?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length, 4, "data, player, Leaflet and the runtime");
  const [, , leafletSource, runtimeSource] = scripts;
  assert.ok(html.indexOf(leafletSource.slice(0, 80)) < html.indexOf(runtimeSource.slice(0, 80)), "Leaflet comes before the runtime");
  assert.ok(leafletSource.includes("Leaflet 1.9.4"), "the pinned version is the one inlined");
  assert.doesNotThrow(() => new vm.Script(leafletSource, { filename: "leaflet.js" }), "inlined Leaflet is valid JavaScript");
  assert.doesNotThrow(() => new vm.Script(runtimeSource, { filename: "export-runtime-map.js" }));

  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.ok(style.includes(".leaflet-container"), "Leaflet's stylesheet is inlined");
  assert.ok(style.includes(".mp-stage"), "the map player's styles are inlined");
  assert.ok(!style.includes("url("), "no url() is left in the inlined styles");
  assert.ok(!/https?:\/\/[^"'\s)]*\.(png|gif|svg)/.test(style), "no image URL is left in the styles");

  assert.equal(stripCssUrls("a{background:url(x.png);color:red}"), "a{color:red}");
  assert.equal(stripCssUrls(".lvml{behavior:url(#default#VML);}"), ".lvml{}");
  assert.equal(escapeScriptText('var s="</script><script>";'), 'var s="<\\/script><script>";');
  const hostile = buildStandaloneHtml(timeline, "map", runtime, playerCss, { js: 'var s = "</script><b>";', css: "" });
  assert.equal([...hostile.matchAll(/<script/g)].length, 4, "library text can't add or close a script element");

  const withoutVendor = buildStandaloneHtml(timeline, "slideshow", runtime, playerCss);
  const withVendor = buildStandaloneHtml(timeline, "slideshow", runtime, playerCss, vendor);
  assert.equal(withVendor, withoutVendor, "other players never carry Leaflet, even if it is offered");
  assert.ok(!withoutVendor.includes("Leaflet 1.9.4"));
}

async function checkBundlerRejectsUnsafeInput() {
  const files = {
    "file:///app/a.js": 'import { x } from "./b.js";\nexport const y = x;\n',
    "file:///app/b.js": "export const x = 1;\nexport const y = 2;\n"
  };
  await assert.rejects(
    bundleModules("file:///app/a.js", async (url) => files[url]),
    /"y" is declared in both/
  );

  await assert.rejects(
    bundleModules("file:///app/c.js", async () => "const a = 1;\nexport { a };\n"),
    /export form the bundler does not support/
  );

  const escaped = await bundleModules("file:///app/d.js", async () => 'export const s = "</script>";\n');
  assert.ok(!escaped.includes("</script"), "bundled source cannot close the host <script> tag");
}

function makeTimeline() {
  const fixture = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "schema", "v4-image-gallery.timeline.json"), "utf8"));
  return normalizeTimeline({
    ...fixture,
    title: "Round trip </script><b>",
    events: [
      ...fixture.events,
      {
        id: "range",
        type: "travel",
        title: "Range event </script>",
        timestamp: { date: "2020-01-01", time: "09:00", tz: "UTC" },
        endTimestamp: { date: "2020-03-01", time: "00:00", tz: "UTC" },
        fields: [{ key: "notes", label: "Notes", value: "Packed light" }]
      }
    ]
  });
}

function makeStubDocument(dataById) {
  const elements = new Map();
  const make = () => ({
    children: [],
    className: "",
    innerHTML: "",
    textContent: "",
    append(...nodes) {
      this.children.push(...nodes);
    }
  });
  for (const id of ["timeline-title", "timeline-summary", "timeline"]) {
    elements.set(id, make());
  }
  for (const [id, text] of Object.entries(dataById)) {
    elements.set(id, { textContent: text });
  }
  return {
    get: (id) => elements.get(id),
    getElementById: (id) => elements.get(id) ?? null,
    createElement: make
  };
}

await main();
