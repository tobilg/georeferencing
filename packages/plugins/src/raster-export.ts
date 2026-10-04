import type { ExportContent, ExportContext } from "@georeferencing/core";
import { fail } from "@georeferencing/core";
import type { RasterPluginOptions } from "./types.js";

/** Render once, then transfer the temporary raster through the selected codec worker. @internal */
export async function renderAndEncode(
  context: ExportContext,
  format: "geotiff" | "jpeg",
  worker: RasterPluginOptions,
  options?: Record<string, unknown>,
): Promise<ExportContent> {
  const { document: doc, fit, file, engine, tag, signal, onProgress } = context;
  if (!fit || !file || !doc.sourceImage)
    fail("FIT", "Raster export requires a matching image and fit.");
  // TIFF-only creation options do not affect JPEG rendering or its allocation estimate.
  const output =
    format === "jpeg"
      ? { ...doc.output, compression: "none" as const, predictor: 1 as const }
      : doc.output;
  const rendered = await engine.run(
    {
      kind: "render",
      file: file!,
      metadata: doc.sourceImage!,
      fit: fit!,
      workingCrs: doc.workingCrs,
      output,
      preview: false,
    },
    tag,
    { signal, onProgress: (value) => onProgress(value * 0.8) },
  );
  signal.throwIfAborted();
  if (!rendered.raster)
    fail("EXPORT_PLUGIN", "Rendering did not return pixels.");
  const encoded = await engine.run(
    { kind: "encode", format, raster: rendered.raster!, output, options },
    tag,
    { ...worker, signal, onProgress: (value) => onProgress(0.8 + value * 0.2) },
  );
  signal.throwIfAborted();
  if (!encoded.blob || !encoded.raster)
    fail("EXPORT_PLUGIN", "Encoder did not return bytes and pixels.");
  const blob = encoded.blob!,
    raster = encoded.raster!;
  const name = doc.sourceImage!.name;
  const files = [
    { name: `${name}.${format === "geotiff" ? "tif" : "jpg"}`, blob },
  ];
  if (format === "jpeg") {
    const [minX, minY, maxX, maxY] = raster.bounds;
    const dx = (maxX - minX) / raster.width,
      dy = (maxY - minY) / raster.height;
    const world = `${[dx, 0, 0, -dy, minX + dx / 2, maxY - dy / 2].join("\n")}\n`;
    files.push(
      { name: `${name}.jgw`, blob: new Blob([world], { type: "text/plain" }) },
      {
        name: `${name}.crs.json`,
        blob: new Blob(
          [
            JSON.stringify(
              {
                crs: raster.crs,
                bounds: raster.bounds,
                width: raster.width,
                height: raster.height,
                pixelConvention: "PixelIsArea",
                image: doc.sourceImage,
                documentId: doc.id,
                revision: doc.documentRevision,
                alignmentRevision: doc.alignmentRevision,
                format: "jpeg",
                quality: options?.quality,
                background: options?.background,
                note: "JPEG is lossy. Keep the image, world file and CRS metadata together.",
              },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        ),
      },
    );
  }
  return { blob, files, raster };
}
