import type { GeoreferencerController, Model } from "@georeferencing/core";
import { coordinateUnits, MODELS } from "@georeferencing/core";
import { useGeoreferencer } from "../hooks/useGeoreferencer.js";
import type { Translate } from "../localization.js";
import { identity } from "../localization.js";
import { PreviewControls } from "./PreviewControls.js";

/**
 * Model selection, fit feedback and explicit confirmation/review controls backed by the authoritative controller.
 *
 * This composable panel subscribes to the controller but does not attach the reference map or install an unsaved-work guard; manage those in the host when composing panels yourself.
 */
export function AlignmentPanel({
  /** Shared authoritative editor controller; the panel does not own its lifecycle. */
  controller,
  /** Optional translation function; defaults to returning English messages unchanged. */
  t = identity,
  controls = true,
}: {
  /** Shared authoritative editor controller; the panel does not own its lifecycle. */
  controller: GeoreferencerController;
  /** Optional translation function; defaults to returning English messages unchanged. */
  t?: Translate;
  /** Show transformation/preview controls; disable when already provided by a guided toolbar. */
  controls?: boolean;
}) {
  const s = useGeoreferencer(controller),
    d = s.document;
  return (
    <section>
      <h2>{t("Alignment")}</h2>
      {controls && <PreviewControls controller={controller} t={t} />}
      {controls && (
        <label>
          {t("Transformation")}
          <select
            disabled={!d.sourceImage || s.mode === "draw"}
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
      <p className="rg-fit-summary">
        {s.fitting === "running"
          ? t("Fitting & rendering…")
          : s.fit
            ? `${t("RMSE")} ${s.fit.rmse.toPrecision(4)} ${coordinateUnits(d.workingCrs)} · ${d.workingCrs}`
            : t("Add distributed points to fit the image.")}
      </p>
      {d.workingCrs === "EPSG:3857" && (
        <small>
          {t("Web Mercator units are projected metres, not ground distances.")}
        </small>
      )}
      <small>
        {t(
          "RMSE = √(Σ‖T(p) − q‖² / enabled points). Training residuals do not measure independent accuracy. Preview uses reduced-resolution pixels.",
        )}
      </small>
      <label className="rg-inline">
        <input
          type="checkbox"
          checked={s.visible}
          onChange={(e) => controller.setDisplay({ visible: e.target.checked })}
        />
        {t("Show aligned image")}
      </label>
      <label>
        {t("Overlay opacity")}
        <input
          aria-label={t("Overlay opacity")}
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={s.opacity}
          onChange={(e) =>
            controller.setDisplay({ opacity: Number(e.target.value) })
          }
        />
      </label>
      {s.mode === "draw" ? (
        <button type="button" onClick={() => controller.returnToAlignment()}>
          {t("Return to alignment")}
        </button>
      ) : (
        <button
          type="button"
          className="rg-primary"
          disabled={!s.fit || s.fitRevision !== d.alignmentRevision}
          onClick={() => controller.confirm()}
        >
          {t(
            controller.options.digitizing
              ? "Confirm alignment and draw"
              : "Confirm alignment",
          )}
        </button>
      )}
      {d.confirmedAlignmentRevision === d.alignmentRevision && (
        <p>
          {t("Alignment confirmed")} · r{d.alignmentRevision}
        </p>
      )}
    </section>
  );
}
