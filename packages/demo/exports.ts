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

/** All demo formats are opt-in; hosts may register any subset. */
export function demoExports(map: () => OLMap | undefined, definitions = {}) {
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
