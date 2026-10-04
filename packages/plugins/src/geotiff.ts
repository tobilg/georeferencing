/**
 * Optional GeoTIFF export; import from `@georeferencing/plugins/geotiff`.
 * @module @georeferencing/plugins/geotiff
 * @group @georeferencing/plugins
 */
import type { ExportFormat } from "@georeferencing/core";
import { geoTiffUnavailable } from "./tiff-options.js";
import type { RasterPluginOptions } from "./types.js";

export type { RasterPluginOptions } from "./types.js";

/**
 * Register lazy GeoTIFF export. Encoding runs in a dedicated plugin worker using
 * the controller engine's limits, projections, scheduler and cancellation.
 * No workers or heavy encoder code load until the user requests this format.
 */
export function geoTiff(options: RasterPluginOptions = {}): ExportFormat {
  return {
    id: "geotiff",
    label: "Export GeoTIFF",
    raster: true,
    unavailable: (document) => geoTiffUnavailable(document.output),
    load: async () => {
      const { renderAndEncode } = await import("./raster-export.js");
      return {
        run: (context) =>
          renderAndEncode(context, "geotiff", {
            ...options,
            workerFactory:
              options.workerFactory ??
              (options.workerUrl
                ? undefined
                : () =>
                    new Worker(
                      new URL("./workers/geotiff.js", import.meta.url),
                      { type: "module" },
                    )),
          }),
      };
    },
  };
}
