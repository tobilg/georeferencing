import { createWorkerEngine } from "@georeferencing/core/engine";
import { geoTiff } from "@georeferencing/plugins/geotiff";
import { jpeg } from "@georeferencing/plugins/jpeg";
import { pdf } from "@georeferencing/plugins/pdf";
import {
  type ControllerOptions,
  Georeferencer,
  GeoreferencerController,
} from "@georeferencing/react";
import type OLMap from "ol/Map.js";
import "@georeferencing/react/styles.css";

export function createEditor(
  workingCrs: string,
  persistFeatures: NonNullable<ControllerOptions["onSave"]>,
  persistDraft?: ControllerOptions["onSaveDraft"],
) {
  const engine = createWorkerEngine();
  const controller = new GeoreferencerController({
    workingCrs,
    engine,
    digitizing: true,
    exports: [geoTiff(), jpeg(), pdf()],
    onSave: persistFeatures,
    onSaveDraft: persistDraft,
  });
  return {
    controller,
    dispose() {
      controller.dispose();
      engine.dispose();
    },
  };
}

export function ImageEditor({
  map,
  controller,
}: {
  map: OLMap;
  controller: GeoreferencerController;
}) {
  return <Georeferencer controller={controller} referenceMap={map} />;
}
