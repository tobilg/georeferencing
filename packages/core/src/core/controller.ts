import type { Engine, JobTag, Raster } from "../engine/index.js";
import type { ExportFormat, ExportResult } from "./exports.js";
import { abortable } from "./exports.js";
import { assertJson, validateFeatures } from "./geometry.js";
import { parseSession } from "./interchange.js";
import type { Fit } from "./transform.js";
import type {
  Document,
  Extent,
  Features,
  Gcp,
  ImageMetadata,
  Model,
  OutputSettings,
  XY,
} from "./types.js";
import {
  createDocument,
  DEFAULT_LIMITS,
  ENGINE_VERSION,
  fail,
  GeoreferenceError,
  MODELS,
  uid,
} from "./types.js";

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
/** Recursively freeze serializable snapshots against host-callback mutation. */
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}
const clone = <T>(value: T): T => structuredClone(value);
const abortError = (e: unknown) =>
  e instanceof Error && e.name === "AbortError";
/** Copy and validate descriptors without loading plugin implementations. */
function validateExportFormats(
  formats: readonly ExportFormat[],
): readonly ExportFormat[] {
  const ids = new Set<string>();
  return Object.freeze(
    formats.map((format) => {
      if (
        !format.id ||
        ids.has(format.id) ||
        !format.label ||
        typeof format.load !== "function"
      )
        fail(
          "EXPORT_CONFIG",
          "Export formats require unique IDs, labels and lazy loaders.",
        );
      ids.add(format.id);
      return Object.freeze({ ...format });
    }),
  );
}
/**
 * Authoritative editor store with revision-safe processing, edit history and host persistence.
 *
 * Construction is SSR-safe and creates no maps or workers. The host supplies the engine, subscribes to stable snapshots and owns final disposal. Files, object URLs and abort controllers remain outside the serializable document.
 */
export class GeoreferencerController {
  /**
   * Host configuration. Use `setGuard` to change the transition guard; other options
   * should remain stable.
   */
  readonly options: ControllerOptions;
  private state: EditorSnapshot;
  private listeners = new Set<() => void>();
  private undoStack: Document[] = [];
  private redoStack: Document[] = [];
  private file: File | null = null;
  private previewBlob: Blob | null = null;
  private imageHistory: [number, number, number, number][] = [];
  private imageHistoryIndex = -1;
  private imageHistoryTimer?: ReturnType<typeof setTimeout>;
  private fitAbort?: AbortController;
  private exportAbort?: AbortController;
  private loadAbort?: AbortController;
  private generation = 0;
  private fitGeneration = 0;
  private saved = new Map<string, number>();
  private draftSaved = new Map<string, number>();
  private saveRequest?: {
    revision: number;
    documentId: string;
    id: string;
    kind: string;
  };
  private savePromise?: Promise<void>;
  /**
   * Create a controller and validate any initial session. Matching image bytes are restored separately.
   * @param options - Host engine, CRS, lifecycle and persistence callbacks.
   */
  constructor(options: ControllerOptions) {
    this.options = options;
    const document = options.initialDocument
      ? parseSession(JSON.stringify(options.initialDocument))
      : createDocument(options.workingCrs);
    this.state = {
      previewMode: options.previewMode ?? "automatic",
      exportFormats: validateExportFormats(options.exports ?? []),
      references: {},
      document: freeze(document),
      fit: null,
      fitRevision: null,
      preview: null,
      imageUrl: null,
      pendingImagePoint: null,
      tool: "navigate",
      mode: "align",
      loading: "idle",
      fitting: "idle",
      exporting: "idle",
      saving: "idle",
      error: null,
      errorDetail: null,
      progress: 0,
      dirty: Boolean(document.sourceImage),
      savedRevision: null,
      canUndo: false,
      canRedo: false,
      opacity: 0.7,
      visible: true,
      imageView: null,
      linkedNavigation: "off",
    };
  }
  /**
   * Read the stable external-store snapshot without mutating document, fit, raster or UI
   * state.
   */
  getSnapshot = (): EditorSnapshot => this.state;
  /**
   * Subscribe to snapshot changes; returns an unsubscribe function suitable for React
   * `useSyncExternalStore`.
   */
  subscribe = (callback: () => void): (() => void) => {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  };
  /**
   * Install or clear the unsaved-work guard. The ready-made editor installs its own
   * dialog guard while mounted.
   */
  setGuard(guard: ControllerOptions["guard"]): void {
    this.options.guard = guard;
  }
  private emit(patch: Partial<EditorSnapshot> = {}): void {
    if (patch.fit) freeze(patch.fit);
    const d = patch.document ?? this.state.document;
    const ack = Math.max(
      this.saved.get(d.id) ?? -1,
      this.draftSaved.get(d.id) ?? -1,
    );
    this.state = {
      ...this.state,
      ...patch,
      ...(patch.error === null ? { errorDetail: null } : {}),
      dirty: Boolean(d.sourceImage) && ack < d.documentRevision,
      savedRevision: this.saved.get(d.id) ?? null,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
    this.listeners.forEach((fn) => {
      fn();
    });
  }
  /** Expose an error through the snapshot and host callback. AbortError is ignored. */
  reportError(error: unknown): void {
    if (!abortError(error)) {
      const message = error instanceof Error ? error.message : String(error);
      const detail = {
        code: error instanceof GeoreferenceError ? error.code : "EDITOR",
        message,
        operationId:
          error instanceof GeoreferenceError ? error.operationId : undefined,
        recoverable:
          error instanceof GeoreferenceError ? error.recoverable : true,
      };
      this.emit({ error: message, errorDetail: detail });
      this.options.onError?.(detail);
    }
  }
  /**
   * Advance revisions atomically; alignment edits cancel stale jobs and invalidate
   * confirmation/review.
   */
  private commit(document: Document, alignment: boolean, record = true): void {
    const old = this.state.document;
    const previewChanged =
      JSON.stringify([
        old.output.resampler,
        old.output.sourceNoData,
        old.output.noData,
      ]) !==
      JSON.stringify([
        document.output.resampler,
        document.output.sourceNoData,
        document.output.noData,
      ]);
    if (record) {
      this.undoStack.push(old);
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
    }
    document.documentRevision = old.documentRevision + 1;
    if (alignment) {
      document.alignmentRevision = old.alignmentRevision + 1;
      document.confirmedAlignmentRevision = null;
      document.featuresReviewedAgainstAlignmentRevision = null;
      for (const p of Object.values(document.provenanceByFeatureId))
        p.lastReviewedAgainstAlignmentRevision = null;
      this.fitAbort?.abort();
      this.exportAbort?.abort();
    }
    if (alignment || previewChanged) {
      this.fitAbort?.abort();
      this.fitGeneration++;
    }
    this.emit({
      document: freeze(document),
      error: null,
      errorDetail: null,
      ...(alignment || previewChanged
        ? ({
            fit: null,
            fitRevision: null,
            preview: null,
            fitting: "idle",
            exporting:
              this.state.exporting === "running"
                ? "cancelled"
                : this.state.exporting,
          } as const)
        : {}),
    });
    this.options.onChange?.(this.state.document);
    if (alignment || previewChanged) this.autoRefit();
  }
  /**
   * Change preview policy without editing the document. Switching to manual cancels
   * an in-flight preview; switching to automatic fits the current complete pairs when
   * the selected model has enough enabled points. Full rank/domain validation remains
   * in the worker. Valid existing results are retained.
   */
  setPreviewMode(previewMode: PreviewMode): void {
    if (!["manual", "automatic"].includes(previewMode))
      fail("PREVIEW_MODE", "Preview mode must be manual or automatic.");
    if (previewMode === this.state.previewMode) return;
    this.fitAbort?.abort();
    this.fitGeneration++;
    this.emit({
      previewMode,
      fitting:
        this.state.fitting === "running" ? "cancelled" : this.state.fitting,
    });
    if (!this.state.fit) this.autoRefit();
  }
  private autoRefit(): void {
    if (
      this.state.previewMode === "automatic" &&
      !this.state.pendingImagePoint &&
      this.state.document.gcps.filter((p) => p.enabled).length >=
        MODELS[this.state.document.model].minimum
    )
      void this.refit();
  }
  private requireAlign(): void {
    if (!this.state.document.sourceImage || !this.file)
      fail("IMAGE", "Load matching source image bytes first.");
    if (this.state.mode !== "align")
      fail("LOCKED", "Return to alignment before editing GCPs.");
  }
  private validFit(): Fit {
    if (
      !this.state.fit ||
      this.state.fitRevision !== this.state.document.alignmentRevision ||
      !this.file
    )
      return fail(
        "FIT",
        "A valid fit for the current image/alignment is required.",
      );
    return this.state.fit;
  }
  private tag(): JobTag {
    return {
      documentId: this.state.document.id,
      imageId: this.state.document.sourceImage?.id ?? "",
      alignmentRevision: this.state.document.alignmentRevision,
    };
  }
  /**
   * Cancel the previous fit, fit the current alignment and render its preview. Stale
   * results are discarded; failures update snapshot state rather than reject this
   * promise.
   */
  async refit(): Promise<void> {
    if (this.state.pendingImagePoint) {
      this.reportError(
        new GeoreferenceError(
          "PENDING_PAIR",
          "Complete or cancel the pending point pair before running alignment.",
        ),
      );
      return;
    }
    this.fitAbort?.abort();
    const metadata = this.state.document.sourceImage,
      file = this.file;
    if (!metadata || !file) return;
    const tag = this.tag(),
      generation = ++this.fitGeneration,
      d = this.state.document,
      abort = new AbortController();
    this.fitAbort = abort;
    this.emit({
      fitting: "running",
      error: null,
      errorDetail: null,
      fit: null,
      fitRevision: null,
      preview: null,
    });
    try {
      const { fit } = await this.options.engine.run(
        {
          kind: "fit",
          gcps: d.gcps,
          model: d.model,
          workingCrs: d.workingCrs,
          metadata,
        },
        tag,
        { signal: abort.signal },
      );
      if (generation !== this.fitGeneration || abort.signal.aborted) return;
      const result = await this.options.engine.run(
        {
          kind: "render",
          file,
          metadata,
          fit: fit!,
          workingCrs: d.workingCrs,
          output: {
            crs: d.workingCrs,
            resampler: d.output.resampler,
            sourceNoData: d.output.sourceNoData,
            noData: d.output.noData,
          },
          preview: true,
        },
        tag,
        { signal: abort.signal },
      );
      if (generation !== this.fitGeneration || abort.signal.aborted) return;
      this.emit({
        fit: fit!,
        fitRevision: tag.alignmentRevision,
        preview: result.raster!,
        fitting: "succeeded",
        error: null,
      });
    } catch (e) {
      if (generation === this.fitGeneration && !abort.signal.aborted) {
        this.emit({ fitting: "failed", fit: null, preview: null });
        this.reportError(e);
      }
    }
  }
  /**
   * Set or cancel the image endpoint of an unfinished pair. Requires image bytes and
   * alignment mode.
   */
  setPendingPoint(point: XY | null): void {
    this.requireAlign();
    this.emit({ pendingImagePoint: point });
  }
  /**
   * Commit an enabled pair with a stable ID and a target coordinate snapshot. Invalidates confirmation/review and schedules fitting.
   * @param image - Canonical original-resolution pixels.
   * @param target - Coordinate in `crs`.
   * @param crs - Target CRS; defaults to working CRS.
   * @param reference - Optional snapping provenance.
   */
  addGcp(
    image: XY,
    target: XY,
    crs = this.state.document.workingCrs,
    reference?: Gcp["reference"],
  ): void {
    this.requireAlign();
    if (![...image, ...target].every(Number.isFinite))
      fail("COORDINATE", "Coordinates must be finite.");
    const d = clone(this.state.document);
    if (d.gcps.length >= DEFAULT_LIMITS.maxGcps)
      fail("BUDGET", "Maximum 128 GCPs.");
    d.gcps.push({
      id: uid(),
      label: Math.max(0, ...d.gcps.map((p) => p.label)) + 1,
      enabled: true,
      image: [...image],
      target: [...target],
      crs,
      reference,
    });
    this.emit({ pendingImagePoint: null });
    this.commit(d, true);
  }
  /**
   * Edit either endpoint, target CRS or enabled state by ID. Requires alignment mode and
   * invalidates the fit; unknown IDs are ignored.
   */
  updateGcp(
    id: string,
    patch: Partial<Pick<Gcp, "image" | "target" | "crs" | "enabled">>,
  ): void {
    this.requireAlign();
    const d = clone(this.state.document),
      gcp = d.gcps.find((p) => p.id === id);
    if (!gcp) return;
    Object.assign(gcp, clone(patch));
    this.commit(d, true);
  }
  /** Delete a pair and schedule fitting. Requires alignment mode. */
  removeGcp(id: string): void {
    this.requireAlign();
    const d = clone(this.state.document);
    d.gcps = d.gcps.filter((p) => p.id !== id);
    this.commit(d, true);
  }
  /**
   * Replace all pairs as one undoable alignment edit, for example after `.points` import.
   * Input is cloned.
   */
  replaceGcps(gcps: Gcp[]): void {
    this.requireAlign();
    const d = clone(this.state.document);
    d.gcps = clone(gcps);
    this.commit(d, true);
  }
  /**
   * Select the exact model and invalidate confirmation/review. Requires alignment mode.
   */
  setModel(model: Model): void {
    this.requireAlign();
    const d = clone(this.state.document);
    d.model = model;
    this.commit(d, true);
  }
  /**
   * Change fitting CRS while preserving GCP target CRSs and geographic drawings. Requires
   * alignment mode.
   */
  setWorkingCrs(crs: string): void {
    this.requireAlign();
    const d = clone(this.state.document);
    d.workingCrs = crs;
    this.commit(d, true);
  }
  /**
   * Replace output settings as one undoable edit. Resampling/no-data changes regenerate
   * preview; output bounds/resolution apply to final export.
   */
  setOutput(output: OutputSettings): void {
    const d = clone(this.state.document);
    d.output = clone(output);
    this.commit(d, false);
  }
  /** Set or remove a provider status without changing the document. */
  setReferenceStatus(id: string, status: ReferenceStatus | null): void {
    const references = { ...this.state.references };
    if (status) references[id] = { ...status };
    else delete references[id];
    this.emit({ references });
  }
  /** Change transient overlay opacity/visibility without document history. */
  setDisplay(patch: {
    /** Overlay opacity from 0 to 1. */
    opacity?: number;
    /** Whether the overlay is shown. */
    visible?: boolean;
  }): void {
    this.emit(patch);
  }
  /**
   * Set a canonical-pixel `[x, y, width, height]` viewport with positive dimensions.
   * Debounced view history is separate from document undo.
   */
  setImageView(view: [number, number, number, number]): void {
    if (
      view.length !== 4 ||
      !view.every(Number.isFinite) ||
      view[2] <= 0 ||
      view[3] <= 0
    )
      fail(
        "VIEW",
        "Image view must have finite coordinates and positive dimensions.",
      );
    if (this.imageHistoryIndex < 0) {
      this.imageHistory = [[...view]];
      this.imageHistoryIndex = 0;
    }
    this.emit({ imageView: [...view] });
    clearTimeout(this.imageHistoryTimer);
    this.imageHistoryTimer = setTimeout(() => this.recordImageView(), 180);
  }
  private recordImageView(): void {
    const view = this.state.imageView;
    if (
      !view ||
      JSON.stringify(view) ===
        JSON.stringify(this.imageHistory[this.imageHistoryIndex])
    )
      return;
    this.imageHistory = this.imageHistory.slice(0, this.imageHistoryIndex + 1);
    this.imageHistory.push([...view]);
    if (this.imageHistory.length > 50) this.imageHistory.shift();
    this.imageHistoryIndex = this.imageHistory.length - 1;
  }
  /** Navigate bounded image-view history: -1 goes back, 1 goes forward. */
  navigateImageHistory(direction: -1 | 1): void {
    clearTimeout(this.imageHistoryTimer);
    this.recordImageView();
    const index = this.imageHistoryIndex + direction;
    if (index < 0 || index >= this.imageHistory.length) return;
    this.imageHistoryIndex = index;
    this.emit({ imageView: [...this.imageHistory[index]] });
  }
  /** Configure one-way image/map navigation without modifying alignment. */
  setLinkedNavigation(
    linkedNavigation: EditorSnapshot["linkedNavigation"],
  ): void {
    this.emit({ linkedNavigation });
  }
  /**
   * Activate a package tool. Drawing tools require opt-in digitizing and a valid fit in
   * the drawing stage.
   */
  setTool(tool: Tool): void {
    if (["Point", "LineString", "Polygon", "modify"].includes(tool)) {
      if (!this.options.digitizing || this.state.mode !== "draw")
        fail("DRAW", "Confirm alignment before activating a drawing tool.");
      this.validFit();
    }
    if (tool === "gcp") this.requireAlign();
    this.emit({
      tool,
      pendingImagePoint: tool === "gcp" ? this.state.pendingImagePoint : null,
    });
    this.options.onActiveToolChange?.(tool);
  }
  /** Cancel the unfinished pair and return to navigation. */
  cancelPending(): void {
    this.emit({ pendingImagePoint: null });
    this.setTool("navigate");
  }
  /**
   * Confirm exactly the current valid alignment. Enters drawing mode if enabled; existing
   * drawings still require explicit review.
   */
  confirm(): void {
    this.validFit();
    const d = clone(this.state.document);
    d.confirmedAlignmentRevision = d.alignmentRevision;
    if (d.features.features.length === 0)
      d.featuresReviewedAgainstAlignmentRevision = d.alignmentRevision;
    this.commit(d, false);
    this.emit({ mode: this.options.digitizing ? "draw" : "align" });
    this.setTool("navigate");
  }
  /**
   * Leave drawing mode. Later alignment edits invalidate confirmation/review without
   * moving drawings.
   */
  returnToAlignment(): void {
    this.setTool("navigate");
    this.emit({ mode: "align", pendingImagePoint: null });
  }
  /**
   * Mark current drawings reviewed against the confirmed fit. Does not move or save them.
   */
  reviewFeatures(): void {
    const d = clone(this.state.document);
    this.validFit();
    if (d.confirmedAlignmentRevision !== d.alignmentRevision)
      fail("REVIEW", "Confirm the current alignment first.");
    d.featuresReviewedAgainstAlignmentRevision = d.alignmentRevision;
    Object.values(d.provenanceByFeatureId).forEach((p) => {
      p.lastReviewedAgainstAlignmentRevision = d.alignmentRevision;
    });
    this.commit(d, false);
  }
  /**
   * Replace geographic drawings as one undoable edit in drawing mode. Requires stable
   * string IDs and JSON properties; topology errors remain editable but block accepted
   * saving.
   */
  setFeatures(features: Features): void {
    if (this.state.mode !== "draw" || !this.options.digitizing)
      fail("DRAW", "Confirm alignment before editing features.");
    assertJson(features);
    const structuralErrors = validateFeatures(features, "draft");
    if (structuralErrors.length) fail("GEOMETRY", structuralErrors.join(" "));
    const d = clone(this.state.document);
    d.features = clone(features);
    d.featureRevision++;
    const entries = features.features.map((f) => {
      if (typeof f.id !== "string" || !f.id)
        return fail("IDENTITY", "Feature IDs must be nonempty strings.");
      const existing = Object.hasOwn(d.provenanceByFeatureId, f.id)
        ? d.provenanceByFeatureId[f.id]
        : undefined;
      return [
        f.id,
        existing ?? {
          sourceImageId: d.sourceImage!.id,
          createdAgainstAlignmentRevision: d.alignmentRevision,
          lastReviewedAgainstAlignmentRevision: d.alignmentRevision,
        },
      ];
    });
    d.provenanceByFeatureId = Object.fromEntries(entries);
    this.commit(d, false);
    const errors = validateFeatures(features);
    if (errors.length) this.emit({ error: errors.join(" ") });
  }
  /** Remove a document feature and its provenance by ID. Requires drawing mode. */
  deleteFeature(id: string): void {
    const f = clone(this.state.document.features);
    f.features = f.features.filter((v) => v.id !== id);
    this.setFeatures(f);
  }
  /**
   * Replace host-defined JSON properties, preserving identity and geometry. Unknown IDs
   * are ignored.
   */
  updateProperties(id: string, properties: Record<string, unknown>): void {
    const f = clone(this.state.document.features);
    const feature = f.features.find((v) => v.id === id);
    if (feature) {
      feature.properties = clone(properties);
      this.setFeatures(f);
    }
  }
  /**
   * Undo an edit while advancing revisions; historical confirmation cannot revive stale
   * alignment.
   */
  undo(): void {
    this.history(this.undoStack, this.redoStack);
  }
  /** Redo an edit while advancing revisions and preserving confirmation rules. */
  redo(): void {
    this.history(this.redoStack, this.undoStack);
  }
  private history(from: Document[], to: Document[]): void {
    const previous = from.pop();
    if (!previous) return;
    const current = this.state.document;
    to.push(current);
    const alignment =
      JSON.stringify([previous.gcps, previous.model, previous.workingCrs]) !==
      JSON.stringify([current.gcps, current.model, current.workingCrs]);
    const d = clone(previous);
    d.alignmentRevision = current.alignmentRevision;
    d.featureRevision = current.featureRevision + 1;
    // Never resurrect an acceptance recorded against an older alignment.
    d.confirmedAlignmentRevision = current.confirmedAlignmentRevision;
    d.featuresReviewedAgainstAlignmentRevision =
      current.featuresReviewedAgainstAlignmentRevision;
    if (alignment) {
      this.emit({ mode: "align" });
      this.setTool("navigate");
    }
    this.commit(d, alignment, false);
  }
  /**
   * Check image bytes, current fit, confirmation, review and accepted geometry validity.
   * Handler availability and drawing bounds are additionally checked by `save`.
   */
  canSaveFeatures(): boolean {
    const d = this.state.document;
    return Boolean(
      this.file &&
        this.state.fit &&
        this.state.fitRevision === d.alignmentRevision &&
        d.confirmedAlignmentRevision === d.alignmentRevision &&
        d.featuresReviewedAgainstAlignmentRevision === d.alignmentRevision &&
        validateFeatures(d.features).length === 0,
    );
  }
  /**
   * Submit a frozen revision snapshot to the host.
   *
   * Concurrent calls share the in-flight promise. Retries for the same document/revision/kind reuse the request ID. Older request success acknowledges only that revision, leaving newer edits dirty. Draft saves can preserve unconfirmed work; accepted-feature saves require current confirmation, review and valid geometry.
   * @param kind - `features` (default) or `draft`, selecting the host callback.
   * @throws {@link GeoreferenceError} For missing handlers or ineligible features. Host rejections propagate and retain the draft.
   */
  async save(kind: "features" | "draft" = "features"): Promise<void> {
    if (this.savePromise) return this.savePromise;
    const d = this.state.document;
    if (
      kind === "features" &&
      (!this.options.onSave || !this.canSaveFeatures())
    )
      fail(
        "SAVE",
        "Feature saving requires a host handler, current confirmation, valid geometries and explicit feature review.",
      );
    if (kind === "draft" && !this.options.onSaveDraft)
      fail(
        "SAVE",
        "No host draft-save handler is configured. Export session JSON or discard/cancel.",
      );
    if (this.options.drawingBounds && kind === "features") {
      const b = this.options.drawingBounds;
      for (const f of d.features.features) {
        const coordinates =
          f.geometry.type === "Point"
            ? [f.geometry.coordinates]
            : f.geometry.type === "LineString"
              ? f.geometry.coordinates
              : f.geometry.coordinates.flat();
        if (
          coordinates.some(
            (p) => p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3],
          )
        )
          fail(
            "DRAW_BOUNDS",
            "A drawing is outside the configured longitude/latitude drawing bounds.",
          );
      }
    }
    if (
      !this.saveRequest ||
      this.saveRequest.documentId !== d.id ||
      this.saveRequest.revision !== d.documentRevision ||
      this.saveRequest.kind !== kind
    )
      this.saveRequest = {
        documentId: d.id,
        revision: d.documentRevision,
        id: uid(),
        kind,
      };
    const requestId = this.saveRequest.id;
    const snapshot = freeze(clone(d));
    const rmse = kind === "features" ? this.validFit().rmse : 0;
    this.emit({ saving: "running", error: null });
    const run = async () => {
      try {
        if (kind === "draft")
          await this.options.onSaveDraft!({ requestId, document: snapshot });
        else
          await this.options.onSave!(
            freeze({
              requestId,
              semantics: "replace-document-features" as const,
              documentId: d.id,
              documentRevision: d.documentRevision,
              document: snapshot,
              features: snapshot.features,
              engine: ENGINE_VERSION,
              diagnostics: {
                rmse,
                definition: "sqrt(sum(||T(p)-q||²)/enabledCount)",
                crs: d.workingCrs,
              },
            }),
          );
        const map = kind === "draft" ? this.draftSaved : this.saved;
        map.set(d.id, Math.max(map.get(d.id) ?? -1, d.documentRevision));
        if (this.state.document.id === d.id) this.emit({ saving: "succeeded" });
      } catch (e) {
        if (this.state.document.id === d.id) {
          this.emit({ saving: "failed" });
          this.reportError(e);
        }
        throw e;
      }
    };
    this.savePromise = Promise.resolve()
      .then(run)
      .finally(() => {
        this.savePromise = undefined;
      });
    return this.savePromise;
  }
  /**
   * Repeat the guard if edits arrive during a decision/save; never discard an unreviewed
   * revision.
   */
  private async mayReplace(): Promise<boolean> {
    while (this.state.dirty) {
      const d = this.state.document,
        kind = this.options.onSaveDraft
          ? "draft"
          : this.options.onSave && this.canSaveFeatures()
            ? "features"
            : null;
      const decision =
        (await this.options.guard?.({
          document: d,
          canSave: Boolean(kind),
          saveKind: kind,
        })) ?? "cancel";
      if (decision === "cancel") return false;
      if (decision === "save") {
        if (!kind) return false;
        try {
          await this.save(kind);
        } catch {
          return false;
        }
      }
      if (
        this.state.document.id === d.id &&
        this.state.document.documentRevision === d.documentRevision
      )
        return true;
      // New edits arrived during guard/save: ask again for the newer revision.
    }
    return true;
  }
  /**
   * Inspect and select local bytes, guarding unsaved work before replacement. Accepted replacement creates a new document, cancels old jobs and preserves the host map view.
   * @returns True on completion; false on cancellation, supersession or load failure. Errors appear in the snapshot.
   */
  async loadImage(file: File): Promise<boolean> {
    return this.replace(file);
  }
  /**
   * Guard unsaved work and clear the image, releasing image-dependent resources. Returns
   * false if cancelled or superseded.
   */
  async removeImage(): Promise<boolean> {
    return this.replace(null);
  }
  /**
   * Restore a validated session using matching original bytes. SHA-256, dimensions and orientation must match; current unsaved work is guarded.
   * @returns Whether restoration completed. Invalid JSON/schema rejects before replacement; image mismatch appears in the snapshot.
   */
  async restoreSession(text: string, file: File): Promise<boolean> {
    return this.replace(file, parseSession(text));
  }
  private async replace(
    file: File | null,
    restored?: Document,
  ): Promise<boolean> {
    this.loadAbort?.abort();
    const generation = ++this.generation,
      abort = new AbortController();
    this.loadAbort = abort;
    this.emit({ loading: "running", error: null });
    try {
      let metadata: ImageMetadata | null = null,
        blob: Blob | null = null;
      if (file) {
        const result = await this.options.engine.run(
          { kind: "inspect", file },
          this.tag(),
          { signal: abort.signal },
        );
        metadata = result.metadata!;
        blob = result.imagePreview!;
        if (
          restored &&
          (!restored.sourceImage ||
            restored.sourceImage.fingerprint !== metadata.fingerprint ||
            restored.sourceImage.width !== metadata.width ||
            restored.sourceImage.height !== metadata.height ||
            restored.sourceImage.orientation !== metadata.orientation)
        )
          fail(
            "IDENTITY",
            "Session image fingerprint, dimensions or orientation does not match.",
          );
      }
      if (
        generation !== this.generation ||
        !(await this.mayReplace()) ||
        generation !== this.generation
      ) {
        if (generation === this.generation) this.emit({ loading: "cancelled" });
        return false;
      }
      this.fitAbort?.abort();
      this.exportAbort?.abort();
      this.fitGeneration++;
      if (this.state.imageUrl) URL.revokeObjectURL(this.state.imageUrl);
      this.file = file;
      this.previewBlob = blob;
      clearTimeout(this.imageHistoryTimer);
      this.imageHistory = [];
      this.imageHistoryIndex = -1;
      this.undoStack = [];
      this.redoStack = [];
      const d = restored
        ? clone(restored)
        : createDocument(this.state.document.workingCrs);
      if (metadata && !restored) {
        d.sourceImage = metadata;
        d.documentRevision = 1;
        d.alignmentRevision = 1;
      }
      if (metadata && restored)
        d.sourceImage = {
          ...metadata,
          id: restored.sourceImage!.id,
          ...(restored.sourceImage!.hostAssetId
            ? { hostAssetId: restored.sourceImage!.hostAssetId }
            : {}),
        };
      this.emit({
        document: freeze(d),
        fit: null,
        fitRevision: null,
        preview: null,
        pendingImagePoint: null,
        mode: "align",
        tool: "navigate",
        imageUrl: blob ? URL.createObjectURL(blob) : null,
        imageView: null,
        linkedNavigation: "off",
        loading: "succeeded",
        fitting: "idle",
        exporting: "idle",
        saving: "idle",
        error: null,
        errorDetail: null,
      });
      this.options.onActiveToolChange?.("navigate");
      this.options.onChange?.(this.state.document);
      if (file) this.autoRefit();
      return true;
    } catch (e) {
      if (generation === this.generation) {
        this.emit({ loading: abortError(e) ? "cancelled" : "failed" });
        this.reportError(e);
      }
      return false;
    }
  }
  /**
   * Replace the explicitly enabled formats without changing session data. Cancels
   * pending export/loading work so a removed format cannot deliver a late result.
   */
  setExportFormats(formats: readonly ExportFormat[]): void {
    const exportFormats = validateExportFormats(formats);
    if (this.state.exporting === "running") this.cancelExport();
    this.emit({ exportFormats });
  }
  /** Return an eligibility explanation, or null when a configured format can run. */
  getExportUnavailable(id: string): string | null {
    const format = this.state.exportFormats.find((entry) => entry.id === id);
    if (!format) return "Export format is not configured.";
    if (!this.file || !this.state.document.sourceImage)
      return "Load the source image first.";
    if (
      format.requiresFit !== false &&
      (!this.state.fit ||
        this.state.fitRevision !== this.state.document.alignmentRevision)
    )
      return "A valid fit for the current alignment is required.";
    return format.unavailable?.(this.state.document, this.state.fit) ?? null;
  }
  /**
   * Run an explicitly configured lazy exporter against a frozen revision snapshot.
   * No format is enabled by default. Lazy-load failures are retryable. Cancellation
   * is observable while loading as well as processing, and stale results are ignored.
   * @param id - Registered format ID.
   * @returns Artifacts for the submitted revision, or null on cancelled/stale/failed
   * processing. Missing configuration, ineligible input and concurrent export reject.
   */
  async export(id: string): Promise<ExportResult | null> {
    if (this.state.exporting === "running")
      fail("BUSY", "An export is already running.");
    const format = this.state.exportFormats.find((entry) => entry.id === id);
    if (!format)
      fail("EXPORT_DISABLED", `Export format '${id}' is not configured.`);
    const unavailable = this.getExportUnavailable(id);
    if (unavailable) fail("EXPORT_UNAVAILABLE", unavailable);
    const d = this.state.document;
    const context = {
      document: d,
      fit: this.state.fit,
      preview: this.state.preview,
      file: this.file,
      engine: this.options.engine,
      tag: this.tag(),
    };
    const abort = new AbortController();
    this.exportAbort = abort;
    this.emit({ exporting: "running", progress: 0, error: null });
    try {
      const exporter = await abortable(format!.load(), abort.signal);
      abort.signal.throwIfAborted();
      const result = await abortable(
        exporter.run({
          ...context,
          signal: abort.signal,
          onProgress: (progress) => {
            if (!abort.signal.aborted && this.exportAbort === abort)
              this.emit({ progress: Math.max(0, Math.min(1, progress)) });
          },
        }),
        abort.signal,
      );
      if (
        abort.signal.aborted ||
        this.exportAbort !== abort ||
        this.state.document.id !== d.id ||
        this.state.document.alignmentRevision !== d.alignmentRevision
      )
        return null;
      if (
        !(result.blob instanceof Blob) ||
        !result.files.length ||
        result.files[0].blob !== result.blob
      )
        fail(
          "EXPORT_PLUGIN",
          "Exporter must return a primary Blob and matching file list.",
        );
      this.emit({ exporting: "succeeded", progress: 1 });
      return { ...result, format: id, document: d };
    } catch (error) {
      if (
        !abort.signal.aborted &&
        this.exportAbort === abort &&
        this.state.document.id === d.id
      ) {
        this.emit({ exporting: abortError(error) ? "cancelled" : "failed" });
        this.reportError(error);
      }
      return null;
    }
  }
  /**
   * Convenience alias for export("geotiff"). Requires an explicitly registered
   * GeoTIFF plugin; importing core alone never enables or loads an encoder.
   */
  async exportRaster(): Promise<
    | (ExportResult & {
        /** Full-resolution rendered pixels. */
        raster: Raster;
      })
    | null
  > {
    const result = await this.export("geotiff");
    if (!result) return null;
    if (!result.raster)
      fail("EXPORT_PLUGIN", "GeoTIFF exporter did not return its raster.");
    return result as ExportResult & { raster: Raster };
  }
  /** Convenience alias for export("world-file"); requires that optional plugin. */
  async exportWorldFile(): Promise<
    | (ExportResult & {
        /** Original-pixel placement and explicit CRS. */
        worldFile: {
          /** Six world-file lines. */
          text: string;
          /** Placement CRS. */
          crs: string;
        };
      })
    | null
  > {
    const result = await this.export("world-file");
    if (!result) return null;
    if (!result.worldFile)
      fail("EXPORT_PLUGIN", "World-file exporter did not return placement.");
    return result as ExportResult & {
      worldFile: { text: string; crs: string };
    };
  }
  /** Abort the active export and immediately expose its cancelled state. */
  cancelExport(): void {
    this.exportAbort?.abort();
    this.emit({ exporting: "cancelled" });
  }
  /**
   * Resume after suspension, recreating the image URL and restarting fitting if needed.
   * Safe for Strict Mode effect setup.
   */
  start(): void {
    if (this.previewBlob && !this.state.imageUrl)
      this.emit({ imageUrl: URL.createObjectURL(this.previewBlob) });
    if (this.file && !this.state.fit) this.autoRefit();
  }
  /**
   * Cancel image/fit/export work and revoke the preview URL, retaining document and
   * source bytes for remount. Pending host saves are not cancelled.
   */
  suspend(): void {
    clearTimeout(this.imageHistoryTimer);
    this.fitAbort?.abort();
    this.exportAbort?.abort();
    this.loadAbort?.abort();
    this.generation++;
    this.fitGeneration++;
    if (this.state.imageUrl) URL.revokeObjectURL(this.state.imageUrl);
    this.emit({
      imageUrl: null,
      fitting:
        this.state.fitting === "running" ? "cancelled" : this.state.fitting,
      exporting:
        this.state.exporting === "running" ? "cancelled" : this.state.exporting,
      loading:
        this.state.loading === "running" ? "cancelled" : this.state.loading,
    });
  }
  /**
   * Suspend and release retained bytes, previews, history and subscriptions. The host
   * separately disposes its engine when no other editor uses it.
   */
  dispose(): void {
    this.suspend();
    this.file = null;
    this.previewBlob = null;
    this.listeners.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.emit({ preview: null, fit: null });
  }
}
