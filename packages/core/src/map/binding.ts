import type { GeoreferencerController } from "../core/controller.js";
import type { DatumGrids, Definitions } from "../core/projection.js";
import type { Extent } from "../core/types.js";
import type {
  ReferenceBase,
  ReferenceLoadStatus,
  ReferenceSource,
} from "./references.js";

/**
 * A captured frame of the host map, used for the optional map page of PDF reports.
 */
export interface MapCapture {
  /** PNG image of the currently rendered map. */
  image: Blob;
  /** CRS of `extent`. */
  crs: string;
  /** Visible map extent in `crs`. */
  extent: Extent;
  /** View rotation in radians; 0 for north-up maps. */
  rotation: number;
  /** Attribution text of the captured layers, when available. */
  attribution?: string;
}

/**
 * Live connection between one controller and one host map, created by a
 * {@link MapAdapter}.
 *
 * A binding owns only the layers, markers and interactions it adds. Optional members
 * are capabilities: editors hide controls whose method is absent.
 */
export interface MapBinding {
  /**
   * Remove every owned layer, interaction and listener and abort reference requests.
   * Idempotent. The host map, its layers and its view are preserved.
   */
  detach(): void;
  /** Fit the host view to the current preview overlay; no-op without a preview. */
  fitOverlay(): void;
  /** Abort an unfinished sketch and any pending control-point pair. */
  cancelDrawing(): void;
  /** Recompute the map size after its container changed size. */
  resize?(): void;
  /** Complete the active line or polygon sketch. Present when digitizing is supported. */
  finishDrawing?(): void;
  /** Step through recorded map views: -1 goes back, 1 goes forward. */
  navigateHistory?(direction: -1 | 1): void;
  /** Capture the currently rendered map for reports. */
  capture?(): Promise<MapCapture>;
}

/**
 * Attach a controller to a host map. Map-library packages such as
 * `@georeferencing/openlayers`, `@georeferencing/maplibre` and
 * `@georeferencing/leaflet` create adapters; hosts can implement their own.
 *
 * Create an adapter once per map and keep it stable (for example with `useMemo`):
 * React editors re-attach whenever the adapter identity changes.
 * @param controller - Editor store to display and edit.
 * @returns The live binding; call `detach` to release it.
 */
export type MapAdapter = (controller: GeoreferencerController) => MapBinding;

/**
 * Options shared by the map adapters in this project. Adapters may add library-specific
 * options. Keep the object stable: adapters read it once when attaching.
 * @typeParam R - Reference source kinds the adapter accepts.
 */
export interface MapAdapterOptions<R extends ReferenceBase = ReferenceSource> {
  /** Reference providers with unique IDs, displayed and optionally used for snapping. */
  references?: readonly R[];
  /** Host projection definitions for maps, references and control-point targets. */
  definitions?: Definitions;
  /**
   * Host-supplied NTv2 buffers registered in this realm; also supply them to the worker
   * engine.
   */
  datumGrids?: DatumGrids;
  /**
   * Delay before refreshing network references after map navigation, in milliseconds.
   * @defaultValue `150`
   */
  debounceMs?: number;
  /**
   * Optional map framing applied on attachment. It does not georeference the image or
   * constrain queries, drawings or output.
   */
  initialView?: {
    /** Initial map framing bounds. */
    extent: Extent;
    /** CRS of the framing extent. */
    crs: string;
  };
  /** Opt-in snapping for drawing/modify tools, independently of GCP reference snapping. */
  digitizingSnapping?: {
    /**
     * Snap drawings to providers with snapping configured.
     * @defaultValue `false`
     */
    references?: boolean;
    /**
     * Snap drawings to the editor's other draft features.
     * @defaultValue `false`
     */
    drafts?: boolean;
  };
  /**
   * Observe provider loading/error/completeness feedback; statuses also appear in the
   * controller snapshot.
   */
  onReferenceStatus?: (id: string, status: ReferenceLoadStatus) => void;
}
