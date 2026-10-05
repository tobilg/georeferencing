/**
 * Low-level PDF report creation with an optional captured map page; pdf-lib loads lazily.
 * Import from `@georeferencing/plugins/report`.
 * @module @georeferencing/plugins/report
 * @group @georeferencing/plugins
 */
import type { Definitions, Document, Fit, XY } from "@georeferencing/core";
import {
  coordinateUnits,
  ENGINE_VERSION,
  fail,
  forward,
  project,
} from "@georeferencing/core";
import type { Raster } from "@georeferencing/core/engine";
import type { MapCapture } from "@georeferencing/core/map";
import { accuracyReport } from "./serializers.js";
/**
 * Options for a locally generated PDF report. The map page is optional.
 */
export interface ReportOptions {
  /**
   * PDF paper size.
   * @defaultValue `"A4"`
   */
  paper?: "A4" | "A3" | "Letter";
  /**
   * Swap paper width and height.
   * @defaultValue `false`
   */
  landscape?: boolean;
  /**
   * Page margin in PDF points (1/72 inch); at least 15 and must leave 200 points of usable width/height.
   * @defaultValue `40`
   */
  margin?: number;
  /** Host projection definitions for report coordinate conversion and unit labels. */
  definitions?: Definitions;
  /**
   * Optional captured host-map frame, for example from a map binding's `capture()` or
   * `captureOpenLayersMap`. Omit for a report without the map page.
   */
  map?: MapCapture;
  /** Attribution override for the captured map; defaults to `map.attribution`. */
  attribution?: string;
}
async function png(canvas: HTMLCanvasElement): Promise<Blob> {
  try {
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(Error("Could not encode report image.")),
        "image/png",
      ),
    );
  } catch {
    return fail(
      "REPORT_CORS",
      "A map layer prevents canvas export. Configure CORS on its source, or generate the report without the optional host-map frame.",
    );
  }
}
/**
 * Create a local PDF with source identity, alignment diagnostics, GCPs, raster overview and an embedded full-precision alignment.json attachment. pdf-lib loads lazily.
 *
 * Training residuals are not independent accuracy measurements. The caller must pass document, fit and raster from the same alignment; use a controller export result for its exact revision.
 * @param doc - Revisioned document snapshot.
 * @param fit - Fit corresponding to that document alignment.
 * @param raster - Georeferenced preview/export pixels for that alignment.
 * @param options - Paper layout, projections and optional current map capture.
 * @returns PDF Blob suitable for download; no host persistence is performed.
 */
export async function createPdfReport(
  doc: Document,
  fit: Fit,
  raster: Raster,
  options: ReportOptions = {},
): Promise<Blob> {
  const capturedMap = options.map
    ? {
        frame: {
          crs: options.map.crs,
          extent: options.map.extent,
          rotation: options.map.rotation,
        },
        attribution:
          options.attribution ??
          options.map.attribution ??
          "Attribution: supplied by the host map.",
        blob: options.map.image,
      }
    : undefined;
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica),
    mono = await pdf.embedFont(StandardFonts.Courier);
  const sizes = {
    A4: [595.28, 841.89],
    A3: [841.89, 1190.55],
    Letter: [612, 792],
  };
  const paper = sizes[options.paper ?? "A4"],
    [pageWidth, pageHeight] = options.landscape ? [...paper].reverse() : paper;
  const margin = options.margin ?? 40,
    contentWidth = pageWidth - margin * 2;
  if (
    !Number.isFinite(margin) ||
    margin < 15 ||
    contentWidth < 200 ||
    pageHeight - margin * 2 < 200
  )
    fail(
      "REPORT_LAYOUT",
      "PDF margins leave insufficient room for the report.",
    );
  pdf.setTitle("Georeferencing map and alignment report");
  pdf.setProducer(ENGINE_VERSION);
  await pdf.attach(
    new TextEncoder().encode(accuracyReport(doc, fit)),
    "alignment.json",
    {
      mimeType: "application/json",
      description:
        "Complete Unicode source identity, revisioned document, coefficients and diagnostics",
    },
  );
  let page = pdf.addPage([pageWidth, pageHeight]),
    y = pageHeight - margin;
  const newPage = () => {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };
  // Standard fonts use WinAnsi: keep every encodable character (such as umlauts and
  // accents) and replace the rest; the attached JSON retains the full Unicode text.
  const encodable = new Set(font.getCharacterSet());
  const text = (value: string, size = 10, fixed = false) => {
    const safe = Array.from(value.normalize("NFC"), (character) => {
        const code = character.codePointAt(0)!;
        return code >= 0x20 && encodable.has(code) ? character : "?";
      }).join(""),
      width = Math.max(
        1,
        Math.floor(contentWidth / (size * (fixed ? 0.6 : 0.55))),
      );
    for (let i = 0; i < safe.length || i === 0; i += width) {
      if (y < margin + size) newPage();
      page.drawText(safe.slice(i, i + width), {
        x: margin,
        y,
        size,
        font: fixed ? mono : font,
        color: rgb(0.12, 0.2, 0.17),
      });
      y -= size + 5;
    }
  };
  const drawImage = async (blob: Blob, maxHeight: number) => {
    const image = await pdf.embedPng(await blob.arrayBuffer()),
      scale = Math.min(contentWidth / image.width, maxHeight / image.height);
    const width = image.width * scale,
      height = image.height * scale;
    if (y - height - 20 < margin) newPage();
    y -= height + 10;
    page.drawImage(image, { x: margin, y, width, height });
    return { x: margin, y, width, height };
  };
  text("Georeferencing map & alignment report", 20);
  text(
    `Source: ${doc.sourceImage?.name} | ${doc.sourceImage?.width} x ${doc.sourceImage?.height} pixels`,
  );
  text(`Document ${doc.id} / revision ${doc.documentRevision}`);
  text(
    `Model ${doc.model} | Working CRS ${doc.workingCrs} | Alignment revision ${doc.alignmentRevision}`,
  );
  text(
    `Confirmed: ${doc.confirmedAlignmentRevision === doc.alignmentRevision} | Feature review: ${doc.featuresReviewedAgainstAlignmentRevision === doc.alignmentRevision}`,
  );
  text(
    `Grid extent in ${raster.crs}: ${raster.bounds.map((v) => v.toPrecision(10)).join(", ")}`,
    9,
  );
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  canvas
    .getContext("2d")!
    .putImageData(
      new ImageData(
        raster.data as Uint8ClampedArray<ArrayBuffer>,
        raster.width,
        raster.height,
      ),
      0,
      0,
    );
  let imageBlob: Blob;
  try {
    imageBlob = await png(canvas);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
  const box = await drawImage(imageBlob, Math.min(350, pageHeight * 0.4));
  const toPage = (p: XY): XY => [
    box.x +
      ((p[0] - raster.bounds[0]) / (raster.bounds[2] - raster.bounds[0])) *
        box.width,
    box.y +
      ((p[1] - raster.bounds[1]) / (raster.bounds[3] - raster.bounds[1])) *
        box.height,
  ];
  const vectors = doc.gcps.map((gcp) => ({
    gcp,
    a: toPage(project(gcp.target, gcp.crs, raster.crs, options.definitions)),
    b: toPage(
      project(
        forward(fit, gcp.image),
        doc.workingCrs,
        raster.crs,
        options.definitions,
      ),
    ),
  }));
  const max = Math.max(
      0,
      ...vectors
        .filter((v) => v.gcp.enabled)
        .map(({ a, b }) => Math.hypot(b[0] - a[0], b[1] - a[1])),
    ),
    exaggeration =
      max > 1e-6
        ? Math.min(
            1000,
            Math.max(1, (Math.min(box.width, box.height) * 0.12) / max),
          )
        : 1;
  for (const { gcp, a, b } of vectors) {
    if (
      a[0] < box.x ||
      a[0] > box.x + box.width ||
      a[1] < box.y ||
      a[1] > box.y + box.height
    )
      continue;
    const color = gcp.enabled ? rgb(0.8, 0.25, 0.1) : rgb(0.4, 0.4, 0.4);
    page.drawCircle({ x: a[0], y: a[1], size: 2, color });
    page.drawText(String(gcp.label), {
      x: a[0] + 3,
      y: a[1] + 3,
      size: 8,
      font,
      color,
    });
    if (gcp.enabled)
      page.drawLine({
        start: { x: a[0], y: a[1] },
        end: {
          x: a[0] + (b[0] - a[0]) * exaggeration,
          y: a[1] + (b[1] - a[1]) * exaggeration,
        },
        thickness: 1,
        color,
      });
  }
  y -= 20;
  text(
    `Control-point residual vectors exaggerated ${exaggeration.toPrecision(4)}x. Grid north is up.`,
  );
  text(
    `RMSE: ${fit.rmse.toPrecision(12)} ${coordinateUnits(doc.workingCrs, options.definitions)} in ${doc.workingCrs}`,
  );
  text("r = T(image) - target; RMSE = sqrt(sum(||r||^2)/enabledCount).");
  text("Training residuals do not measure independent positional accuracy.");
  text(`Condition number: ${fit.condition}; backward mapping: ${fit.backward}`);
  text(`Engine: ${ENGINE_VERSION}; output: ${JSON.stringify(doc.output)}`, 9);
  text(`SHA-256: ${doc.sourceImage?.fingerprint}`, 8, true);
  if (capturedMap) {
    newPage();
    text("Host map: currently rendered layers and drawings", 16);
    text(JSON.stringify(capturedMap.frame), 9, true);
    await drawImage(capturedMap.blob, pageHeight * 0.65);
    y -= 20;
    text(capturedMap.attribution, 8);
    text(
      "Snapshot includes currently loaded canvas layers. Geographic coordinates remain in the attached document.",
      9,
    );
  }
  newPage();
  text("Ground control points", 16);
  for (const gcp of doc.gcps) {
    const r = fit.residuals.find((v) => v.id === gcp.id);
    text(
      `#${gcp.label} ${gcp.enabled ? "enabled" : "disabled"} | pixel ${gcp.image.join(", ")} -> ${gcp.target.join(", ")} [${gcp.crs}]`,
      9,
      true,
    );
    if (r)
      text(
        `r=[${r.vector.join(", ")}]; length=${r.distance}; pixel residual=${r.pixels ?? "unavailable"}`,
        8,
        true,
      );
  }
  text("Normalized transformation parameters", 14);
  for (const [key, value] of Object.entries(fit))
    if (key !== "residuals") text(`${key}: ${JSON.stringify(value)}`, 8, true);
  text(
    "Reproduce: restore the attached alignment.json document with its matching SHA-256 source bytes and recorded engine version. GDAL CLI model substitution is not implied.",
  );
  return new Blob([(await pdf.save()) as Uint8Array<ArrayBuffer>], {
    type: "application/pdf",
  });
}
