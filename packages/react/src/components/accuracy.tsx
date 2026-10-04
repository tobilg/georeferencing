import type { Fit, Gcp, Model } from "@georeferencing/core";
import { coordinateUnits, MODELS } from "@georeferencing/core";
import type { Translate } from "../localization.js";

/**
 * Whether residuals are necessarily zero: thin plate splines interpolate every point,
 * and every other model matches exactly its minimum number of points.
 */
export function exactFit(model: Model, gcps: readonly Gcp[]): boolean {
  return (
    model === "thinPlateSpline" ||
    gcps.filter((p) => p.enabled).length <= MODELS[model].minimum
  );
}

/** Plain-language fit quality from the root mean square of image-pixel residuals. */
export function AccuracySummary({
  fit,
  model,
  gcps,
  workingCrs,
  t,
}: {
  fit: Fit;
  model: Model;
  gcps: readonly Gcp[];
  workingCrs: string;
  t: Translate;
}) {
  if (exactFit(model, gcps))
    return (
      <div className="rg-accuracy" data-quality="unknown">
        <strong>{t("Accuracy not measured yet")}</strong>
        <p>
          {t(
            model === "thinPlateSpline"
              ? "Thin plate spline passes through every point, so it cannot report an error. Judge the overlay visually."
              : "The alignment passes exactly through the minimum number of points. Add another point to measure accuracy.",
          )}
        </p>
      </div>
    );
  const pixels = fit.residuals
    .map((r) => r.pixels)
    .filter((v): v is number => typeof v === "number");
  const rms = pixels.length
    ? Math.sqrt(pixels.reduce((sum, v) => sum + v * v, 0) / pixels.length)
    : undefined;
  const quality =
    rms === undefined
      ? "unknown"
      : rms <= 2
        ? "good"
        : rms <= 5
          ? "fair"
          : "poor";
  return (
    <div className="rg-accuracy" data-quality={quality}>
      <strong>
        {rms === undefined
          ? t("Alignment ready")
          : `${t(
              quality === "good"
                ? "Good fit"
                : quality === "fair"
                  ? "Fair fit"
                  : "Poor fit",
            )} · ${t("average error")} ${rms.toFixed(1)} px`}
      </strong>
      <p>
        {t(
          quality === "poor"
            ? "Points disagree. Check the points with the largest residuals, or add more points."
            : "Average distance between your map points and where the alignment places them, in image pixels.",
        )}
      </p>
      <small>
        RMSE {fit.rmse.toFixed(2)} {coordinateUnits(workingCrs)} · {workingCrs}
      </small>
    </div>
  );
}
