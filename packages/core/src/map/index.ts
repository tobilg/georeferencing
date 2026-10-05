/**
 * Map-library-independent contract and helpers for map adapters. Hosts use an adapter
 * package (`@georeferencing/openlayers`, `@georeferencing/maplibre`,
 * `@georeferencing/leaflet`); this entry is for adapter authors and for reference-source
 * types shared by all adapters. Import from `@georeferencing/core/map`.
 * @module @georeferencing/core/map
 * @group @georeferencing/core
 */
import proj4 from "proj4";

export { ViewHistory } from "../core/view-history.js";
export type {
  MapAdapter,
  MapAdapterOptions,
  MapBinding,
  MapCapture,
} from "./binding.js";
export { extentToImageView, imageViewToExtent } from "./navigation.js";
export type {
  CustomReference,
  GeoJsonReference,
  Query,
  ReferenceBase,
  ReferenceData,
  ReferenceLoadStatus,
  ReferenceSource,
  ReferenceWatchOptions,
  SnapOptions,
  WfsCapabilities,
  WfsDiscoveryOptions,
  WfsPage,
  WfsProperty,
  WfsReference,
} from "./references.js";
export {
  buildWfsUrl,
  describeWfsFeatureType,
  discoverWfs,
  loadReferenceData,
  loadWfsGeoJson,
  loadWfsPages,
  queryBounds,
  toGeographic,
  watchReferences,
} from "./references.js";
export type { SnapResult, SnapSource } from "./snap.js";
export { snapToReferences } from "./snap.js";
export { subscribeBinding } from "./sync.js";
/**
 * The parts of the proj4 instance that adapters need. Typed structurally, so core's
 * public declarations do not depend on proj4's own type declarations.
 */
export interface SharedProj4 {
  /** Register a named projection definition, or read one when `definition` is omitted. */
  defs(name: string, definition?: string): unknown;
}
/**
 * The proj4 instance used by core for every conversion. Adapters must register host
 * definitions with, and hand to their map library, this instance rather than another
 * copy, so all components share one projection registry.
 */
export function sharedProj4(): SharedProj4 {
  return proj4 as unknown as SharedProj4;
}
