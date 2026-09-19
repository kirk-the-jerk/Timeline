// The map tile sources a viewer can pick. Every source must cover the whole
// world, because a timeline can have events anywhere. See docs/players/map.md,
// section 4. `kind` is street, aerial or styled. `tileSize` and `zoomOffset` are
// only for sources that don't use 256 pixel tiles. `maxNativeZoom` is the last
// zoom that has real tiles, for a source whose pictures are enlarged beyond it.

export const TILE_SOURCES = [
  {
    id: "osm",
    label: "OpenStreetMap",
    kind: "street",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    maxZoom: 19
  },
  {
    id: "esri-imagery",
    label: "Esri World Imagery",
    kind: "aerial",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxZoom: 19
  },
  {
    id: "versatiles-satellite",
    label: "VersaTiles Satellite",
    kind: "aerial",
    url: "https://tiles.versatiles.org/tiles/satellite/{z}/{x}/{y}",
    attribution: 'Imagery: <a href="https://versatiles.org/sources/" target="_blank" rel="noopener noreferrer">VersaTiles sources</a>',
    maxZoom: 19,
    // Its tiles are 512 pixels, one zoom level down from the 256 pixel scheme.
    tileSize: 512,
    zoomOffset: -1
  },
  {
    id: "nasa-blue-marble",
    label: "NASA Blue Marble",
    kind: "styled",
    // GIBS puts the date in the path. "default" is the layer's own date, which is all a static layer has.
    url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
    attribution: 'Imagery: <a href="https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api" target="_blank" rel="noopener noreferrer">NASA EOSDIS GIBS</a>',
    // The pictures stop at zoom 8 (about 500 m a pixel); closer in they are enlarged.
    maxNativeZoom: 8,
    maxZoom: 12
  },
  {
    id: "opentopomap",
    label: "OpenTopoMap",
    kind: "styled",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors, <a href="https://viewfinderpanoramas.org" target="_blank" rel="noopener noreferrer">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener noreferrer">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer">CC-BY-SA</a>)',
    maxZoom: 17
  }
];

export const DEFAULT_TILE_SOURCE_ID = "osm";

// The hosts the player may request tiles from, for the save dialog's note. A
// `{s}.` subdomain placeholder is dropped, so OpenTopoMap shows as its bare host.
export function getTileHosts() {
  const hosts = TILE_SOURCES.map((source) => new URL(source.url.replace("{s}.", "")).hostname);
  return [...new Set(hosts)];
}

export function normalizeTileSourceId(value) {
  return TILE_SOURCES.some((source) => source.id === value) ? value : DEFAULT_TILE_SOURCE_ID;
}

export function getTileSource(id) {
  return TILE_SOURCES.find((source) => source.id === normalizeTileSourceId(id));
}

// A page opened from disk (`file://`) sends no Referer, and the OpenStreetMap
// tile servers can refuse such requests with a 403 (their tile policy asks for
// a Referer). The other sources in the list load from disk. So when OSM has
// failed on a file page, the player uses this source instead, for that visit.
export const FILE_PAGE_FALLBACK_ID = "opentopomap";
// How many failed tiles, with none loaded, count as "this source is refused".
export const TILE_REFUSED_ERROR_COUNT = 3;

// The source to switch to when `sourceId` is failing on a page served from
// `protocol` (`location.protocol`), or null when there is nothing better to try.
export function fallbackTileSource(sourceId, protocol) {
  return protocol === "file:" && normalizeTileSourceId(sourceId) === "osm"
    ? getTileSource(FILE_PAGE_FALLBACK_ID)
    : null;
}
