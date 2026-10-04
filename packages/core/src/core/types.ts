import type { FeatureCollection, LineString, Point, Polygon } from "geojson";

/**
 * A two-dimensional `[x, y]` coordinate; its CRS or pixel space is supplied by the
 * containing API.
 */
export type XY = [number, number];
/**
 * Axis-aligned `[minX, minY, maxX, maxY]` bounds in an explicitly declared CRS. Wrapped
 * extents are unsupported.
 */
export type Extent = [number, number, number, number];
/**
 * Supported QGIS-style transformation models. `polynomial1` is affine; `linear` only
 * translates and scales axes.
 */
export type Model =
  | "linear"
  | "helmert"
  | "polynomial1"
  | "polynomial2"
  | "polynomial3"
  | "projective"
  | "thinPlateSpline";
/** Raster interpolation kernels shared by preview and final export. */
export type Resampler =
  | "nearest"
  | "bilinear"
  | "cubic"
  | "cubicSpline"
  | "lanczos";
/**
 * RFC 7946 longitude/latitude draft features. Each feature requires a unique nonempty
 * string ID and JSON properties.
 */
export type Features = FeatureCollection<
  Point | LineString | Polygon,
  Record<string, unknown>
>;
/**
 * A paired ground control point. Map coordinates are snapshots and never follow later
 * reference-source refreshes.
 */
export interface Gcp {
  /** Stable identifier retained through edits, history and session serialization. */
  id: string;
  /** Positive display number; independent of the stable ID. */
  label: number;
  /** Whether the point participates in fitting and residual calculations. */
  enabled: boolean;
  /**
   * Original-resolution, orientation-normalized pixels; origin at the top-left corner, y
   * increasing downwards. The first pixel centre is `[0.5, 0.5]`.
   */
  image: XY;
  /** Selected map coordinate in `crs`, independent of the current map-view projection. */
  target: XY;
  /**
   * CRS of the target snapshot; the worker converts it into the document working CRS
   * before fitting.
   */
  crs: string;
  /**
   * Optional provenance of a snapped coordinate; this does not establish a live feature
   * binding.
   */
  reference?: {
    /** Identifier of the reference provider used for snapping. */
    sourceId: string;
    /** Provider feature identifier when available. */
    featureId?: string;
  };
}
/**
 * Serializable identity and inspected raster dimensions. Original bytes and decoded
 * buffers remain outside the document.
 */
export interface ImageMetadata {
  /** Stable image ID, preserved when restoring a matching session. */
  id: string;
  /** Original file name for display and download names. */
  name: string;
  /** Compressed input file size in bytes. */
  sizeBytes: number;
  /** Width in canonical pixels after applying orientation. */
  width: number;
  /** Height in canonical pixels after applying orientation. */
  height: number;
  /**
   * Lowercase SHA-256 hex digest of the original file bytes, used to verify session
   * restoration.
   */
  fingerprint: string;
  /** Detected file encoding, independent of its extension or MIME type. */
  format: "png" | "jpeg" | "webp" | "tiff";
  /** Original EXIF/TIFF orientation code from 1 through 8. */
  orientation: number;
  /** Encoded width before orientation normalization. */
  originalWidth: number;
  /** Encoded height before orientation normalization. */
  originalHeight: number;
  /** Canonical image-space convention shared by control points, preview and export. */
  pixelConvention: "normalized-top-left-corner-y-down";
  /**
   * Whether the input contains georeferencing metadata; this flag does not automatically
   * align the image.
   */
  georeferenced: boolean;
  /** Numeric no-data value discovered in the input TIFF, when present. */
  noData?: number;
  /**
   * Optional host-managed asset identifier; the library does not upload or persist the
   * image.
   */
  hostAssetId?: string;
}
/**
 * Requested raster output, independent of reference query bounds and geographic drawing
 * constraints.
 */
export interface OutputSettings {
  /** Output CRS, which may differ from both the working CRS and map-view CRS. */
  crs: string;
  /**
   * Positive `[x, y]` pixel sizes in output CRS units. Omit to estimate from the
   * transformed image.
   */
  resolution?: XY;
  /**
   * Optional output extent in `crs`. Omit to derive bounds from the transformed image.
   */
  bounds?: Extent;
  /** Interpolation method used for raster preview and final output. */
  resampler: Resampler;
  /**
   * TIFF strip compression.
   * @defaultValue `"none"`
   */
  compression?: "none" | "deflate" | "packbits";
  /**
   * Optional integer 0–255 written as RGB no-data and a GDAL no-data tag. Omit to retain
   * an unassociated alpha band.
   */
  noData?: number;
  /**
   * Input RGB value to mask before interpolation. A scalar matches all three channels; a
   * tuple requires an exact RGB match.
   */
  sourceNoData?: number | [number, number, number];
  /**
   * TIFF strip height, an integer from 1 through 4096. The encoder bounds its default by
   * raster height.
   */
  rowsPerStrip?: number;
  /**
   * TIFF predictor: 1 for none, 2 for horizontal differencing. Predictor 2 requires Deflate compression.
   * @defaultValue `1`
   */
  predictor?: 1 | 2;
}
/**
 * Versioned, JSON-serializable editor document. Use controller methods to change its
 * frozen snapshots; files, map objects and buffers are kept separately.
 */
export interface Document {
  /** Session format version; unknown versions are rejected by `parseSession`. */
  schemaVersion: 1;
  /** Stable document ID and the scope for host feature replacement/deletions. */
  id: string;
  /**
   * Monotonically increasing revision for all committed edits, including undo and redo.
   */
  documentRevision: number;
  /** Source identity, or null when no image is selected. */
  sourceImage: ImageMetadata | null;
  /**
   * CRS used for fitting, residuals and overlay preview; does not imply the map-view or
   * output CRS.
   */
  workingCrs: string;
  /** Selected transformation model; invalid fits never fall back to another model. */
  model: Model;
  /**
   * Control-point pairs, including disabled pairs retained for editing and interchange.
   */
  gcps: Gcp[];
  /** Revision advanced by GCP, model or working-CRS changes. */
  alignmentRevision: number;
  /**
   * Exactly the alignment revision explicitly confirmed by the user, or null when
   * unconfirmed.
   */
  confirmedAlignmentRevision: number | null;
  /** Revision of the geographic feature draft. */
  featureRevision: number;
  /**
   * Alignment revision against which the geographic drawings were reviewed, or null when
   * review is required.
   */
  featuresReviewedAgainstAlignmentRevision: number | null;
  /**
   * Geographic drafts in longitude/latitude; re-alignment never moves these coordinates.
   */
  features: Features;
  /** Source image and alignment provenance indexed by the corresponding feature ID. */
  provenanceByFeatureId: Record<
    string,
    {
      /** Image ID present when the feature was created. */
      sourceImageId: string;
      /** Alignment revision present when the feature was created. */
      createdAgainstAlignmentRevision: number;
      /**
       * Most recent explicitly reviewed alignment revision, or null after re-alignment.
       */
      lastReviewedAgainstAlignmentRevision: number | null;
    }
  >;
  /** Settings for raster export; no raster export is required to persist features. */
  output: OutputSettings;
}
/**
 * Allocation and workload limits checked before decoding or creating an output grid where
 * possible.
 */
export interface Limits {
  /** Maximum compressed file size in bytes; default 26,214,400 (25 MiB). */
  maxFileBytes: number;
  /** Maximum orientation-normalized input pixel count; default 24,000,000. */
  maxInputPixels: number;
  /** Maximum final output pixel count; default 24,000,000. */
  maxOutputPixels: number;
  /**
   * Conservative estimated processing-memory budget in bytes; default 768 MiB, not a
   * browser heap guarantee.
   */
  maxMemoryBytes: number;
  /** Maximum preview width or height in pixels; default 768. */
  previewMaxDimension: number;
  /**
   * Engine control-point budget; default 128. The fitter also enforces a hard limit of
   * 128 enabled points.
   */
  maxGcps: number;
}
/**
 * Default bounded workload. Override individual values through the worker engine options
 * after validating the host environment.
 */
export const DEFAULT_LIMITS: Limits = {
  maxFileBytes: 26_214_400,
  maxInputPixels: 24_000_000,
  maxOutputPixels: 24_000_000,
  maxMemoryBytes: 768 * 1024 * 1024,
  previewMaxDimension: 768,
  maxGcps: 128,
};
/**
 * Processing implementation identifier included in save envelopes and accuracy reports.
 */
export const ENGINE_VERSION = "js-warp/0.1.0";
/**
 * Display labels and minimum enabled GCP counts. Meeting the count alone does not
 * guarantee rank, conditioning or a valid warp domain.
 */
export const MODELS: Record<
  Model,
  {
    /** English display label for the model. */
    label: string;
    /** Minimum enabled control-point count for attempting a fit. */
    minimum: number;
  }
> = {
  linear: { label: "Linear (axis scales)", minimum: 2 },
  helmert: { label: "Helmert", minimum: 2 },
  polynomial1: { label: "Polynomial 1 / affine", minimum: 3 },
  polynomial2: { label: "Polynomial 2", minimum: 6 },
  polynomial3: { label: "Polynomial 3", minimum: 10 },
  projective: { label: "Projective", minimum: 4 },
  thinPlateSpline: { label: "Thin plate spline", minimum: 3 },
};
/** Structured processing/editor error with a stable code for host error presentation. */
export class GeoreferenceError extends Error {
  /**
   * Create a structured error.
   * @param code - Machine-readable error category.
   * @param message - Human-readable explanation.
   * @param recoverable - Whether the user can correct the input and retry.
   * @param operationId - Optional worker operation identifier.
   */
  constructor(
    public code: string,
    message: string,
    public recoverable = true,
    public operationId?: string,
  ) {
    super(message);
    this.name = "GeoreferenceError";
  }
}
/**
 * Throw a recoverable {@link GeoreferenceError}.
 * @param code - Machine-readable category.
 * @param message - Actionable explanation.
 * @throws {@link GeoreferenceError} Always.
 */
export const fail = (code: string, message: string): never => {
  throw new GeoreferenceError(code, message);
};
/**
 * Create a UUID using `crypto.randomUUID()`. Requires a runtime with Web Crypto; browser
 * calls require a secure context.
 */
export const uid = (): string => crypto.randomUUID();
/**
 * Create an empty version-1 document with affine fitting and bilinear output in the supplied working CRS.
 * @param workingCrs - Explicit working CRS; no projection is guessed or registered.
 * @throws {@link GeoreferenceError} If the CRS string is empty.
 */
export function createDocument(workingCrs: string): Document {
  if (!workingCrs) fail("CRS", "A working CRS is required.");
  return {
    schemaVersion: 1,
    id: uid(),
    documentRevision: 0,
    sourceImage: null,
    workingCrs,
    model: "polynomial1",
    gcps: [],
    alignmentRevision: 0,
    confirmedAlignmentRevision: null,
    featureRevision: 0,
    featuresReviewedAgainstAlignmentRevision: null,
    features: { type: "FeatureCollection", features: [] },
    provenanceByFeatureId: {},
    output: { crs: workingCrs, resampler: "bilinear" },
  };
}
