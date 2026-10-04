import type { Gcp, Model, XY } from "../../packages/core/src/core/types.js";
export const grid: XY[] = [
  [0, 0],
  [100, 0],
  [0, 100],
  [100, 100],
  [50, 0],
  [0, 50],
  [50, 100],
  [100, 50],
  [25, 25],
  [75, 25],
  [25, 75],
  [75, 75],
  [50, 50],
  [10, 30],
  [90, 70],
  [20, 80],
];
// Analytic expected functions, independent of the fitter.
export const known: Record<Model, (p: XY) => XY> = {
  linear: ([x, y]) => [1000 + 2 * x, 2000 - 3 * y],
  helmert: ([x, y]) => [1000 + 2 * x + 0.5 * y, 2000 + 0.5 * x - 2 * y],
  polynomial1: ([x, y]) => [1000 + 2 * x + 0.3 * y, 2000 + 0.2 * x - 3 * y],
  polynomial2: ([x, y]) => [
    1000 + 2 * x + 0.002 * x * y,
    2000 - 3 * y + 0.001 * x * x,
  ],
  polynomial3: ([x, y]) => [
    1000 + 2 * x + 0.000002 * x * x * y,
    2000 - 3 * y + 0.000001 * x * y * y,
  ],
  projective: ([x, y]) => [
    (1000 + 2 * x + 0.3 * y) / (1 + 0.0001 * x + 0.0002 * y),
    (2000 + 0.2 * x - 3 * y) / (1 + 0.0001 * x + 0.0002 * y),
  ],
  thinPlateSpline: ([x, y]) => [
    1000 + 2 * x + 0.002 * x * y,
    2000 - 3 * y + 0.001 * x * x,
  ],
};
export const fixture = (model: Model): Gcp[] =>
  grid.map((image, i) => ({
    id: `gcp-${i}`,
    label: i + 1,
    enabled: true,
    image,
    target: known[model](image),
    crs: "EPSG:3857",
  }));
