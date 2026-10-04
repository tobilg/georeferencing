import { describe, expect, it } from "vitest";
import {
  backward,
  fitTransform,
  forward,
  validateDomain,
} from "../packages/core/src/core/transform.js";
import type { Model, XY } from "../packages/core/src/core/types.js";
import { MODELS } from "../packages/core/src/core/types.js";
import { fixture, known } from "./fixtures/models.js";

describe("AC-04/06/21 mathematical fixtures (not QGIS evidence)", () => {
  for (const model of Object.keys(MODELS) as Model[]) {
    it(`${model}: exact fit, inverse and image domain`, () => {
      const gcps = fixture(model),
        f = fitTransform(gcps, model);
      expect(f.rmse).toBeLessThan(1e-6);
      validateDomain(f, 100, 100);
      for (const p of [
        [20, 30],
        [80, 70],
        [50, 50],
      ] as XY[]) {
        const q = forward(f, p),
          back = backward(f, q, true)!;
        expect(Math.hypot(back[0] - p[0], back[1] - p[1])).toBeLessThan(1e-6);
        if (model !== "thinPlateSpline")
          expect(
            Math.hypot(q[0] - known[model](p)[0], q[1] - known[model](p)[1]),
          ).toBeLessThan(1e-6);
      }
    });
    it(`${model}: rejects insufficient, duplicate, nonfinite GCPs`, () => {
      expect(() =>
        fitTransform(fixture(model).slice(0, MODELS[model].minimum - 1), model),
      ).toThrow(/requires/);
      const dup = fixture(model);
      dup[1].image = dup[0].image;
      expect(() => fitTransform(dup, model)).toThrow(/Duplicate/);
      dup[1].image = [NaN, 1];
      expect(() => fitTransform(dup, model)).toThrow(/finite/);
    });
    it(`${model}: disabled outlier excluded; noisy residual formula`, () => {
      const gcps = fixture(model);
      gcps.push({ ...gcps[0], id: "off", target: [99, 99], enabled: false });
      expect(fitTransform(gcps, model).rmse).toBeLessThan(1e-6);
      gcps[3].target = [gcps[3].target[0] + 0.1, gcps[3].target[1]];
      const f = fitTransform(gcps, model);
      expect(f.rmse).toBeCloseTo(
        Math.sqrt(f.residuals.reduce((s, r) => s + r.distance ** 2, 0) / 16),
        12,
      );
    });
  }
  for (const model of [
    "polynomial1",
    "polynomial2",
    "polynomial3",
    "projective",
    "thinPlateSpline",
  ] as Model[])
    it(`${model}: rejects collinear points`, () => {
      expect(() =>
        fitTransform(
          fixture(model).map((p, i) => ({
            ...p,
            image: [i, i],
            target: [i * 2, i * 3],
          })),
          model,
        ),
      ).toThrow();
    });
  it("AC-24 rejects a quadratic fold", () => {
    const f = fitTransform(
      fixture("polynomial2").map((p) => ({
        ...p,
        target: [(p.image[0] - 43) ** 2, p.image[1]] as XY,
      })),
      "polynomial2",
    );
    expect(() => validateDomain(f, 100, 100)).toThrow();
  });
});
