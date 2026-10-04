import type { Gcp, GeoreferencerController, XY } from "@georeferencing/core";
import { useState } from "react";
import { NumberField } from "../components/fields.js";
import { useGeoreferencer } from "../hooks/useGeoreferencer.js";
import type { Translate } from "../localization.js";
import { identity } from "../localization.js";

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
}: {
  /** Shared authoritative editor controller; the panel does not own its lifecycle. */
  controller: GeoreferencerController;
  /** Optional translation function; defaults to returning English messages unchanged. */
  t?: Translate;
}) {
  const s = useGeoreferencer(controller),
    [entry, setEntry] = useState([0, 0, 0, 0]);
  const locked = s.mode !== "align" || !s.document.sourceImage;
  const edit = (p: Gcp, index: number, value: number) => {
    const image = [...p.image] as XY,
      target = [...p.target] as XY;
    if (index < 2) image[index] = value;
    else target[index - 2] = value;
    controller.updateGcp(p.id, { image, target });
  };
  return (
    <section className="rg-gcp-panel">
      <div className="rg-panel-heading">
        <h2>{t("Control points")}</h2>
        <span>
          {s.document.gcps.filter((p) => p.enabled).length} {t("enabled")}
        </span>
      </div>
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
            : "Pick image first, map second. Shift-drag to pan while adding points.",
        )}
      </p>
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
              return (
                <tr key={p.id}>
                  <td>
                    <input
                      aria-label={`${t("Enable point")} ${p.label}`}
                      type="checkbox"
                      disabled={locked}
                      checked={p.enabled}
                      onChange={(e) =>
                        controller.updateGcp(p.id, {
                          enabled: e.target.checked,
                        })
                      }
                    />
                  </td>
                  <th scope="row">{p.label}</th>
                  {[...p.image, ...p.target].map((v, i) => (
                    <td key={["image-x", "image-y", "target-x", "target-y"][i]}>
                      <NumberField
                        label={`${t(["Image X", "Image Y", "Target X", "Target Y"][i])} ${p.label}`}
                        value={v}
                        disabled={locked}
                        change={(n) => edit(p, i, n)}
                      />
                    </td>
                  ))}
                  <td>{p.crs}</td>
                  <td title={r?.vector.join(", ")}>
                    {r ? r.distance.toPrecision(4) : "—"}
                  </td>
                  <td>{r?.pixels?.toPrecision(4) ?? "—"}</td>
                  <td>
                    <button
                      type="button"
                      aria-label={`${t("Delete point")} ${p.label}`}
                      disabled={locked}
                      onClick={() => controller.removeGcp(p.id)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
    </section>
  );
}
