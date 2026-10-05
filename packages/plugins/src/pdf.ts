/**
 * Optional PDF report; import from `@georeferencing/plugins/pdf`.
 * @module @georeferencing/plugins/pdf
 * @group @georeferencing/plugins
 */
import type { ExportFormat } from "@georeferencing/core";
import type { MapCapture } from "@georeferencing/core/map";
import type { ReportOptions } from "./report.js";

export type { ReportOptions } from "./report.js";

/** Lazy report configuration; importing this type does not load pdf-lib. */
export interface PdfOptions extends Omit<ReportOptions, "map"> {
  /**
   * Capture the host map when the export starts, for the report's map page; return
   * undefined to skip it. Use a map binding's `capture()` or an adapter's capture
   * function, such as `captureOpenLayersMap` or `captureMapLibreMap`. Omit for
   * raster-only reports.
   */
  capture?: () => MapCapture | undefined | Promise<MapCapture | undefined>;
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
              map: await options.capture?.(),
            },
          );
          context.signal.throwIfAborted();
          return { blob, files: [{ name: "alignment-map-report.pdf", blob }] };
        },
      };
    },
  };
}
