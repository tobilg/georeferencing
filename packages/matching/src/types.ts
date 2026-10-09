import type { Extent, Limits, XY } from "@georeferencing/core";

export type { Extent, XY } from "@georeferencing/core";
/**
 * Decoded 8-bit RGBA image in EXIF-normalized orientation.
 * Coordinates use full-resolution pixel edges: top-left `(0, 0)`, Y downward,
 * first pixel centre `(0.5, 0.5)`. Workers copy buffers and never detach them.
 * Alpha-zero pixels are unavailable evidence; opaque white paper is valid data.
 */
export interface PixelImage {
  /** Number of columns in original normalized pixels. */
  width: number;
  /** Number of rows in original normalized pixels. */
  height: number;
  /** Tightly packed RGBA bytes, four channels per pixel; no row padding. */
  data: Uint8Array | Uint8ClampedArray;
}
/** Rectangular plan region in original normalized query pixel-edge coordinates. */
export interface Region {
  /** Horizontal pixel-edge offset in the containing image. */
  x: number;
  /** Vertical pixel-edge offset, increasing downwards. */
  y: number;
  /** Number of columns in original normalized pixels. */
  width: number;
  /** Number of rows in original normalized pixels. */
  height: number;
}
/**
 * Row-major homogeneous 3×3 matrix mapping column vectors `[x, y, 1]`.
 * Divide the resulting X/Y by the third component. Candidate matrices map query
 * edges to reference edges; snapshot matrices map reference edges to explicit CRS
 * coordinates. Matrices do not encode a CRS or nonlinear projection by themselves.
 */
export type Matrix3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
/** Credential-free identity of the selected reference content and its rendering configuration. */
export interface ReferenceSource {
  /** Stable opaque identifier; do not use credential-bearing URLs. */
  id: string;
  /** Host content/style revision, changed whenever rendered content changes. */
  revision: string;
  /** Selected source layer identifiers in rendering order. */
  layers: string[];
  /** Style identifiers in layer order. */
  styles?: string[];
  /** Relevant time/filter/version parameters; never include credentials. */
  parameters?: Record<string, string>;
}
/** Tiles partition the raster; no overlaps/gaps. Missing data uses alpha=0 or valid=false. */
export interface ReferenceTile extends PixelImage {
  /** Horizontal pixel-edge offset in the containing image. */
  x: number;
  /** Vertical pixel-edge offset, increasing downwards. */
  y: number;
  /** False marks unavailable source data without changing search geometry. */
  valid?: boolean;
}
/**
 * Serializable reference raster with immutable source/coordinate identity.
 * Use {@link createSnapshot} to copy buffers and freeze metadata. Treat all byte
 * views as immutable too. Tiles partition one raster regardless of acquisition
 * boundaries; map movement or layer changes cannot alter an existing snapshot.
 * The actual X/Y resolution is encoded in `pixelToMap`, including dimension
 * rounding. Never put credentials or map-library objects in this contract.
 */
export interface ReferenceSnapshot {
  /** Stable opaque identifier; do not use credential-bearing URLs. */
  id: string;
  /** Number of columns in original normalized pixels. */
  width: number;
  /** Number of rows in original normalized pixels. */
  height: number;
  /** Explicit x/y coordinate reference system identifier. */
  crs: string;
  /** Unwrapped [minX,minY,maxX,maxY] search bounds in crs. */
  extent: Extent;
  /** Exact reference pixel-edge to map coordinate mapping, row-major 3×3. */
  pixelToMap: Matrix3;
  /** Frozen provenance of the selected reference rendering. */
  source: ReferenceSource;
  /** Partition of the common raster coordinate space; missing data stays explicit. */
  tiles: ReferenceTile[];
  /**
   * Change-detection digest of the tile bytes, set by {@link createSnapshot} so the
   * matcher's reference-feature cache need not rehash every job. Leave it unset
   * on hand-built snapshots; the matcher then computes it itself.
   */
  digest?: string;
}
/**
 * Runtime-checked feature detector. `"sift"` is the default and finds the most
 * evidence on scaled, annotated or partial plans. `"akaze"` is about twice as fast
 * and uses less memory but finds fewer points, so hard plans more often end
 * `not-found`. Both pass the same validation; see the matching guide.
 */
export type Detector = "sift" | "akaze";
/**
 * Bounded extraction, acceptance and ranking settings.
 * Supply partial overrides on {@link MatchRequest.options}; effective values are
 * returned in diagnostics. {@link DEFAULT_MATCH_OPTIONS} lists shipped defaults.
 * Increasing resource limits requires a suitably provisioned host; lowering a
 * threshold never bypasses the other support, stability or domain-validation gates.
 */
export interface MatchOptions {
  /** Feature detector with its distance metric; `"sift"` unless set. */
  detector: Detector;
  /** Generic grayscale or technical-plan contrast normalization. */
  profile: "generic" | "technical-plan";
  /** Maximum number of distinct validated alternatives returned. */
  maxCandidates: number;
  /** Maximum decoded query area, checked before worker creation. */
  maxQueryPixels: number;
  /** Maximum total decoded reference area. */
  maxReferencePixels: number;
  /** Conservative memory reservation ceiling, including copies and WASM. */
  maxMemoryBytes: number;
  /** Processing window core size, 128 through 1024 pixels; halos are additional. */
  tileSize: number;
  /** Maximum retained independent features per image. */
  maxFeatures: number;
  /** Maximum features retained per extraction window before global budgeting. */
  featuresPerTile: number;
  /** Minimum independent support; cannot be below twelve. Other gates still apply. */
  minInliers: number;
  /** Nearest/second-nearest descriptor distance ratio threshold. */
  ratio: number;
  /** Maximum held-out p95 forward error in original reference pixels. */
  reprojectionThreshold: number;
  /** Relative score gap required to distinguish the leading alternative. */
  ambiguityGap: number;
  /** Opt-in exclusion of strongly coloured features; never changes the plan footprint. */
  suppressColor: boolean;
}
/** Serializable decoded pixels and the immutable reference snapshot for one job. */
export interface MatchRequest {
  /** Full normalized upload, even when `queryRegion` selects only its plan area. */
  query: PixelImage;
  /** Optional rectangle defining the plan being located; full image by default. */
  queryRegion?: Region;
  /** Frozen selected-area reference; search never extends beyond this snapshot. */
  reference: ReferenceSnapshot;
  /** Overrides merged with DEFAULT_MATCH_OPTIONS before validation/execution. */
  options?: Partial<MatchOptions>;
}
/** One verified independent query/reference feature pair. */
export interface Correspondence {
  /** Original full-query pixel-edge coordinate, including any crop/resize offsets. */
  query: XY;
  /** Common reference-raster pixel-edge coordinate, including acquisition-tile offsets. */
  reference: XY;
  /** Descriptor nearest/second-nearest distance ratio for distinctiveness. */
  distance: number;
}
/**
 * Validated placement with independent, spatially distributed evidence.
 * The selected query region defines its footprint; partial candidates can rank
 * above complete ones. Geometry, data availability and feature support are separate
 * measurements. Small residuals alone do not imply acceptance or survey accuracy.
 */
export interface MatchCandidate {
  /** Stable opaque identifier; do not use credential-bearing URLs. */
  id: string;
  /** One-based position in descending evidence quality. */
  rank: number;
  /** Versioned ranking measure, not a correctness probability. */
  score: number;
  /** Selected similarity, affine or projective model in pixel space. */
  model: "helmert" | "polynomial1" | "projective";
  /** Row-major homogeneous matrix mapping query edges to reference edges. */
  transform: Matrix3;
  /** Entire selected plan boundary in reference pixel coordinates. */
  footprint: XY[];
  /** Footprint clipped to the search rectangle, in reference pixels. */
  overlap: XY[];
  /** Geometric containment with a one-original-reference-pixel boundary tolerance. */
  extentStatus: "complete" | "partial";
  /** Clipped plan area divided by full plan area, calculated in query coordinates. */
  overlapFraction: number;
  /** Fraction of full query region with available reference data; alpha is grid sampled. */
  referenceDataCoverage: number;
  /** Spatially deduplicated accepted correspondence count. */
  independentInliers: number;
  /** Descriptor pairs of the job whose reference point lies inside this footprint. */
  tentativeMatches: number;
  /** Independent accepted count divided by the footprint's tentative pair count; independent of search-area size. */
  inlierRatio: number;
  /** Query evidence hull area divided by observable query overlap area. */
  supportCoverage: number;
  /** Median forward residual in original reference pixels. */
  medianError: number;
  /** 95th-percentile forward residual in original reference pixels. */
  p95Error: number;
  /** Largest footprint disagreement between spatial split fits, in reference pixels. */
  stability: number;
  /** Fraction of sampled query edges supported by local reference edges. */
  structuralAgreement: number;
  /** Verified independent pairs retained for review and distributed point application. */
  correspondences: Correspondence[];
  /** Explanations of ambiguity, extrapolation or missing reference data. */
  warnings: string[];
}
/**
 * Ranked placements and a non-probabilistic matching outcome.
 * `matched` means the leading validated score is sufficiently separated from
 * alternatives; `ambiguous` retains comparable alternatives for host review;
 * `not-found` means no validated candidate survived, not proof of absence.
 * All outcomes require host policy/UI before control points are changed.
 */
export interface MatchResult {
  /** Matched, ambiguous or no validated placement; not-found does not prove absence. */
  status: "matched" | "ambiguous" | "not-found";
  /** Identity of the immutable snapshot that produced this result. */
  referenceSnapshotId: string;
  /** Validated placements sorted by descending score with deterministic ties. */
  candidates: MatchCandidate[];
  /** Leading placement, including in an ambiguous result; absent when not-found. */
  bestCandidateId?: string;
  /** Runtime, configuration, support and resource measurements. */
  diagnostics: {
    /** Pinned backend/build identifier. */
    backend: string;
    /** Descriptor detector and appropriate distance metric. */
    detector: Detector;
    /** Ranking formula version for comparison/provenance. */
    scoreVersion: string;
    /** Full effective options, including defaults and request overrides. */
    options: MatchOptions;
    /** Worker-local backend startup duration; excludes spawning and acquisition. */
    initializationMs: number;
    /** Compute duration after initialization; excludes reference acquisition. */
    matchingMs: number;
    /** Allocated WASM linear-memory capacity at completion, not JS heap or live bytes. */
    wasmHeapBytes: number;
    /** Conservative input/descriptor/heap reservation checked before execution. */
    estimatedMemoryBytes: number;
    /** Retained spatially deduplicated query features. */
    queryFeatures: number;
    /** Retained spatially deduplicated reference features. */
    referenceFeatures: number;
    /** Counts of rejected hypotheses by validation reason, never selectable. */
    rejected: Record<string, number>;
  };
}
/**
 * Actual completed work within a processing stage, excluding reference acquisition.
 * Stage totals are not an overall percentage or latency estimate. Zero means no
 * fixed total; use indeterminate progress until a positive total is available.
 */
export interface MatchProgress {
  /** Current real processing stage. */
  stage: "initializing" | "extracting" | "searching" | "validating";
  /** Completed units in this stage. */
  completed: number;
  /** Stage unit bound; zero when not predetermined. */
  total: number;
}
/** Host-only lifecycle callbacks; never serialized into worker messages. */
export interface MatchExecution {
  /** Abort terminates the computation worker; also pass this signal to provider acquisition. */
  signal?: AbortSignal;
  /** Receives work updates on the caller thread; keep the callback fast and nonthrowing. */
  onProgress?: (progress: MatchProgress) => void;
}
/** One-job-at-a-time owned worker executor with reusable backend state. */
export interface ImageMatcher {
  /**
   * Validate limits, clone pixels and run one job, preserving caller buffers.
   * Resolves even for `ambiguous`/`not-found` outcomes. Rejects MatchingError for
   * invalid inputs/budgets/backend failures, BUSY for concurrent requests and
   * DISPOSED after disposal. Normal abort rejects with name `AbortError` and
   * terminates the worker; a subsequent job may create another worker.
   * Worker results carry job IDs so late messages cannot settle newer jobs.
   */
  match(
    request: MatchRequest,
    execution?: MatchExecution,
  ): Promise<MatchResult>;
  /** Idempotently terminate the worker and reject pending/future jobs. */
  dispose(): void;
}
/** Authorized search area, scale and selected source identities. */
export interface ReferenceSelection {
  /** Unwrapped [minX,minY,maxX,maxY] search bounds in crs. */
  extent: Extent;
  /** Explicit x/y coordinate reference system identifier. */
  crs: string;
  /** Requested map coordinate units per reference pixel. */
  resolution: number;
  /** Selected source layer identifiers in rendering order. */
  layers: string[];
}
/** Host boundary for WMS acquisition or rendered WFS/map pixels. */
export interface ReferenceProvider {
  /** Capture a stable reference for this selection; respect cancellation and pixel limits. */
  acquire(
    selection: ReferenceSelection,
    /** Abort terminates an owned computation worker or cancels provider acquisition. */
    signal?: AbortSignal,
  ): Promise<ReferenceSnapshot>;
}
/**
 * Recoverable matching failure with a stable machine-readable code.
 *
 * - `INPUT`: invalid pixels, region, mapping, selection or options.
 * - `BUDGET`: query/reference/memory/feature or control-point limits exceeded.
 * - `BACKEND`: missing/incompatible WASM APIs or backend initialization failure.
 * - `BUSY`: another job is active on this matcher.
 * - `DISPOSED`: the executor was disposed; create another instance to continue.
 * - `SOURCE`: reference transport, readiness, rendering or decoding failed.
 * - `STALE`: reviewed results no longer agree with document/source revisions.
 * - `GEOMETRY`: singular or invalid mapping.
 *
 * Normal cancellation instead rejects an error named `AbortError`. Host callbacks
 * and native decoder/worker creation errors may propagate their own error types.
 */
export class MatchingError extends Error {
  /** Construct a typed actionable failure. */
  constructor(
    /** Stable failure category for caller recovery. */
    public readonly code:
      | "INPUT"
      | "BUDGET"
      | "BACKEND"
      | "BUSY"
      | "DISPOSED"
      | "SOURCE"
      | "STALE"
      | "GEOMETRY",
    message: string,
  ) {
    super(message);
    this.name = "MatchingError";
  }
}
/** Conservative desktop defaults. Limits are reservations, not host-memory guarantees. */
export const DEFAULT_MATCH_OPTIONS: Readonly<MatchOptions> = Object.freeze({
  detector: "sift",
  profile: "technical-plan",
  maxCandidates: 5,
  maxQueryPixels: 25_000_000,
  maxReferencePixels: 32_000_000,
  // Covers a query and a reference at their default pixel limits together.
  maxMemoryBytes: 1024 * 1024 * 1024,
  tileSize: 1024,
  maxFeatures: 24000,
  featuresPerTile: 1600,
  minInliers: 12,
  ratio: 0.75,
  reprojectionThreshold: 3,
  ambiguityGap: 0.12,
  suppressColor: false,
});
/**
 * Explicit core engine input limits compatible with a 25-million-pixel query.
 * Configure the controller's engine with these values: 25 MP decoded input,
 * 64 MiB encoded input and a 1 GiB memory ceiling. Matcher memory is configured
 * separately on each request; neither setting overrides the core's 24 MP output
 * default. Budget intended preview/export outputs separately on the host.
 */
export const MATCHING_CORE_LIMITS: Partial<Limits> = Object.freeze({
  maxInputPixels: 25_000_000,
  maxFileBytes: 64 * 1024 * 1024,
  maxMemoryBytes: 1024 * 1024 * 1024,
});
