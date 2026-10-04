/**
 * Ready-made editor, composable panels and subscription hook with optional exports.
 * Import from `@georeferencing/react`.
 * @module react
 */

export type {
  ControllerOptions,
  Document,
  Features,
  Gcp,
  ImageMetadata,
  SaveEnvelope,
} from "@georeferencing/core";
export { createDocument, GeoreferencerController } from "@georeferencing/core";
export type { GeoreferencerControls } from "./controls.js";
export { ALL_CONTROLS, MINIMAL_CONTROLS } from "./controls.js";
export type { GeoreferencerProps } from "./Georeferencer.js";
export { Georeferencer } from "./Georeferencer.js";
export { useGeoreferencer } from "./hooks/useGeoreferencer.js";
export type { Translate } from "./localization.js";
export { AlignmentPanel } from "./panels/AlignmentPanel.js";
export { FeaturePanel } from "./panels/FeaturePanel.js";
export { GcpPanel } from "./panels/GcpPanel.js";
export { ImagePanel } from "./panels/ImagePanel.js";
export { PreviewControls } from "./panels/PreviewControls.js";
export { ReferencePanel } from "./panels/ReferencePanel.js";
export { downloadBlob } from "./utils/downloadBlob.js";
