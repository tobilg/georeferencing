import { GeoreferencerController } from "@georeferencing/core";
import { createWorkerEngine } from "@georeferencing/core/engine";
import {
  accuracy,
  geoTiff,
  jpeg,
  pdf,
  points,
  session,
  worldFile,
} from "@georeferencing/plugins";
export const controller = new GeoreferencerController({
  workingCrs: "EPSG:3857",
  engine: createWorkerEngine(),
  exports: [
    geoTiff(),
    jpeg(),
    pdf(),
    session(),
    points(),
    accuracy(),
    worldFile(),
  ],
});
