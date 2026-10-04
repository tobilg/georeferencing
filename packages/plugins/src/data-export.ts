import type { Definitions, Exporter } from "@georeferencing/core";
import type { WorldFileOptions } from "./serializers.js";
import { accuracyReport, exportPoints, worldFile } from "./serializers.js";

const textFile = (name: string, text: string, type = "application/json") => ({
  name,
  blob: new Blob([text], { type }),
});
/** @internal */
export const sessionExporter: Exporter = {
  async run({ document }) {
    const file = textFile("session.json", JSON.stringify(document, null, 2));
    return { blob: file.blob, files: [file] };
  },
};
/** @internal */
export function pointsExporter(definitions: Definitions): Exporter {
  return {
    async run({ document }) {
      const file = textFile(
        "image.points",
        exportPoints(document, definitions),
        "text/plain",
      );
      return { blob: file.blob, files: [file] };
    },
  };
}
/** @internal */
export const accuracyExporter: Exporter = {
  async run({ document, fit }) {
    if (!fit) throw Error("A valid alignment is required.");
    const file = textFile(
      "accuracy-report.json",
      accuracyReport(document, fit),
    );
    return { blob: file.blob, files: [file] };
  },
};
/** @internal */
export const worldFileExporter = (options: WorldFileOptions): Exporter => ({
  async run({ document, fit, file, engine, tag, signal, onProgress }) {
    if (!fit || !file || !document.sourceImage)
      throw Error("A matching image and fit are required.");
    const placement = worldFile(
      fit,
      document.workingCrs,
      document.output.crs,
      options,
    );
    const result = await engine.run(
      { kind: "normalize", file, metadata: document.sourceImage },
      tag,
      { signal, onProgress },
    );
    signal.throwIfAborted();
    if (!result.blob)
      throw Error("Image normalization did not return PNG bytes.");
    return {
      blob: result.blob,
      worldFile: placement,
      files: [
        { name: "image.png", blob: result.blob },
        textFile("image.pgw", placement.text, "text/plain"),
        textFile(
          "image.crs.json",
          JSON.stringify(
            {
              crs: placement.crs,
              image: document.sourceImage,
              documentId: document.id,
              revision: document.documentRevision,
              note: "Applies to the accompanying orientation-normalized original-resolution image.png",
            },
            null,
            2,
          ),
        ),
      ],
    };
  },
});
