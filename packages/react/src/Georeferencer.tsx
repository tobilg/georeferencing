import type {
  ExportResult,
  GeoreferencerController,
  GuardContext,
  Model,
} from "@georeferencing/core";
import { MODELS } from "@georeferencing/core";
import type { BindingOptions } from "@georeferencing/core/openlayers";
import { attachReferenceMap } from "@georeferencing/core/openlayers";
import type OLMap from "ol/Map.js";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { AccuracySummary } from "./components/accuracy.js";
import {
  ExportButtons,
  ExportProgress,
  OutputFields,
  SessionTools,
} from "./components/exports.js";
import type { GeoreferencerControls } from "./controls.js";
import { MINIMAL_CONTROLS } from "./controls.js";
import { useGeoreferencer } from "./hooks/useGeoreferencer.js";
import type { Translate } from "./localization.js";
import { identity } from "./localization.js";
import { AlignmentPanel } from "./panels/AlignmentPanel.js";
import { FeaturePanel } from "./panels/FeaturePanel.js";
import { GcpPanel } from "./panels/GcpPanel.js";
import { ImagePanel } from "./panels/ImagePanel.js";
import { PreviewControls } from "./panels/PreviewControls.js";
import { ReferencePanel } from "./panels/ReferencePanel.js";

const DEFAULT_BINDING: BindingOptions = {};
const NO_CONTROLS: Partial<GeoreferencerControls> = {};

/**
 * Integration props for the ready-made editor. Keep controller, map and binding
 * configuration stable across React renders.
 */
export interface GeoreferencerProps {
  /**
   * Opt into the guided four-step layout (load, match, check, export/draw) by supplying
   * the host map's rendered target and controls. The host still creates, targets and
   * disposes the map. This slot stays mounted across all steps and responsive
   * image/map tabs.
   */
  referenceView?: ReactNode;
  /**
   * Optional controls of the guided layout. Omitted flags use {@link MINIMAL_CONTROLS};
   * pass {@link ALL_CONTROLS} for every expert control. The classic layout always shows
   * all controls.
   */
  controls?: Partial<GeoreferencerControls>;
  /**
   * Extra actions shown in the empty image drop zone next to "Choose image", for example
   * a button that loads a sample image.
   */
  emptyImageActions?: ReactNode;
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
 * Supplying `referenceView` selects the guided four-step layout, whose optional controls are chosen with `controls`; otherwise the classic workbench shows every control. Its effects attach/detach owned map resources and resume/suspend the controller for React Strict Mode. It installs a Save/Discard/Cancel guard and cancels pending dialogs on cleanup. The host retains final ownership of map, controller and engine. Import the optional scoped stylesheet from `@georeferencing/react/styles.css`.
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
  controls: controlOverrides = NO_CONTROLS,
  emptyImageActions,
}: GeoreferencerProps) {
  const guardTitle = useId();
  const s = useGeoreferencer(controller),
    binding = useRef<ReturnType<typeof attachReferenceMap> | null>(null);
  const [guard, setGuard] = useState<{
      context: GuardContext;
      resolve: (choice: "save" | "discard" | "cancel") => void;
    } | null>(null),
    dialog = useRef<HTMLDialogElement>(null);
  const guided = referenceView !== undefined;
  const controls = { ...MINIMAL_CONTROLS, ...controlOverrides };
  const [stage, setStage] = useState<"match" | "review" | "finish">("match");
  const [mobileView, setMobileView] = useState<"image" | "map">("image");
  const d = s.document;
  const imageId = d.sourceImage?.id;
  const imageReady = Boolean(s.imageUrl);
  const confirmed = d.confirmedAlignmentRevision === d.alignmentRevision;
  // 0 load image · 1 match points · 2 check alignment · 3 export or draw
  const step = !imageReady
    ? 0
    : s.mode === "draw" || (stage === "finish" && confirmed && s.fit)
      ? 3
      : stage !== "match" && s.fit
        ? 2
        : 1;
  const nextPoint = Math.max(0, ...d.gcps.map((p) => p.label)) + 1;
  const hasWork = d.gcps.length > 0 || d.features.features.length > 0;
  useEffect(() => {
    if (!guided) return;
    setStage("match");
    setMobileView("image");
    // A metadata-only restored document still needs its matching local bytes.
    if (imageId && imageReady && controller.getSnapshot().mode === "align")
      controller.setTool("gcp");
  }, [controller, guided, imageId, imageReady]);
  useEffect(() => {
    if (guided) setMobileView(s.pendingImagePoint ? "map" : "image");
  }, [guided, s.pendingImagePoint]);
  // Matching always uses the point tool; dragging pans, so no separate pan mode is needed.
  useEffect(() => {
    if (guided && step === 1 && s.tool !== "gcp" && s.mode === "align")
      controller.setTool("gcp");
  }, [controller, guided, step, s.tool, s.mode]);
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
  const error = s.error
    ? s.errorDetail && formatError
      ? formatError(s.errorDetail)
      : t(s.error)
    : null;
  const unsaved = (
    <span className="rg-dirty">
      {t(s.dirty && hasWork ? "Unsaved changes" : "No unsaved changes")}
    </span>
  );
  const goToMatching = () =>
    run(() => {
      if (controller.getSnapshot().mode === "draw")
        controller.returnToAlignment();
      setStage("match");
      setMobileView("image");
      controller.setTool("gcp");
    });
  const goToReview = () =>
    run(() => {
      if (controller.getSnapshot().mode === "draw")
        controller.returnToAlignment();
      setStage("review");
      setMobileView("map");
      controller.setTool("navigate");
    });
  const finish = () =>
    run(() => {
      controller.confirm();
      setStage("finish");
      setMobileView("map");
    });
  const steps = [
    "Load image",
    "Match points",
    "Check alignment",
    controller.options.digitizing ? "Export or draw" : "Export",
  ];
  const instruction: [string, string] =
    step === 0
      ? [
          "Choose an image to begin",
          "Drop an image or choose a file. It stays on this device.",
        ]
      : step === 1
        ? [
            s.pendingImagePoint
              ? `${t("Now click the same spot on the map")} · ${t("Point")} ${nextPoint}`
              : `${t("Click a recognizable spot in the image")} · ${t("Point")} ${nextPoint}`,
            stage !== "match"
              ? s.previewMode === "manual"
                ? "Points or settings changed. Run alignment again to check the result."
                : "Alignment changed. Wait for the updated preview."
              : "Use ground-level corners of buildings, quays or bridges, spread across the whole image. Drag to pan and scroll to zoom in both views; Esc cancels a point.",
          ]
        : step === 2
          ? [
              "Does the image line up with the map?",
              "Compare roads, shorelines and building corners across the whole image. If something is off, adjust or add points.",
            ]
          : controller.options.digitizing
            ? [
                "Download the result or draw on the map",
                "Your alignment is confirmed. Download files, or draw points, lines and areas on top of the aligned image.",
              ]
            : [
                "Download the result",
                "Your alignment is confirmed. Download the georeferenced image.",
              ];
  const primaryFormats = s.exportFormats.filter((format) => format.raster);
  const otherFormats = s.exportFormats.filter((format) => !format.raster);
  const toolRow =
    (step === 1 || step === 3) &&
    (controls.history ||
      controls.navigation ||
      controls.transformation ||
      controls.unsavedIndicator ||
      ["LineString", "Polygon"].includes(s.tool)) ? (
      <div className="rg-toolbar rg-match-tools">
        {step === 3 && ["LineString", "Polygon"].includes(s.tool) && (
          <button
            type="button"
            onClick={() => binding.current?.finishDrawing()}
          >
            {t("Finish drawing")}
          </button>
        )}
        {controls.history && (
          <>
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
          </>
        )}
        {controls.navigation && (
          <>
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
          </>
        )}
        {(controls.transformation || controls.unsavedIndicator) && (
          <div className="rg-tools-end">
            {controls.transformation && step === 1 && (
              <label className="rg-inline-field">
                {t("Transformation")}
                <select
                  value={d.model}
                  onChange={(e) => controller.setModel(e.target.value as Model)}
                >
                  {Object.entries(MODELS).map(([key, value]) => (
                    <option key={key} value={key}>
                      {t(value.label)} · {value.minimum}+
                    </option>
                  ))}
                </select>
              </label>
            )}
            {controls.unsavedIndicator && unsaved}
          </div>
        )}
      </div>
    ) : null;
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
            {steps.map((label, i) => {
              const state = i < step ? "done" : i === step ? "current" : "todo";
              const back =
                i < step && i === 1
                  ? goToMatching
                  : i < step && i === 2
                    ? goToReview
                    : undefined;
              const content = (
                <>
                  <span className="rg-step-index" aria-hidden="true">
                    {state === "done" ? "✓" : i + 1}
                  </span>
                  <span className="rg-step-label">{t(label)}</span>
                </>
              );
              return (
                <li
                  key={label}
                  data-state={state}
                  aria-current={state === "current" ? "step" : undefined}
                >
                  {back ? (
                    <button
                      type="button"
                      className="rg-step-button"
                      onClick={back}
                    >
                      {content}
                    </button>
                  ) : (
                    content
                  )}
                </li>
              );
            })}
          </ol>
          <div className="rg-matching-bar">
            <div className="rg-instruction" role="status" aria-live="polite">
              <strong>{t(instruction[0])}</strong>
              <p>
                {t(instruction[1])}
                {s.pendingImagePoint && (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="rg-link"
                      onClick={() => controller.setPendingPoint(null)}
                    >
                      {t("Cancel this point")}
                    </button>
                  </>
                )}
              </p>
            </div>
            <div className="rg-step-actions">
              {step === 1 && (
                <PreviewControls
                  controller={controller}
                  t={t}
                  modeSelector={controls.previewMode}
                  onReview={() => {
                    setStage("review");
                    setMobileView("map");
                  }}
                />
              )}
              {step === 2 && (
                <>
                  <button type="button" onClick={goToMatching}>
                    {t("Adjust points")}
                  </button>
                  <button
                    type="button"
                    onClick={() => binding.current?.fitOverlay()}
                  >
                    {t("Zoom map to image")}
                  </button>
                  <button
                    type="button"
                    className="rg-primary"
                    disabled={!s.fit || s.fitRevision !== d.alignmentRevision}
                    onClick={finish}
                  >
                    {t("Looks good, continue")}
                  </button>
                </>
              )}
              {step === 3 && (
                <button type="button" onClick={goToReview}>
                  {t("Back to check")}
                </button>
              )}
            </div>
          </div>
          {error && (
            <p className="rg-error" role="alert">
              {error}
            </p>
          )}
          {toolRow}
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
              data-active={
                s.tool === "gcp" && !s.pendingImagePoint && step === 1
              }
            >
              <ImagePanel
                controller={controller}
                t={t}
                navigation={controls.navigation}
                displayAdjustment={controls.displayAdjustment}
                emptyActions={emptyImageActions}
              />
            </div>
            <div
              className="rg-reference-pane"
              data-active={!!s.pendingImagePoint}
            >
              {referenceView}
            </div>
          </div>
          {step === 2 && s.fit && (
            <div className="rg-review-panels">
              <section className="rg-card">
                <h2>{t("Accuracy")}</h2>
                <AccuracySummary
                  fit={s.fit}
                  model={d.model}
                  gcps={d.gcps}
                  workingCrs={d.workingCrs}
                  t={t}
                />
                <label className="rg-inline">
                  <input
                    type="checkbox"
                    checked={s.visible}
                    onChange={(e) =>
                      controller.setDisplay({ visible: e.target.checked })
                    }
                  />
                  {t("Show aligned image on the map")}
                </label>
                <label>
                  {t("Image opacity")}
                  <input
                    aria-label={t("Overlay opacity")}
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={s.opacity}
                    onChange={(e) =>
                      controller.setDisplay({
                        opacity: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </section>
              <GcpPanel
                controller={controller}
                t={t}
                variant={controls.pointTable ? "table" : "compact"}
                manualEntry={false}
                tools={false}
              />
            </div>
          )}
          {step === 1 && (d.gcps.length > 0 || controls.manualEntry) && (
            <GcpPanel
              controller={controller}
              t={t}
              variant={controls.pointTable ? "table" : "compact"}
              manualEntry={controls.manualEntry}
              tools={false}
            />
          )}
          {step === 3 && (
            <div className="rg-review-panels">
              {s.exportFormats.length > 0 && (
                <section className="rg-card">
                  <h2>{t("Download")}</h2>
                  <ExportButtons
                    controller={controller}
                    t={t}
                    formats={primaryFormats}
                    onExport={onExport}
                    primary={() => true}
                    status={false}
                  />
                  {otherFormats.length > 0 && (
                    <>
                      <h3>{t("More downloads")}</h3>
                      <ExportButtons
                        controller={controller}
                        t={t}
                        formats={otherFormats}
                        onExport={onExport}
                        status={false}
                      />
                    </>
                  )}
                  <ExportProgress controller={controller} t={t} />
                  {controls.outputSettings && primaryFormats.length > 0 && (
                    <details>
                      <summary>{t("Output settings")}</summary>
                      <OutputFields
                        controller={controller}
                        t={t}
                        definitions={bindingOptions.definitions}
                      />
                    </details>
                  )}
                </section>
              )}
              {controller.options.digitizing && (
                <div className="rg-card">
                  <FeaturePanel
                    controller={controller}
                    propertyEditor={propertyEditor}
                    t={t}
                  />
                </div>
              )}
            </div>
          )}
          {controls.referenceStatus && (
            <details className="rg-advanced">
              <summary>{t("Reference sources")}</summary>
              <ReferencePanel controller={controller} t={t} />
            </details>
          )}
          {controls.sessionFiles && (
            <details className="rg-export">
              <summary>{t("Session files")}</summary>
              {step < 3 && (
                <ExportButtons
                  controller={controller}
                  t={t}
                  formats={s.exportFormats.filter(
                    (format) => format.requiresFit === false,
                  )}
                  onExport={onExport}
                  status={false}
                />
              )}
              {step < 3 && <ExportProgress controller={controller} t={t} />}
              <SessionTools controller={controller} t={t} />
            </details>
          )}
        </>
      ) : (
        <>
          <header className="rg-editor-heading">
            <div>
              <span className="rg-eyebrow">{t("GEOREFERENCE")}</span>
              <h1>{t("Place the image. Trace the detail.")}</h1>
            </div>
            {unsaved}
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
            <ImagePanel
              controller={controller}
              t={t}
              emptyActions={emptyImageActions}
            />
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
          <details className="rg-export">
            <summary>{t("Raster output & session files")}</summary>
            {s.exportFormats.some((format) => format.raster) && (
              <OutputFields
                controller={controller}
                t={t}
                definitions={bindingOptions.definitions}
              />
            )}
            <ExportButtons
              controller={controller}
              t={t}
              formats={s.exportFormats}
              onExport={onExport}
            />
            <SessionTools controller={controller} t={t} />
          </details>
        </>
      )}
      <div className="rg-status" role="status" aria-live="polite">
        {guided
          ? s.loading === "running"
            ? t("Inspecting local image…")
            : s.exporting === "succeeded"
              ? t("Export complete.")
              : null
          : (error ??
            (s.loading === "running"
              ? t("Inspecting local image…")
              : s.exporting === "succeeded"
                ? t("Raster export complete.")
                : t("Image processing stays on this device.")))}
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
