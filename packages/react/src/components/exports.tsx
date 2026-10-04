import type {
  Definitions,
  ExportFormat,
  ExportResult,
  GeoreferencerController,
  Resampler,
} from "@georeferencing/core";
import { coordinateUnits, importPoints } from "@georeferencing/core";
import { useRef } from "react";
import { useGeoreferencer } from "../hooks/useGeoreferencer.js";
import type { Translate } from "../localization.js";
import { downloadBlob } from "../utils/downloadBlob.js";
import { NumberField, TextField } from "./fields.js";

const run = (controller: GeoreferencerController, fn: () => void) => {
  try {
    fn();
  } catch (e) {
    controller.reportError(e);
  }
};

/** Raster output settings shared by every raster export format. */
export function OutputFields({
  controller,
  t,
  definitions,
}: {
  controller: GeoreferencerController;
  t: Translate;
  definitions?: Definitions;
}) {
  const s = useGeoreferencer(controller);
  const output = s.document.output;
  const geotiff = s.exportFormats.some((format) => format.id === "geotiff");
  return (
    <div className="rg-output-fields">
      <label>
        {t("Output CRS")}
        <TextField
          label={t("Output CRS")}
          value={output.crs}
          change={(crs) =>
            run(controller, () => {
              if (!crs) throw Error("Output CRS is required.");
              controller.setOutput({ ...output, crs });
            })
          }
        />
      </label>
      <label>
        {t("Resampling")}
        <select
          value={output.resampler}
          onChange={(e) =>
            controller.setOutput({
              ...output,
              resampler: e.target.value as Resampler,
            })
          }
        >
          {["nearest", "bilinear", "cubic", "cubicSpline", "lanczos"].map(
            (m) => (
              <option key={m}>{m}</option>
            ),
          )}
        </select>
      </label>
      {geotiff && (
        <label>
          {t("TIFF compression")}
          <select
            value={output.compression ?? "none"}
            onChange={(e) =>
              controller.setOutput({
                ...output,
                compression: e.target.value as "none" | "deflate" | "packbits",
                predictor: e.target.value === "deflate" ? output.predictor : 1,
              })
            }
          >
            <option value="none">{t("Uncompressed")}</option>
            <option value="deflate">{t("Deflate (lossless)")}</option>
            <option value="packbits">{t("PackBits (lossless)")}</option>
          </select>
        </label>
      )}
      <label>
        {t("Input no-data (byte or R,G,B; blank = alpha)")}
        <TextField
          label={t("Input no-data")}
          value={
            Array.isArray(output.sourceNoData)
              ? output.sourceNoData.join(",")
              : String(output.sourceNoData ?? "")
          }
          change={(value) =>
            run(controller, () => {
              const values = value.split(",").map(Number);
              if (
                value &&
                (![1, 3].includes(values.length) ||
                  values.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
              )
                throw Error(
                  "Input no-data requires one or three bytes (0–255).",
                );
              controller.setOutput({
                ...output,
                sourceNoData: value
                  ? values.length === 1
                    ? values[0]
                    : (values as [number, number, number])
                  : undefined,
              });
            })
          }
        />
      </label>
      {geotiff && (
        <label>
          {t("Output no-data (byte; blank = alpha)")}
          <TextField
            label={t("Output no-data")}
            value={String(output.noData ?? "")}
            change={(value) =>
              run(controller, () => {
                const n = Number(value);
                if (value && (!Number.isInteger(n) || n < 0 || n > 255))
                  throw Error("Output no-data requires a byte (0–255).");
                controller.setOutput({
                  ...output,
                  noData: value ? n : undefined,
                });
              })
            }
          />
        </label>
      )}
      {geotiff && (
        <>
          <label>
            {t("Rows per TIFF strip")}
            <NumberField
              label={t("Rows per TIFF strip")}
              value={output.rowsPerStrip ?? 256}
              change={(n) =>
                run(controller, () => {
                  if (!Number.isInteger(n) || n < 1 || n > 4096)
                    throw Error("Rows per strip must be 1–4096.");
                  controller.setOutput({ ...output, rowsPerStrip: n });
                })
              }
            />
          </label>
          <label>
            {t("Horizontal TIFF predictor")}
            <input
              type="checkbox"
              disabled={output.compression !== "deflate"}
              checked={output.predictor === 2}
              onChange={(e) =>
                controller.setOutput({
                  ...output,
                  predictor: e.target.checked ? 2 : 1,
                })
              }
            />
          </label>
        </>
      )}
      <label>
        {t("Pixel size (x,y; blank = estimated)")} ·{" "}
        {coordinateUnits(output.crs, definitions)}
        <TextField
          label={t("Pixel size")}
          value={output.resolution?.join(",") ?? ""}
          change={(value) =>
            run(controller, () => {
              const values = value.split(",").map(Number);
              if (
                value &&
                (values.length > 2 ||
                  values.some((v) => !Number.isFinite(v) || v <= 0))
              )
                throw Error("Pixel size requires one or two positive numbers.");
              controller.setOutput({
                ...output,
                resolution: value
                  ? [values[0], values[1] ?? values[0]]
                  : undefined,
              });
            })
          }
        />
      </label>
      <label>
        {t("Output bounds (minX,minY,maxX,maxY; blank = footprint)")}
        <TextField
          label={t("Output bounds")}
          value={output.bounds?.join(",") ?? ""}
          change={(value) =>
            run(controller, () => {
              const values = value.split(",").map(Number);
              if (
                value &&
                (values.length !== 4 ||
                  values.some((v) => !Number.isFinite(v)) ||
                  values[0] >= values[2] ||
                  values[1] >= values[3])
              )
                throw Error(
                  "Bounds require four finite numbers with min < max.",
                );
              controller.setOutput({
                ...output,
                bounds: value
                  ? (values as [number, number, number, number])
                  : undefined,
              });
            })
          }
        />
      </label>
    </div>
  );
}

/** One button per configured format; results go to `onExport` or browser downloads. */
export function ExportButtons({
  controller,
  t,
  formats,
  onExport,
  primary = () => false,
  status = true,
}: {
  controller: GeoreferencerController;
  t: Translate;
  formats: readonly ExportFormat[];
  onExport?: (result: ExportResult) => void | Promise<void>;
  /** Formats rendered as primary buttons. */
  primary?: (format: ExportFormat) => boolean;
  /**
   * Include the cancel button and progress bar. Disable when several button groups
   * share one {@link ExportProgress}.
   */
  status?: boolean;
}) {
  const s = useGeoreferencer(controller);
  if (!formats.length) return null;
  return (
    <>
      <div className="rg-toolbar">
        {formats.map((format) => {
          const unavailable = controller.getExportUnavailable(format.id);
          return (
            <button
              key={format.id}
              type="button"
              className={primary(format) ? "rg-primary" : undefined}
              data-export-format={format.id}
              title={unavailable ? t(unavailable) : undefined}
              disabled={Boolean(unavailable) || s.exporting === "running"}
              onClick={() =>
                void controller
                  .export(format.id)
                  .then(async (result) => {
                    if (!result) return;
                    if (onExport) await onExport(result);
                    else
                      for (const file of result.files)
                        downloadBlob(file.blob, file.name);
                  })
                  .catch((error) => controller.reportError(error))
              }
            >
              {t(format.label)}
            </button>
          );
        })}
        {status && (
          <button
            type="button"
            disabled={s.exporting !== "running"}
            onClick={() => controller.cancelExport()}
          >
            {t("Cancel export")}
          </button>
        )}
      </div>
      {status && s.exporting === "running" && (
        <progress
          aria-label={t("Export progress")}
          value={s.progress}
          max="1"
        />
      )}
    </>
  );
}

/** Progress bar and cancel button while an export runs; renders nothing when idle. */
export function ExportProgress({
  controller,
  t,
}: {
  controller: GeoreferencerController;
  t: Translate;
}) {
  const s = useGeoreferencer(controller);
  if (s.exporting !== "running") return null;
  return (
    <div className="rg-export-progress">
      <progress aria-label={t("Export progress")} value={s.progress} max="1" />
      <button type="button" onClick={() => controller.cancelExport()}>
        {t("Cancel export")}
      </button>
    </div>
  );
}

/** Restore a session with its image, import QGIS `.points` and save a host draft. */
export function SessionTools({
  controller,
  t,
}: {
  controller: GeoreferencerController;
  t: Translate;
}) {
  const s = useGeoreferencer(controller);
  const sessionInput = useRef<HTMLInputElement>(null);
  const pendingSession = useRef<string | null>(null);
  return (
    <div className="rg-toolbar">
      <label className="rg-file">
        {t("Restore session")}
        <input
          type="file"
          aria-label={t("Restore session")}
          accept=".json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) {
              pendingSession.current = await file.text();
              sessionInput.current?.click();
            }
            e.target.value = "";
          }}
        />
      </label>
      <input
        ref={sessionInput}
        aria-label={t("Matching session image")}
        type="file"
        hidden
        accept="image/*,.tif,.tiff"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && pendingSession.current)
            void controller
              .restoreSession(pendingSession.current, file)
              .catch((e) => controller.reportError(e));
          e.target.value = "";
        }}
      />
      <label className="rg-file">
        {t("Import .points")}
        <input
          type="file"
          aria-label={t("Import .points")}
          accept=".points,.csv"
          disabled={!s.document.sourceImage || s.mode === "draw"}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              try {
                const imported = importPoints(
                  await f.text(),
                  s.document.workingCrs,
                );
                controller.replaceGcps(imported.gcps);
              } catch (e) {
                controller.reportError(e);
              }
            }
            e.target.value = "";
          }}
        />
      </label>
      {controller.options.onSaveDraft && (
        <button
          type="button"
          disabled={!s.document.sourceImage || s.saving === "running"}
          onClick={() =>
            void controller
              .save("draft")
              .catch((e) => controller.reportError(e))
          }
        >
          {t("Save draft")}
        </button>
      )}
    </div>
  );
}
