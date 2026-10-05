import type { MapAdapter, MapCapture } from "@georeferencing/core/map";

/** Map libraries the demo can run with (`?map=` URL parameter). */
export type MapLibrary = "openlayers" | "maplibre" | "leaflet";

/** A demo reference map: the host-owned map plus what the page needs from it. */
export interface DemoMap {
  /** The native map object, exposed for debugging and browser tests. */
  map: unknown;
  /** Adapter connecting the editor to this map. */
  adapter: MapAdapter;
  /**
   * Frame `[west, south, east, north]` longitude/latitude bounds. Map framing never
   * georeferences the image.
   */
  fitBounds(bounds: [number, number, number, number]): void;
  /** Reload basemap tiles after a network failure. */
  retryTiles(): void;
  /** Capture the current map for PDF reports, when the library supports it. */
  capture?(): Promise<MapCapture>;
  dispose(): void;
}

/** Create a map inside a container; `onTileError` reports basemap failures. */
export type CreateDemoMap = (
  container: HTMLElement,
  onTileError: () => void,
) => DemoMap;

/**
 * Initial view shared by every map library: centre in longitude/latitude and scale in
 * Web Mercator metres per CSS pixel. Each library derives its own parameters from it.
 */
export const INITIAL_VIEW = {
  center: [9.986, 53.542] as [number, number],
  resolution: 2.1,
};
/**
 * Zoom level showing `resolution` Web Mercator metres per pixel. Zoom levels refer to
 * 256 px tiles in OpenLayers and Leaflet and to 512 px tiles in MapLibre.
 */
export function zoomFor(resolution: number, tileSize: 256 | 512): number {
  return Math.log2((2 * Math.PI * 6378137) / tileSize / resolution);
}
export const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
