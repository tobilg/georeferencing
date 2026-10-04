import type { Gcp, GeoreferencerController, XY } from "@georeferencing/core";
import { coordinateUnits } from "@georeferencing/core";
import { useState } from "react";
import { NumberField } from "../components/fields.js";
import { useGeoreferencer } from "../hooks/useGeoreferencer.js";
import type { Translate } from "../localization.js";
import { identity } from "../localization.js";

/** Display a residual without floating-point noise such as `6.355e-14`. */
const residual = (value: number | null | undefined, decimals: number) =>
  typeof value === "number" ? Math.abs(value).toFixed(decimals) : "—";

/**
 * Editable paired-point table with numeric entry, enabled state, deletion and residual diagnostics. Coordinates remain in original canonical pixels and each target's declared CRS.
 *
 * This composable panel subscribes to the controller but does not attach the reference map or install an unsaved-work guard; manage those in the host when composing panels yourself.
 */
export function GcpPanel({
  /** Shared authoritative editor controller; the panel does not own its lifecycle. */
  controller,
  /** Optional translation function; defaults to returning English messages unchanged. */
  t = identity,
  /** Full editable table or a compact list of points and residuals. */
  variant = "table",
  /** Show the "Enter coordinates manually" form for keyboard point entry. */
  manualEntry = true,
  /** Show the add/move and cancel buttons with their usage hint. */
  tools = true,
}: {
  /** Shared authoritative editor controller; the panel does not own its lifecycle. */
  controller: GeoreferencerController;
  /** Optional translation function; defaults to returning English messages unchanged. */
  t?: Translate;
  /**
   * `table` (default) edits every coordinate and shows target CRS and residuals; `compact`
   * lists each point with its use state, residual and delete action.
   */
  variant?: "table" | "compact";
  /**
   * Show the "Enter coordinates manually" form, the keyboard alternative to clicking
   * points. Defaults to true.
   */
  manualEntry?: boolean;
  /** Show the add/move and cancel buttons with their usage hint. Defaults to true. */
  tools?: boolean;
}) {
  const s = useGeoreferencer(controller),
    [entry, setEntry] = useState([0, 0, 0, 0]);
  const locked = s.mode !== "align" || !s.document.sourceImage;
  const enabled = s.document.gcps.filter((p) => p.enabled).length;
  const edit = (p: Gcp, index: number, value: number) => {
    const image = [...p.image] as XY,
      target = [...p.target] as XY;
    if (index < 2) image[index] = value;
    else target[index - 2] = value;
    controller.updateGcp(p.id, { image, target });
  };
  const enable = (p: Gcp) => (
    <input
      aria-label={`${t("Enable point")} ${p.label}`}
      type="checkbox"
      disabled={locked}
      checked={p.enabled}
      onChange={(e) =>
        controller.updateGcp(p.id, { enabled: e.target.checked })
      }
    />
  );
  const remove = (p: Gcp) => (
    <button
      type="button"
      aria-label={`${t("Delete point")} ${p.label}`}
      disabled={locked}
      onClick={() => controller.removeGcp(p.id)}
    >
      ×
    </button>
  );
  return (
    <section className="rg-gcp-panel" data-variant={variant}>
      <div className="rg-panel-heading">
        <h2>{t(variant === "compact" ? "Points" : "Control points")}</h2>
        <span>
          {enabled} {t(enabled === 1 ? "point used" : "points used")}
        </span>
      </div>
      {tools && (
        <>
          <div className="rg-toolbar">
            <button
              type="button"
              disabled={locked}
              aria-pressed={s.tool === "gcp"}
              onClick={() =>
                controller.setTool(s.tool === "gcp" ? "navigate" : "gcp")
              }
            >
              {t("Add / move points")}
            </button>
            <button
              type="button"
              disabled={!s.pendingImagePoint}
              onClick={() => controller.cancelPending()}
            >
              {t("Cancel pair")}
            </button>
          </div>
          <p className="rg-hint">
            {t(
              s.pendingImagePoint
                ? "Pick the matching map location, or enter target coordinates below."
                : "Click the image first, then the map. Drag to pan and scroll to zoom.",
            )}
          </p>
        </>
      )}
      {variant === "compact" ? (
        s.document.gcps.length > 0 && (
          <div className="rg-table-scroll">
            <table className="rg-point-list">
              <caption>
                {t(
                  "Residual: distance between a point's map location and where the alignment puts it, in image pixels.",
                )}
              </caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">{t("Use")}</th>
                  <th scope="col">{t("Residual")}</th>
                  <th scope="col">
                    <span className="rg-visually-hidden">{t("Delete")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.document.gcps.map((p) => {
                  const r = s.fit?.residuals.find((r) => r.id === p.id);
                  return (
                    <tr key={p.id}>
                      <th scope="row">{p.label}</th>
                      <td>{enable(p)}</td>
                      <td>
                        {typeof r?.pixels === "number"
                          ? `${residual(r.pixels, 1)} px`
                          : "—"}
                      </td>
                      <td>{remove(p)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="rg-table-scroll">
          <table>
            <caption>
              {t(
                "Original image pixels → target coordinates. Residuals are T(image) − target.",
              )}
            </caption>
            <thead>
              <tr>
                {[
                  "Use",
                  "#",
                  "Image X",
                  "Image Y",
                  "Target X",
                  "Target Y",
                  "Target CRS",
                  "Residual",
                  "Pixels",
                  "",
                ].map((h) => (
                  <th key={h} scope="col">
                    {t(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.document.gcps.map((p) => {
                const r = s.fit?.residuals.find((r) => r.id === p.id);
                const targetDecimals =
                  coordinateUnits(p.crs) === "degrees" ? 8 : 3;
                return (
                  <tr key={p.id}>
                    <td>{enable(p)}</td>
                    <th scope="row">{p.label}</th>
                    {[...p.image, ...p.target].map((v, i) => (
                      <td
                        key={["image-x", "image-y", "target-x", "target-y"][i]}
                      >
                        <NumberField
                          label={`${t(["Image X", "Image Y", "Target X", "Target Y"][i])} ${p.label}`}
                          value={v}
                          decimals={i < 2 ? 3 : targetDecimals}
                          disabled={locked}
                          change={(n) => edit(p, i, n)}
                        />
                      </td>
                    ))}
                    <td>{p.crs}</td>
                    <td title={r?.vector.join(", ")}>
                      {residual(r?.distance, 3)}
                    </td>
                    <td>{residual(r?.pixels, 3)}</td>
                    <td>{remove(p)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {manualEntry && (
        <details>
          <summary>{t("Enter coordinates manually")}</summary>
          <div className="rg-coordinate-entry">
            {["Image X", "Image Y", "Target X", "Target Y"].map((label, i) => (
              <label key={label}>
                {t(label)}
                <NumberField
                  label={`${t("New")} ${t(label)}`}
                  value={
                    i < 2 && s.pendingImagePoint
                      ? s.pendingImagePoint[i]
                      : entry[i]
                  }
                  change={(n) => {
                    if (i < 2 && s.pendingImagePoint) {
                      const p = [...s.pendingImagePoint] as XY;
                      p[i] = n;
                      controller.setPendingPoint(p);
                    } else setEntry((v) => v.map((x, j) => (i === j ? n : x)));
                  }}
                />
              </label>
            ))}
          </div>
          <p>
            {t("Target CRS")}: {s.document.workingCrs}
          </p>
          <button
            type="button"
            disabled={locked}
            onClick={() => {
              try {
                controller.addGcp(s.pendingImagePoint ?? [entry[0], entry[1]], [
                  entry[2],
                  entry[3],
                ]);
              } catch (e) {
                controller.reportError(e);
              }
            }}
          >
            {t("Add coordinate pair")}
          </button>
        </details>
      )}
    </section>
  );
}
