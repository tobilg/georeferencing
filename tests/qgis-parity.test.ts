import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  backward,
  fitTransform,
  forward,
} from "../packages/core/src/core/transform.js";
import type { Gcp, Model, XY } from "../packages/core/src/core/types.js";

const reference = JSON.parse(
  readFileSync("tests/fixtures/qgis-transforms.json", "utf8"),
) as {
  qgis: string;
  records: {
    model: Model;
    case: string;
    gcps: Gcp[];
    checkpoints: XY[];
    qgisForward: [boolean, number, number][];
    qgisBackward: [boolean, number, number][];
    qgisRmse: number;
    qgisResiduals: { id: string; vector: XY; pixels: number }[];
  }[];
};
for (const record of reference.records.filter((r) =>
  ["exact", "noisy"].includes(r.case),
))
  it(`AC-21 pinned ${reference.qgis} ${record.model} ${record.case}: independent forward/backward checkpoints`, () => {
    const fit = fitTransform(record.gcps, record.model);
    expect(Math.abs(fit.rmse - record.qgisRmse)).toBeLessThan(1e-6);
    for (const residual of fit.residuals) {
      const expected = record.qgisResiduals.find((r) => r.id === residual.id)!;
      expect(
        Math.hypot(...residual.vector.map((v, i) => v - expected.vector[i])),
      ).toBeLessThan(1e-6);
      expect(Math.abs(residual.pixels! - expected.pixels)).toBeLessThan(1e-6);
    }
    record.checkpoints.forEach((p, i) => {
      const expected = record.qgisForward[i],
        q = forward(fit, p),
        back = backward(fit, expected.slice(1) as XY)!;
      expect(expected[0]).toBe(true);
      expect(Math.hypot(q[0] - expected[1], q[1] - expected[2])).toBeLessThan(
        1e-6,
      );
      expect(
        Math.hypot(
          back[0] - record.qgisBackward[i][1],
          back[1] - record.qgisBackward[i][2],
        ),
      ).toBeLessThan(1e-6);
    });
  });

const invalid = JSON.parse(
  readFileSync("tests/fixtures/qgis-invalid.json", "utf8"),
) as { records: { model: Model; case: string; gcps: Gcp[]; valid: boolean }[] };
for (const record of invalid.records)
  it(`AC-21 pinned invalid-input behavior ${record.model} ${record.case}`, async () => {
    const { validateDomain } = await import(
      "../packages/core/src/core/transform.js"
    );
    // Collinear, distinct Helmert points fully determine a similarity transform.
    const geometricallyValid =
      record.model === "helmert" && record.case === "collinear";
    if (geometricallyValid) {
      expect(record.valid).toBe(true);
      expect(() =>
        validateDomain(fitTransform(record.gcps, record.model), 100, 100),
      ).not.toThrow();
    } else
      expect(() =>
        validateDomain(fitTransform(record.gcps, record.model), 100, 100),
      ).toThrow();
  });
