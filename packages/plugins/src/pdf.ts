/**
 * Optional PDF report; import from `@georeferencing/plugins/pdf`.
 * @module pdf
 */
import type { ExportFormat } from "@georeferencing/core";
import type { ReportMap, ReportOptions } from "./report.js";

export type { ReportMap, ReportOptions, ReportView } from "./report.js";

/** Lazy report configuration; importing this type does not load pdf-lib. */
export interface PdfOptions extends Omit<ReportOptions, "map"> {
  /** Optional map or accessor resolved when export starts. Omit for raster-only reports. */
  map?: ReportMap | (() => ReportMap | undefined);
}

/** Register a PDF report without importing pdf-lib or report implementation eagerly. */
export function pdf(options: PdfOptions = {}): ExportFormat {
  return {
    id: "pdf",
    label: "PDF map & report",
    load: async () => {
      const { createPdfReport } = await import("./report.js");
      return {
        async run(context) {
          context.signal.throwIfAborted();
          if (!context.fit || !context.preview)
            throw Error("A fitted preview is required for a PDF report.");
          const blob = await createPdfReport(
            context.document,
            context.fit,
            context.preview,
            {
              ...options,
              map:
                typeof options.map === "function" ? options.map() : options.map,
            },
          );
          context.signal.throwIfAborted();
          return { blob, files: [{ name: "alignment-map-report.pdf", blob }] };
        },
      };
    },
  };
}
