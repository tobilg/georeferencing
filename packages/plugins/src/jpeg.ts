/**
 * Optional georeferenced JPEG export; import from `@georeferencing/plugins/jpeg`.
 * @module jpeg
 */
import type { ExportFormat } from "@georeferencing/core";
import { GeoreferenceError } from "@georeferencing/core";
import type { JpegOptions } from "./types.js";

export type { JpegOptions } from "./types.js";

/**
 * Register lazy JPEG export with a pixel-centre world file and explicit CRS/source
 * JSON sidecar. Transparency is composited over the configured background.
 * @throws GeoreferenceError For an invalid quality or RGB background.
 */
export function jpeg(options: JpegOptions = {}): ExportFormat {
  const quality = options.quality ?? 0.92;
  const background = options.background ?? [255, 255, 255];
  if (
    !Number.isFinite(quality) ||
    quality < 0 ||
    quality > 1 ||
    background.length !== 3 ||
    background.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
  )
    throw new GeoreferenceError(
      "JPEG_OPTIONS",
      "JPEG quality must be 0–1 and background must contain three RGB bytes.",
    );
  return {
    id: "jpeg",
    label: "Export JPEG",
    raster: true,
    load: async () => {
      const { renderAndEncode } = await import("./raster-export.js");
      return {
        run: (context) =>
          renderAndEncode(
            context,
            "jpeg",
            {
              ...options,
              workerFactory:
                options.workerFactory ??
                (options.workerUrl
                  ? undefined
                  : () =>
                      new Worker(
                        new URL("./workers/jpeg.js", import.meta.url),
                        { type: "module" },
                      )),
            },
            { quality, background: [...background] },
          ),
      };
    },
  };
}
