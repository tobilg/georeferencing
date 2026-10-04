import {
  accuracy,
  points,
  session,
  worldFile,
} from "@georeferencing/plugins/data";
import { geoTiff } from "@georeferencing/plugins/geotiff";
import { jpeg } from "@georeferencing/plugins/jpeg";
import { pdf } from "@georeferencing/plugins/pdf";
import type OLMap from "ol/Map.js";

/** Enable every format in integration tests, independent of demo configuration. */
export function harnessExports(map: () => OLMap | undefined, definitions = {}) {
  return [
    geoTiff(),
    jpeg(),
    pdf({ map, definitions }),
    worldFile(),
    session(),
    points(definitions),
    accuracy(),
  ];
}
