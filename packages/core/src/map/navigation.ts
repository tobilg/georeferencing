import type { Definitions } from "../core/projection.js";
import { createConverter } from "../core/projection.js";
import type { Fit } from "../core/transform.js";
import { backward, forward } from "../core/transform.js";
import type { Extent, XY } from "../core/types.js";

const edgePoints = ([x0, y0, x1, y1]: Extent, steps = 16): XY[] => {
  const points: XY[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push(
      [x0 + (x1 - x0) * t, y0],
      [x0 + (x1 - x0) * t, y1],
      [x0, y0 + (y1 - y0) * t],
      [x1, y0 + (y1 - y0) * t],
    );
  }
  return points;
};
const bounds = (points: XY[]): Extent | null =>
  points.length && points.flat().every(Number.isFinite)
    ? [
        Math.min(...points.map((p) => p[0])),
        Math.min(...points.map((p) => p[1])),
        Math.max(...points.map((p) => p[0])),
        Math.max(...points.map((p) => p[1])),
      ]
    : null;

/**
 * Map extent covering an image viewport, for "map follows image" navigation.
 * Samples the viewport edges through the fit, so nonlinear models are enclosed.
 * @param fit - Current fit in `workingCrs`.
 * @param imageView - Canonical image viewport `[x, y, width, height]`.
 * @param workingCrs - CRS of the fit.
 * @param mapCrs - CRS of the returned extent.
 * @returns Extent in `mapCrs`, or null when the view leaves the projection domain.
 */
export function imageViewToExtent(
  fit: Fit,
  imageView: [number, number, number, number],
  workingCrs: string,
  mapCrs: string,
  definitions: Definitions = {},
): Extent | null {
  const [x, y, w, h] = imageView,
    convert = createConverter(workingCrs, mapCrs, definitions);
  return bounds(
    edgePoints([x, y, x + w, y + h]).map((p) => convert(forward(fit, p))),
  );
}

/**
 * Image viewport covering a map extent, for "image follows map" navigation.
 * Uses the exact inverse, skipping points where it does not converge.
 * @param fit - Current fit in `workingCrs`.
 * @param extent - Visible map extent in `mapCrs`.
 * @param mapCrs - CRS of `extent`.
 * @param workingCrs - CRS of the fit.
 * @returns Canonical image viewport `[x, y, width, height]`, or null if no point maps back.
 */
export function extentToImageView(
  fit: Fit,
  extent: Extent,
  mapCrs: string,
  workingCrs: string,
  definitions: Definitions = {},
): [number, number, number, number] | null {
  const convert = createConverter(mapCrs, workingCrs, definitions);
  const points = edgePoints(extent)
    .map((p) => backward(fit, convert(p), true))
    .filter((p): p is XY => p !== null);
  const box = bounds(points);
  return box && box[2] > box[0] && box[3] > box[1]
    ? [box[0], box[1], box[2] - box[0], box[3] - box[1]]
    : null;
}
