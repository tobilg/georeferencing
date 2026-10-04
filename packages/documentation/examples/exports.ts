import type { ExportFormat } from "@georeferencing/core";
import {
  accuracy,
  points,
  session,
  worldFile,
} from "@georeferencing/plugins/data";
import { geoTiff } from "@georeferencing/plugins/geotiff";
import { jpeg } from "@georeferencing/plugins/jpeg";
import { pdf } from "@georeferencing/plugins/pdf";

// Select only the formats your host needs. Omit `exports` to enable none.
export const formats = [
  geoTiff(),
  jpeg({ quality: 0.92, background: [255, 255, 255] }),
  pdf({ paper: "A4" }),
  session(),
  points(),
  accuracy(),
  worldFile(),
];

// A custom format follows the same revision/cancellation contract.
export const provenance: ExportFormat = {
  id: "provenance",
  label: "Export provenance",
  requiresFit: false,
  load: async () => ({
    async run({ document, signal }) {
      signal.throwIfAborted();
      const blob = new Blob(
        [
          JSON.stringify({
            documentId: document.id,
            revision: document.documentRevision,
            source: document.sourceImage,
          }),
        ],
        { type: "application/json" },
      );
      return { blob, files: [{ name: "provenance.json", blob }] };
    },
  }),
};
