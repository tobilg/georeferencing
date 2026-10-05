import type { MapCapture } from "@georeferencing/core/map";
import {
  accuracy,
  points,
  session,
  worldFile,
} from "@georeferencing/plugins/data";
import { geoTiff } from "@georeferencing/plugins/geotiff";
import { jpeg } from "@georeferencing/plugins/jpeg";
import { pdf } from "@georeferencing/plugins/pdf";

/**
 * All demo formats are opt-in; hosts may register any subset. `capture` returns the
 * current reference map for the PDF report, or undefined to omit the map page.
 */
export function demoExports(
  capture: () => Promise<MapCapture> | undefined,
  definitions = {},
) {
  return [
    geoTiff(),
    jpeg(),
    pdf({ capture, definitions }),
    worldFile(),
    session(),
    points(definitions),
    accuracy(),
  ];
}
