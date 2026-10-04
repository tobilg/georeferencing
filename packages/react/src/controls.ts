/**
 * Optional controls of the guided `Georeferencer` layout (used when `referenceView` is
 * supplied). Each flag adds expert controls on top of the minimal step-by-step flow;
 * omitted flags fall back to {@link MINIMAL_CONTROLS}. The classic layout always shows
 * every control.
 */
export interface GeoreferencerControls {
  /** Undo and redo buttons for point and drawing edits. */
  history: boolean;
  /**
   * Manual/automatic preview selector. When hidden, the controller's configured
   * `previewMode` applies and users run alignment with the main button.
   */
  previewMode: boolean;
  /** Transformation model selector while matching points. Hidden keeps the controller's model. */
  transformation: boolean;
  /**
   * Full control point table with editable coordinates, target CRS and residual columns.
   * When hidden, a compact list shows each point's use state and residual.
   */
  pointTable: boolean;
  /** Add a point pair by typing coordinates; the keyboard alternative to clicking. */
  manualEntry: boolean;
  /** Previous/next image and map views and linked image/map navigation. */
  navigation: boolean;
  /** Brightness, contrast and histogram stretch for the source image display. */
  displayAdjustment: boolean;
  /** Load status of configured reference providers. */
  referenceStatus: boolean;
  /** Raster output settings: CRS, resampling, compression, no-data, pixel size and bounds. */
  outputSettings: boolean;
  /** Restore a session, import QGIS `.points` and save drafts; also offers session downloads before the last step. */
  sessionFiles: boolean;
  /** Indicator for work that has not been saved by the host. */
  unsavedIndicator: boolean;
}

/** Default guided setup: the four-step flow with undo/redo and nothing else. */
export const MINIMAL_CONTROLS: Readonly<GeoreferencerControls> = Object.freeze({
  history: true,
  previewMode: false,
  transformation: false,
  pointTable: false,
  manualEntry: false,
  navigation: false,
  displayAdjustment: false,
  referenceStatus: false,
  outputSettings: false,
  sessionFiles: false,
  unsavedIndicator: false,
});

/** Every optional guided control enabled. */
export const ALL_CONTROLS: Readonly<GeoreferencerControls> = Object.freeze({
  history: true,
  previewMode: true,
  transformation: true,
  pointTable: true,
  manualEntry: true,
  navigation: true,
  displayAdjustment: true,
  referenceStatus: true,
  outputSettings: true,
  sessionFiles: true,
  unsavedIndicator: true,
});
