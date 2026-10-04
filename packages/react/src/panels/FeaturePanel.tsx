import type { Features, GeoreferencerController } from "@georeferencing/core";
import { validateFeatures } from "@georeferencing/core";
import type { ReactNode } from "react";
import { useGeoreferencer } from "../hooks/useGeoreferencer.js";
import type { Translate } from "../localization.js";
import { identity } from "../localization.js";

/**
 * Opt-in digitizing controls, feature deletion and host property editing. Returns null when digitizing is disabled; controller.save performs explicit persistence.
 *
 * This composable panel subscribes to the controller but does not attach the reference map or install an unsaved-work guard; manage those in the host when composing panels yourself.
 */
export function FeaturePanel({
  /** Shared authoritative editor controller; the panel does not own its lifecycle. */
  controller,
  /**
   * Render a property editor for the frozen feature. Use update to commit replacement
   * JSON properties without mutating feature identity or geometry.
   */
  propertyEditor,
  /** Optional translation function; defaults to returning English messages unchanged. */
  t = identity,
}: {
  /** Shared authoritative editor controller; the panel does not own its lifecycle. */
  controller: GeoreferencerController;
  /**
   * Render a property editor for the frozen feature. Use update to commit replacement
   * JSON properties without mutating feature identity or geometry.
   */
  propertyEditor?: (
    feature: Features["features"][number],
    update: (properties: Record<string, unknown>) => void,
  ) => ReactNode;
  /** Optional translation function; defaults to returning English messages unchanged. */
  t?: Translate;
}) {
  const s = useGeoreferencer(controller),
    d = s.document;
  if (!controller.options.digitizing) return null;
  return (
    <section>
      <h2>
        {t("Drawings")} <small>{d.features.features.length}</small>
      </h2>
      {validateFeatures(d.features).map((error) => (
        <p className="rg-error" key={error}>
          {t(error)}
        </p>
      ))}
      <div className="rg-toolbar">
        {(
          ["Point", "LineString", "Polygon", "modify", "navigate"] as const
        ).map((tool) => (
          <button
            type="button"
            key={tool}
            disabled={s.mode !== "draw"}
            aria-pressed={s.tool === tool}
            onClick={() => controller.setTool(tool)}
          >
            {t(
              tool === "modify"
                ? "Edit vertices"
                : tool === "navigate"
                  ? "Pan map"
                  : tool,
            )}
          </button>
        ))}
      </div>
      <small>
        {t(
          "Double-click to finish lines/polygons. Escape cancels. Select a feature to edit vertices; Alt-click a vertex to remove it.",
        )}
      </small>
      {d.features.features.map((f, i) => (
        <div className="rg-feature" key={f.id}>
          <span>
            {i + 1} · {f.geometry.type} · {String(f.id).slice(0, 8)}
          </span>
          <button
            type="button"
            disabled={s.mode !== "draw"}
            aria-label={`${t("Delete feature")} ${i + 1}`}
            onClick={() => controller.deleteFeature(String(f.id))}
          >
            ×
          </button>
          {propertyEditor?.(f, (p) =>
            controller.updateProperties(String(f.id), p),
          )}
        </div>
      ))}
      {d.features.features.length > 0 &&
        d.featuresReviewedAgainstAlignmentRevision !== d.alignmentRevision && (
          <button
            type="button"
            disabled={d.confirmedAlignmentRevision !== d.alignmentRevision}
            onClick={() => controller.reviewFeatures()}
          >
            {t("I reviewed drawings against this alignment")}
          </button>
        )}
      <button
        type="button"
        className="rg-primary"
        disabled={
          !controller.options.onSave ||
          !controller.canSaveFeatures() ||
          s.saving === "running"
        }
        onClick={() =>
          void controller.save().catch((e) => controller.reportError(e))
        }
      >
        {t(s.saving === "running" ? "Saving…" : "Save features")}
      </button>
      <p aria-live="polite">
        {s.saving === "succeeded"
          ? t(
              s.dirty
                ? "Snapshot saved; newer changes remain unsaved."
                : "Saved by host.",
            )
          : s.saving === "failed"
            ? t("Save failed. Draft retained; retry when ready.")
            : !controller.options.onSave
              ? t(
                  "No host save adapter configured. Session export remains available.",
                )
              : t("Saving features does not require raster export.")}
      </p>
    </section>
  );
}
