import type { Engine, Raster } from "../engine/index.js";
import type { ExportFormat } from "./exports.js";
import type { Fit } from "./transform.js";
import type { Document, Extent, Features, XY } from "./types.js";

/** Active editor interaction; geometry names match GeoJSON geometry types. */
export type Tool =
  | "navigate"
  | "gcp"
  | "Point"
  | "LineString"
  | "Polygon"
  | "modify";
/** Lifecycle state of an asynchronous editor operation. */
export type Status = "idle" | "running" | "succeeded" | "failed" | "cancelled";
/** When committed alignment edits are fitted and rendered. */
export type PreviewMode = "manual" | "automatic";
/**
 * Immutable accepted-feature snapshot for host persistence. Replace only features
 * belonging to `documentId`; omitted IDs represent deletions within that document.
 */
export interface SaveEnvelope {
  /** Idempotency key reused when retrying the same revision and save kind. */
  requestId: string;
  /** Host replacement contract, scoped exclusively to this document. */
  semantics: "replace-document-features";
  /** Stable document scope; never replace unrelated host features. */
  documentId: string;
  /** Exact submitted revision; completion must not acknowledge subsequent edits. */
  documentRevision: number;
  /** Deep-frozen snapshot with source identity and per-feature provenance. */
  document: Document;
  /** Accepted GeoJSON in longitude/latitude, sharing the snapshot feature collection. */
  features: Features;
  /** Processing engine version for provenance. */
  engine: string;
  /** Training residual summary for the accepted alignment. */
  diagnostics: {
    /** Root mean squared forward residual in working-CRS units. */
    rmse: number;
    /** Formula used for the reported training RMSE. */
    definition: string;
    /** Working CRS supplying the residual units. */
    crs: string;
  };
}
/** Snapshot presented before removing, replacing or restoring over unsaved work. */
export interface GuardContext {
  /** Document at guard invocation. New edits can cause the guard to run again. */
  document: Document;
  /** Whether a configured host handler can save this snapshot. */
  canSave: boolean;
  /** Preferred eligible handler: draft first, otherwise accepted features, or null. */
  saveKind: "draft" | "features" | null;
}
/**
 * Host services and initial state for one editor. The controller does not own the map or
 * persist data itself.
 */
export interface ControllerOptions {
  /** Initial preview policy. Manual waits for `refit`; automatic updates after eligible edits. @defaultValue `"automatic"` */
  previewMode?: PreviewMode;
  /** Explicit opt-in export formats. No file exporters are enabled by default. */
  exports?: readonly ExportFormat[];
  /**
   * Explicit initial working CRS; `initialDocument` supplies its own CRS when provided.
   */
  workingCrs: string;
  /**
   * Host-supplied engine. Controller disposal cancels its jobs but does not dispose a
   * potentially shared engine.
   */
  engine: Engine;
  /**
   * Enable drawing after explicit alignment confirmation.
   * @defaultValue `false`
   */
  digitizing?: boolean;
  /**
   * Validated and cloned session metadata. Use `restoreSession` to load matching image
   * bytes before alignment operations.
   */
  initialDocument?: Document;
  /**
   * Receives each committed frozen document for host draft synchronization. This is not a
   * save acknowledgement.
   */
  onChange?: (document: Document) => void;
  /**
   * Persist an immutable accepted-feature snapshot. Resolve after success; reject to
   * preserve a retryable unsaved draft.
   */
  onSave?: (snapshot: Readonly<SaveEnvelope>) => Promise<void>;
  /**
   * Persist unfinished work independently of accepted-feature eligibility. Image bytes
   * are not included; the host arranges asset persistence.
   */
  onSaveDraft?: (
    snapshot: Readonly<{
      /** Idempotency key for this document revision and draft-save kind. */
      requestId: string;
      /** Frozen snapshot of the exact draft submitted. */
      document: Document;
    }>,
  ) => Promise<void>;
  /**
   * Resolve Save/Discard/Cancel before a destructive image transition. Missing guards
   * default to cancel when work is dirty.
   */
  guard?: (context: GuardContext) => Promise<"save" | "discard" | "cancel">;
  /**
   * Structured error notification. Aborts are cancellation and are not reported as
   * errors.
   */
  onError?: (error: {
    /** Machine-readable error category. */
    code: string;
    /** Actionable human-readable explanation. */
    message: string;
    /** Worker operation identifier when available. */
    operationId?: string;
    /** Whether correcting input and retrying may recover the operation. */
    recoverable: boolean;
  }) => void;
  /** Observe tool changes to coordinate host-owned interactions with the editor. */
  onActiveToolChange?: (tool: Tool) => void;
  /**
   * Optional longitude/latitude extent enforced when saving accepted features; separate
   * from WFS and raster bounds.
   */
  drawingBounds?: Extent;
}
/**
 * Display status of a reference provider. Loader failures do not disable manual GCP
 * entry.
 */
export interface ReferenceStatus {
  /** Human-readable source name. */
  label: string;
  /** Most recent provider request state. */
  state: "loading" | "ready" | "error";
  /** True when limits or service behavior prevented complete results. */
  partial?: boolean;
  /** Service error or explanation of incomplete results. */
  message?: string;
}
/**
 * Subscription snapshot combining a frozen document with transient UI and processing
 * state. Read without mutation; persist only `document`.
 */
export interface EditorSnapshot {
  /** Transient preview policy; changed through `setPreviewMode`, not persisted in sessions. */
  previewMode: PreviewMode;
  /** Configured lazy export descriptors; transient configuration, never session data. */
  exportFormats: readonly ExportFormat[];
  /** Provider statuses indexed by configured provider ID. */
  references: Record<string, ReferenceStatus>;
  /** Authoritative frozen serializable document. */
  document: Document;
  /** Current fit, or null while invalid, absent or recalculating. */
  fit: Fit | null;
  /** Alignment revision represented by the fit, or null. */
  fitRevision: number | null;
  /** Reduced-resolution warped raster in the working CRS, or null. */
  preview: Raster | null;
  /**
   * Controller-owned normalized preview object URL. Do not persist or revoke it in host
   * code.
   */
  imageUrl: string | null;
  /**
   * Controller-owned full-resolution, orientation-normalized display image URL, or null
   * until `requestDetailImage` completes. Do not persist or revoke it in host code.
   */
  detailImageUrl: string | null;
  /** Canonical image endpoint awaiting a paired map coordinate, or null. */
  pendingImagePoint: XY | null;
  /** Active package interaction. */
  tool: Tool;
  /** Alignment editing or confirmed drawing stage. */
  mode: "align" | "draw";
  /** Image inspection/replacement state. */
  loading: Status;
  /** Fit and preview generation state. */
  fitting: Status;
  /** Raster or world-file export state. */
  exporting: Status;
  /** Host persistence state; edits may continue during saving. */
  saving: Status;
  /** Most recent displayable error message, or null. */
  error: string | null;
  /** Structured details for host-localized errors, or null. */
  errorDetail: {
    /** Machine-readable error category. */
    code: string;
    /** Default human-readable message. */
    message: string;
    /** Worker operation ID when available. */
    operationId?: string;
    /** Whether the user may correct input and retry. */
    recoverable: boolean;
  } | null;
  /** Export progress fraction from 0 to 1. */
  progress: number;
  /**
   * Whether image-dependent work is newer than both draft and accepted-feature save
   * acknowledgements.
   */
  dirty: boolean;
  /** Latest acknowledged accepted-feature revision; draft saves do not set this value. */
  savedRevision: number | null;
  /** Whether document edit history has an undo entry. */
  canUndo: boolean;
  /** Whether document edit history has a redo entry. */
  canRedo: boolean;
  /** Transient overlay opacity from 0 to 1. */
  opacity: number;
  /** Whether the transformed overlay is displayed. */
  visible: boolean;
  /**
   * Image viewport `[x, y, width, height]` in canonical pixels; distinct from a min/max
   * extent.
   */
  imageView: [number, number, number, number] | null;
  /** Optional one-way viewport synchronization; off keeps navigation independent. */
  linkedNavigation: "off" | "image-to-map" | "map-to-image";
}
