/**
 * Headless local image matching: shared contracts, reference acquisition,
 * coordinate helpers and explicit controller application.
 *
 * Import `/browser` or `/node` to create a worker executor, and optionally
 * `/openlayers` to acquire reference pixels from host-owned layers. The root
 * neither starts workers nor loads WASM, a map library or React. Applications own
 * all matching controls, candidate rendering and acceptance decisions.
 * @module @georeferencing/matching
 * @group @georeferencing/matching
 */
export type { ApplicationToken, ApplyCandidateOptions } from "./apply.js";
export { applyCandidate, createApplicationToken } from "./apply.js";
export { densifyBoundary, processingToQuery, transform } from "./geometry.js";
export type { WmsProviderOptions } from "./reference.js";
export {
  createSnapshot,
  createWmsProvider,
  wmsRequestUrl,
} from "./reference.js";
export * from "./types.js";
