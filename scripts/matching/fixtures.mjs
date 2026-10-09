import {
  corners,
  inverse,
  multiply,
  transform,
} from "../../packages/matching/dist/geometry.js";
import { createSnapshot } from "../../packages/matching/dist/reference.js";
import { readPng } from "./png.mjs";
export function realFixtures(cv) {
  const reference = readPng(new URL("../../plans/target.png", import.meta.url)),
    query = readPng(new URL("../../plans/to_match.png", import.meta.url));
  const translate = (x, y) => [1, 0, x, 0, 1, y, 0, 0, 1],
    base = translate(196, 259),
    w = query.width,
    h = query.height;
  const snapshot = (image, id) =>
    createSnapshot({
      id,
      width: image.width,
      height: image.height,
      extent: [0, 0, image.width, image.height],
      crs: "EPSG:3857",
      source: { id: "local-ivl", revision: "prd-sha256", layers: ["ivl"] },
      tiles: [{ ...image, x: 0, y: 0 }],
    });
  const crop = (image, x, y, width, height) => {
    const data = new Uint8Array(width * height * 4);
    for (let j = 0; j < height; j++)
      data.set(
        image.data.subarray(
          ((y + j) * image.width + x) * 4,
          ((y + j) * image.width + x + width) * 4,
        ),
        j * width * 4,
      );
    return { width, height, data };
  };
  const mat = (image) =>
    cv.matFromArray(image.height, image.width, cv.CV_8UC4, image.data);
  const annotated = mat(query);
  cv.line(
    annotated,
    new cv.Point(18, 45),
    new cv.Point(309, 268),
    new cv.Scalar(220, 20, 20, 255),
    3,
  );
  cv.circle(
    annotated,
    new cv.Point(240, 110),
    29,
    new cv.Scalar(220, 20, 20, 255),
    3,
  );
  cv.putText(
    annotated,
    "PLAN 2026",
    new cv.Point(15, 190),
    cv.FONT_HERSHEY_SIMPLEX,
    0.7,
    new cv.Scalar(220, 20, 20, 255),
    2,
  );
  const data = new Uint8Array(annotated.data);
  for (let i = 0; i < data.length; i++)
    if (i % 4 !== 3) data[i] = Math.min(255, data[i] * 0.65 + 60);
  annotated.delete();
  const annotation = { ...query, data };
  const src = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0,
      0,
      w - 1,
      0,
      w - 1,
      h - 1,
      0,
      h - 1,
    ]),
    dst = cv.matFromArray(4, 1, cv.CV_32FC2, [
      45,
      20,
      w - 45,
      0,
      w - 1,
      h - 45,
      0,
      h - 1,
    ]),
    pm = cv.getPerspectiveTransform(src, dst),
    perspective = [...pm.data64F];
  src.delete();
  dst.delete();
  pm.delete();
  const rotation = (scale) => {
    const r = cv.getRotationMatrix2D(new cv.Point(w / 2, h / 2), 37, scale),
      g = [...r.data64F, 0, 0, 1];
    r.delete();
    return g;
  };
  const warp = (image, g, pad = true) => {
    const bounds = corners({ x: 0, y: 0, width: w - 1, height: h - 1 }).map(
        (p) => transform(g, p),
      ),
      minX = Math.floor(Math.min(...bounds.map((p) => p[0]))),
      minY = Math.floor(Math.min(...bounds.map((p) => p[1]))),
      maxX = Math.ceil(Math.max(...bounds.map((p) => p[0]))),
      maxY = Math.ceil(Math.max(...bounds.map((p) => p[1])));
    const width = pad ? maxX - minX + 17 : w,
      height = pad ? maxY - minY + 17 : h,
      G = pad ? multiply(translate(8 - minX, 8 - minY), g) : g;
    const input = mat(image),
      output = new cv.Mat(),
      matrix = cv.matFromArray(3, 3, cv.CV_64F, G);
    cv.warpPerspective(
      input,
      output,
      matrix,
      new cv.Size(width, height),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(226, 226, 226, 255),
    );
    const pixels = { width, height, data: new Uint8Array(output.data) };
    input.delete();
    output.delete();
    matrix.delete();
    const edge = multiply(
      translate(0.5, 0.5),
      multiply(inverse(G), translate(-0.5, -0.5)),
    );
    return { query: pixels, expected: multiply(base, edge) };
  };
  const sw = Math.round(w * 0.65),
    sh = Math.round(h * 0.65),
    scale = [sw / w, 0, (sw / w - 1) / 2, 0, sh / h, (sh / h - 1) / 2, 0, 0, 1];
  // `mayMiss`: detectors allowed to return not-found here (too little support), never a wrong placement.
  const cases = [
    { name: "original", query, expected: base },
    { name: "rotation37", ...warp(query, rotation(1)) },
    { name: "scale065", ...warp(query, scale), mayMiss: ["akaze"] },
    { name: "perspective", ...warp(query, perspective, false) },
    { name: "combined", ...warp(query, multiply(rotation(0.8), perspective)) },
    {
      name: "annotated-combined",
      ...warp(annotation, multiply(rotation(0.8), perspective)),
      mayMiss: ["akaze"],
    },
  ].map((test) => ({ ...test, reference: snapshot(reference, test.name) }));
  for (const x of [362, 428])
    cases.push({
      name: `partial-${x}`,
      query: annotation,
      reference: snapshot(
        crop(reference, x, 0, reference.width - x, reference.height),
        `partial-${x}`,
      ),
      expected: multiply(translate(-x, 0), base),
      overlap: (527 - x) / 331,
    });
  cases.push({
    name: "negative",
    query: annotation,
    reference: snapshot(
      crop(reference, 0, 800, reference.width, 529),
      "negative",
    ),
    expected: null,
  });
  return cases;
}
