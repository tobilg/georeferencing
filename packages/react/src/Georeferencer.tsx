import type {
  ExportResult,
  GeoreferencerController,
  GuardContext,
  Model,
  Resampler,
} from "@georeferencing/core";
import { coordinateUnits, importPoints, MODELS } from "@georeferencing/core";
import type { BindingOptions } from "@georeferencing/core/openlayers";
import { attachReferenceMap } from "@georeferencing/core/openlayers";
import type OLMap from "ol/Map.js";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { NumberField, TextField } from "./components/fields.js";
import { useGeoreferencer } from "./hooks/useGeoreferencer.js";
import type { Translate } from "./localization.js";
import { identity } from "./localization.js";
import { AlignmentPanel } from "./panels/AlignmentPanel.js";
import { FeaturePanel } from "./panels/FeaturePanel.js";
import { GcpPanel } from "./panels/GcpPanel.js";
import { ImagePanel } from "./panels/ImagePanel.js";
import { PreviewControls } from "./panels/PreviewControls.js";
import { ReferencePanel } from "./panels/ReferencePanel.js";
import { downloadBlob } from "./utils/downloadBlob.js";

const DEFAULT_BINDING: BindingOptions = {};

/**
 * Integration props for the ready-made editor. Keep controller, map and binding
 * configuration stable across React renders.
 */
export interface GeoreferencerProps {
  /**
   * Opt into a guided matching/review layout by supplying the host map's rendered
   * target and controls. The host still creates, targets and disposes the map. This
   * slot stays mounted across matching/review and responsive image/map tabs.
   */
  referenceView?: ReactNode;
  /**
   * Host-owned authoritative controller; the component resumes/suspends it but does not
   * permanently dispose it.
   */
  controller: GeoreferencerController;
  /**
   * Existing host-owned OpenLayers map. The component attaches owned layers/interactions
   * and leaves the map alive on unmount.
   */
  referenceMap: OLMap;
  /**
   * Reference providers, projections, snapping and optional initial map framing. Memoize
   * this object to avoid reattachment.
   */
  bindingOptions?: BindingOptions;
  /** Translation function for default English messages; identity when omitted. */
  t?: Translate;
  /**
   * Additional class on the editor root; built-in styles are scoped beneath rg-prefixed
   * classes.
   */
  className?: string;
  /**
   * Optional structured-error formatter, allowing localization by error code instead of
   * parsing English strings.
   */
  formatError?: (
    error: NonNullable<
      ReturnType<GeoreferencerController["getSnapshot"]>["errorDetail"]
    >,
  ) => string;
  /**
   * Render a host-specific property form. Call the provided update callback with a
   * replacement JSON properties object; do not mutate the frozen feature.
   */
  propertyEditor?: Parameters<typeof FeaturePanel>[0]["propertyEditor"];
  /** Receive any configured format's revisioned artifacts instead of default downloads. */
  onExport?: (result: ExportResult) => void | Promise<void>;
}

/**
 * Ready-made React editor for an existing OpenLayers map. Composes image, GCP, alignment, reference, output and optional drawing controls.
 *
 * Its effects attach/detach owned map resources and resume/suspend the controller for React Strict Mode. It installs a Save/Discard/Cancel guard and cancels pending dialogs on cleanup. The host retains final ownership of map, controller and engine. Import the optional scoped stylesheet from `@georeferencing/react/styles.css`.
 */
export function Georeferencer({
  controller,
  referenceMap,
  bindingOptions = DEFAULT_BINDING,
  t = identity,
  className = "",
  propertyEditor,
  onExport,
  formatError,
  referenceView,
}: GeoreferencerProps) {
  const guardTitle = useId();
  const s = useGeoreferencer(controller),
    binding = useRef<ReturnType<typeof attachReferenceMap> | null>(null);
  const [guard, setGuard] = useState<{
      context: GuardContext;
      resolve: (choice: "save" | "discard" | "cancel") => void;
    } | null>(null),
    dialog = useRef<HTMLDialogElement>(null),
    sessionInput = useRef<HTMLInputElement>(null);
  const pendingSession = useRef<string | null>(null);
  const guided = referenceView !== undefined;
  const [editing, setEditing] = useState(true);
  const [reviewedDocumentRevision, setReviewedDocumentRevision] = useState<
    number | null
  >(null);
  const [mobileView, setMobileView] = useState<"image" | "map">("image");
  const imageId = s.document.sourceImage?.id;
  const imageReady = Boolean(s.imageUrl);
  const review = !!s.fit && !editing;
  const visibleFormats = s.exportFormats.filter(
    (format) =>
      !guided || review || s.mode === "draw" || format.requiresFit === false,
  );
  const nextPoint = Math.max(0, ...s.document.gcps.map((p) => p.label)) + 1;
  useEffect(() => {
    if (!guided) return;
    setEditing(true);
    setReviewedDocumentRevision(null);
    setMobileView("image");
    // A metadata-only restored document still needs its matching local bytes.
    if (imageId && imageReady && controller.getSnapshot().mode === "align")
      controller.setTool("gcp");
  }, [controller, guided, imageId, imageReady]);
  useEffect(() => {
    if (guided) setMobileView(s.pendingImagePoint ? "map" : "image");
  }, [guided, s.pendingImagePoint]);
  useEffect(() => {
    if (guided && mobileView === "map") referenceMap.updateSize();
  }, [guided, mobileView, referenceMap]);
  useEffect(() => {
    controller.start();
    binding.current = attachReferenceMap(
      referenceMap,
      controller,
      bindingOptions,
    );
    return () => {
      binding.current?.detach();
      binding.current = null;
      controller.suspend();
    };
  }, [referenceMap, controller, bindingOptions]);
  useEffect(() => {
    if (controller.options.guard) return;
    let pending: ((choice: "save" | "discard" | "cancel") => void) | null =
      null;
    controller.setGuard(
      (context) =>
        new Promise((resolve) => {
          pending?.("cancel");
          pending = resolve;
          setGuard({ context, resolve });
        }),
    );
    return () => {
      pending?.("cancel");
      controller.setGuard(undefined);
    };
  }, [controller]);
  useEffect(() => {
    if (guard) {
      dialog.current?.showModal();
      dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }
  }, [guard]);
  const decide = (choice: "save" | "discard" | "cancel") => {
    guard?.resolve(choice);
    dialog.current?.close();
    setGuard(null);
  };
  const run = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      controller.reportError(e);
    }
  };
  return (
    <section
      className={`rg-editor ${guided ? "rg-guided" : ""} ${className}`}
      aria-label={t("Georeferencing editor")}
      onKeyDownCapture={(e) => {
        if (guided && e.key === "Escape" && s.pendingImagePoint) {
          controller.setPendingPoint(null);
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          binding.current?.cancelDrawing();
          e.stopPropagation();
        }
      }}
    >
      {guided ? (
        <>
          <ol className="rg-steps" aria-label={t("Georeferencing steps")}>
            {[
              "Load image",
              "Match points",
              "Review alignment",
              "Export or draw",
            ].map((label, i) => (
              <li
                key={label}
                aria-current={
                  i === (!imageId ? 0 : s.mode === "draw" ? 3 : review ? 2 : 1)
                    ? "step"
                    : undefined
                }
              >
                {i + 1}. {t(label)}
              </li>
            ))}
          </ol>
          <div className="rg-matching-bar">
            <div className="rg-instruction" role="status" aria-live="polite">
              <strong>
                {!imageReady
                  ? t("Choose an image to begin")
                  : s.mode === "draw"
                    ? t("Draw features on the aligned map")
                    : review
                      ? t("Inspect the overlay against the reference map")
                      : s.tool !== "gcp"
                        ? t("Navigation active. Resume matching to add points.")
                        : s.pendingImagePoint
                          ? `${t("Select the matching location on the map")} · ${t("Point")} ${nextPoint}`
                          : `${t("Select a point in the image")} · ${t("Point")} ${nextPoint}`}
              </strong>
              <p>
                {t(
                  reviewedDocumentRevision !== null &&
                    reviewedDocumentRevision !== s.document.documentRevision &&
                    !s.fit
                    ? s.previewMode === "manual"
                      ? "Points or settings changed. Run alignment again before reviewing or exporting."
                      : "Alignment changed. Wait for the updated preview before reviewing."
                    : review
                      ? "Check landmarks across the image before exporting or accepting alignment."
                      : "Match ground-level corners across the image. Shift-drag to pan; Escape cancels a pending pair.",
                )}
              </p>
            </div>
            {!review && s.mode === "align" && (
              <PreviewControls
                controller={controller}
                t={t}
                onReview={() => {
                  setEditing(false);
                  setReviewedDocumentRevision(
                    controller.getSnapshot().document.documentRevision,
                  );
                  setMobileView("map");
                }}
              />
            )}
            {review && s.mode === "align" && (
              <button
                type="button"
                onClick={() => {
                  setEditing(true);
                  controller.setTool("gcp");
                }}
              >
                {t("Edit points")}
              </button>
            )}
          </div>
          {s.error && (
            <p className="rg-error" role="alert">
              {s.errorDetail && formatError
                ? formatError(s.errorDetail)
                : t(s.error)}
            </p>
          )}
          <div className="rg-toolbar rg-match-tools">
            {["LineString", "Polygon"].includes(s.tool) && (
              <button
                type="button"
                onClick={() => binding.current?.finishDrawing()}
              >
                {t("Finish drawing")}
              </button>
            )}
            <button
              type="button"
              disabled={!imageReady || s.mode === "draw"}
              aria-pressed={s.tool === "gcp"}
              onClick={() => {
                setEditing(true);
                controller.setTool("gcp");
              }}
            >
              {t("Match points")}
            </button>
            <button
              type="button"
              disabled={!imageReady || s.mode === "draw"}
              aria-pressed={s.tool === "navigate"}
              onClick={() => controller.setTool("navigate")}
            >
              {t("Pan image")}
            </button>
            <button
              type="button"
              disabled={!s.pendingImagePoint}
              onClick={() => controller.setPendingPoint(null)}
            >
              {t("Cancel pending pair")}
            </button>
            <button
              type="button"
              disabled={!s.canUndo}
              onClick={() => controller.undo()}
            >
              {t("Undo")}
            </button>
            <button
              type="button"
              disabled={!s.canRedo}
              onClick={() => controller.redo()}
            >
              {t("Redo")}
            </button>
            <label>
              {t("Transformation")}
              <select
                disabled={!imageId || s.mode === "draw"}
                value={s.document.model}
                onChange={(e) => controller.setModel(e.target.value as Model)}
              >
                {Object.entries(MODELS).map(([key, value]) => (
                  <option key={key} value={key}>
                    {t(value.label)} · {value.minimum}+
                  </option>
                ))}
              </select>
            </label>
            <span className="rg-dirty">
              {t(s.dirty ? "Unsaved changes" : "No unsaved changes")}
            </span>
          </div>
          <fieldset className="rg-view-tabs" aria-label={t("Workspace view")}>
            <button
              type="button"
              aria-pressed={mobileView === "image"}
              onClick={() => setMobileView("image")}
            >
              {t("Image")}
            </button>
            <button
              type="button"
              aria-pressed={mobileView === "map"}
              onClick={() => setMobileView("map")}
            >
              {t("Map")}
              {s.pendingImagePoint ? ` · ${t("Pick here next")}` : ""}
            </button>
          </fieldset>
          <div className="rg-paired-views" data-mobile-view={mobileView}>
            <div
              className="rg-source-pane"
              data-active={s.tool === "gcp" && !s.pendingImagePoint && !review}
            >
              <ImagePanel controller={controller} t={t} />
            </div>
            <div
              className="rg-reference-pane"
              data-active={!!s.pendingImagePoint}
            >
              {referenceView}
            </div>
          </div>
          {(review || s.mode === "draw") && (
            <div className="rg-review-panels">
              <AlignmentPanel controller={controller} t={t} controls={false} />
              {s.mode === "draw" && (
                <FeaturePanel
                  controller={controller}
                  propertyEditor={propertyEditor}
                  t={t}
                />
              )}
            </div>
          )}
          <GcpPanel controller={controller} t={t} />
          <details className="rg-advanced">
            <summary>{t("Advanced navigation & reference status")}</summary>
            <div className="rg-toolbar">
              <button
                type="button"
                disabled={!s.preview}
                onClick={() => binding.current?.fitOverlay()}
              >
                {t("Fit map to image")}
              </button>
              <button
                type="button"
                onClick={() => binding.current?.navigateHistory(-1)}
              >
                {t("Previous map view")}
              </button>
              <button
                type="button"
                onClick={() => binding.current?.navigateHistory(1)}
              >
                {t("Next map view")}
              </button>
            </div>
            <ReferencePanel controller={controller} t={t} />
          </details>
        </>
      ) : (
        <>
          <header className="rg-editor-heading">
            <div>
              <span className="rg-eyebrow">{t("GEOREFERENCE")}</span>
              <h1>{t("Place the image. Trace the detail.")}</h1>
            </div>
            <span className="rg-dirty">
              {t(s.dirty ? "Unsaved changes" : "No unsaved changes")}
            </span>
          </header>
          <div className="rg-toolbar rg-history">
            <button
              type="button"
              disabled={!s.canUndo}
              onClick={() => controller.undo()}
            >
              {t("Undo")}
            </button>
            <button
              type="button"
              disabled={!s.canRedo}
              onClick={() => controller.redo()}
            >
              {t("Redo")}
            </button>
            <button
              type="button"
              disabled={!s.preview}
              onClick={() => binding.current?.fitOverlay()}
            >
              {t("Fit map to image")}
            </button>
            <button
              type="button"
              onClick={() => binding.current?.navigateHistory(-1)}
            >
              {t("Previous map view")}
            </button>
            <button
              type="button"
              onClick={() => binding.current?.navigateHistory(1)}
            >
              {t("Next map view")}
            </button>
            {["LineString", "Polygon"].includes(s.tool) && (
              <button
                type="button"
                onClick={() => binding.current?.finishDrawing()}
              >
                {t("Finish drawing")}
              </button>
            )}
          </div>
          <div className="rg-workbench">
            <ImagePanel controller={controller} t={t} />
            <div className="rg-settings">
              <AlignmentPanel controller={controller} t={t} />
              <FeaturePanel
                controller={controller}
                propertyEditor={propertyEditor}
                t={t}
              />
            </div>
          </div>
          <ReferencePanel controller={controller} t={t} />
          <GcpPanel controller={controller} t={t} />
        </>
      )}
      <details className="rg-export">
        <summary>
          {t(
            guided && !review && s.mode !== "draw"
              ? "Session files"
              : "Raster output & session files",
          )}
        </summary>
        {visibleFormats.some((format) => format.raster) && (
          <div className="rg-output-fields">
            <label>
              {t("Output CRS")}
              <TextField
                label={t("Output CRS")}
                value={s.document.output.crs}
                change={(crs) =>
                  run(() => {
                    if (!crs) throw Error("Output CRS is required.");
                    controller.setOutput({
                      ...s.document.output,
                      crs,
                    });
                  })
                }
              />
            </label>
            <label>
              {t("Resampling")}
              <select
                value={s.document.output.resampler}
                onChange={(e) =>
                  controller.setOutput({
                    ...s.document.output,
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
            {s.exportFormats.some((format) => format.id === "geotiff") && (
              <label>
                {t("TIFF compression")}
                <select
                  value={s.document.output.compression ?? "none"}
                  onChange={(e) =>
                    controller.setOutput({
                      ...s.document.output,
                      compression: e.target.value as
                        | "none"
                        | "deflate"
                        | "packbits",
                      predictor:
                        e.target.value === "deflate"
                          ? s.document.output.predictor
                          : 1,
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
                  Array.isArray(s.document.output.sourceNoData)
                    ? s.document.output.sourceNoData.join(",")
                    : String(s.document.output.sourceNoData ?? "")
                }
                change={(value) =>
                  run(() => {
                    const values = value.split(",").map(Number);
                    if (
                      value &&
                      (![1, 3].includes(values.length) ||
                        values.some(
                          (v) => !Number.isInteger(v) || v < 0 || v > 255,
                        ))
                    )
                      throw Error(
                        "Input no-data requires one or three bytes (0–255).",
                      );
                    controller.setOutput({
                      ...s.document.output,
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
            {s.exportFormats.some((format) => format.id === "geotiff") && (
              <label>
                {t("Output no-data (byte; blank = alpha)")}
                <TextField
                  label={t("Output no-data")}
                  value={String(s.document.output.noData ?? "")}
                  change={(value) =>
                    run(() => {
                      const n = Number(value);
                      if (value && (!Number.isInteger(n) || n < 0 || n > 255))
                        throw Error("Output no-data requires a byte (0–255).");
                      controller.setOutput({
                        ...s.document.output,
                        noData: value ? n : undefined,
                      });
                    })
                  }
                />
              </label>
            )}
            {s.exportFormats.some((format) => format.id === "geotiff") && (
              <>
                <label>
                  {t("Rows per TIFF strip")}
                  <NumberField
                    label={t("Rows per TIFF strip")}
                    value={s.document.output.rowsPerStrip ?? 256}
                    change={(n) =>
                      run(() => {
                        if (!Number.isInteger(n) || n < 1 || n > 4096)
                          throw Error("Rows per strip must be 1–4096.");
                        controller.setOutput({
                          ...s.document.output,
                          rowsPerStrip: n,
                        });
                      })
                    }
                  />
                </label>
                <label>
                  {t("Horizontal TIFF predictor")}
                  <input
                    type="checkbox"
                    disabled={s.document.output.compression !== "deflate"}
                    checked={s.document.output.predictor === 2}
                    onChange={(e) =>
                      controller.setOutput({
                        ...s.document.output,
                        predictor: e.target.checked ? 2 : 1,
                      })
                    }
                  />
                </label>
              </>
            )}
            <label>
              {t("Pixel size (x,y; blank = estimated)")} ·{" "}
              {coordinateUnits(
                s.document.output.crs,
                bindingOptions.definitions,
              )}
              <TextField
                label={t("Pixel size")}
                value={s.document.output.resolution?.join(",") ?? ""}
                change={(value) =>
                  run(() => {
                    const values = value.split(",").map(Number);
                    if (
                      value &&
                      (values.length > 2 ||
                        values.some((v) => !Number.isFinite(v) || v <= 0))
                    )
                      throw Error(
                        "Pixel size requires one or two positive numbers.",
                      );
                    controller.setOutput({
                      ...s.document.output,
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
                value={s.document.output.bounds?.join(",") ?? ""}
                change={(value) =>
                  run(() => {
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
                      ...s.document.output,
                      bounds: value
                        ? (values as [number, number, number, number])
                        : undefined,
                    });
                  })
                }
              />
            </label>
          </div>
        )}
        {visibleFormats.length > 0 && (
          <div className="rg-toolbar">
            {visibleFormats.map((format) => {
              const unavailable = controller.getExportUnavailable(format.id);
              return (
                <button
                  key={format.id}
                  type="button"
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
            <button
              type="button"
              disabled={s.exporting !== "running"}
              onClick={() => controller.cancelExport()}
            >
              {t("Cancel export")}
            </button>
          </div>
        )}
        {s.exporting === "running" && (
          <progress
            aria-label={t("Export progress")}
            value={s.progress}
            max="1"
          />
        )}
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
      </details>
      <div className="rg-status" role="status" aria-live="polite">
        {(s.error
          ? s.errorDetail && formatError
            ? formatError(s.errorDetail)
            : t(s.error)
          : null) ??
          (s.loading === "running"
            ? t("Inspecting local image…")
            : s.exporting === "succeeded"
              ? t("Raster export complete.")
              : t("Image processing stays on this device."))}
      </div>
      <dialog
        ref={dialog}
        className="rg-guard"
        onCancel={(e) => {
          e.preventDefault();
          decide("cancel");
        }}
        aria-labelledby={guardTitle}
      >
        <h2 id={guardTitle}>{t("Protect unsaved work")}</h2>
        <p>{t("Save or discard the current document before replacing it.")}</p>
        {!guard?.context.canSave && (
          <p>
            {t(
              "Saving is unavailable for this draft. Cancel to export a session, or discard.",
            )}
          </p>
        )}
        <div className="rg-toolbar">
          <button type="button" onClick={() => decide("cancel")}>
            {t("Cancel")}
          </button>
          <button type="button" onClick={() => decide("discard")}>
            {t("Discard")}
          </button>
          <button
            type="button"
            disabled={!guard?.context.canSave}
            onClick={() => decide("save")}
          >
            {t(
              guard?.context.saveKind === "draft"
                ? "Save draft and continue"
                : "Save and continue",
            )}
          </button>
        </div>
      </dialog>
    </section>
  );
}
