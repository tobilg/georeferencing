import type {
  GeoreferencerController,
  PreviewMode,
} from "@georeferencing/core";
import { MODELS } from "@georeferencing/core";
import { useGeoreferencer } from "../hooks/useGeoreferencer.js";
import type { Translate } from "../localization.js";
import { identity } from "../localization.js";

/**
 * Explicit manual/automatic preview policy and run action. Automatic mode waits for
 * enough complete, enabled pairs; the worker validates rank and domain. `onReview`
 * fires only for a successful preview of the same document/alignment revision.
 */
export function PreviewControls({
  controller,
  t = identity,
  onReview,
  modeSelector = true,
}: {
  /** Shared authoritative controller. */
  controller: GeoreferencerController;
  /** Translate default English labels. */
  t?: Translate;
  /** Optional transition from matching into review after a current preview is ready. */
  onReview?: () => void;
  /** Show the manual/automatic preview selector. Defaults to true. */
  modeSelector?: boolean;
}) {
  const s = useGeoreferencer(controller),
    d = s.document;
  const count = d.gcps.filter((p) => p.enabled).length;
  const minimum = MODELS[d.model].minimum;
  const missing = Math.max(0, minimum - count);
  return (
    <div className="rg-preview-controls">
      {modeSelector && (
        <label>
          {t("Preview updates")}
          <select
            value={s.previewMode}
            onChange={(e) =>
              controller.setPreviewMode(e.target.value as PreviewMode)
            }
          >
            <option value="manual">{t("Manual")}</option>
            <option value="automatic">{t("Automatic")}</option>
          </select>
        </label>
      )}
      <div>
        <button
          type="button"
          className="rg-primary"
          disabled={
            !s.imageUrl ||
            !!s.pendingImagePoint ||
            missing > 0 ||
            s.fitting === "running" ||
            s.mode === "draw"
          }
          onClick={async () => {
            const id = d.id,
              revision = d.alignmentRevision;
            if (!s.fit || s.previewMode === "manual") await controller.refit();
            const current = controller.getSnapshot();
            if (
              current.document.id === id &&
              current.fitRevision === revision &&
              current.fit
            ) {
              controller.setTool("navigate");
              onReview?.();
            }
          }}
        >
          {t(
            s.fitting === "running"
              ? "Running alignment…"
              : s.fit && s.previewMode === "automatic"
                ? "Review alignment"
                : "Run alignment",
          )}
        </button>
        <small className="rg-readiness" aria-live="polite">
          {missing > 0
            ? `${count} ${t("of")} ${minimum} ${t("points matched")}`
            : `${count} ${t(count === 1 ? "point matched" : "points matched")} · ${t("more points improve accuracy")}`}
        </small>
      </div>
    </div>
  );
}
