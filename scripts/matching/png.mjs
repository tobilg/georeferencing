// Local fixture reader: 8-bit, non-interlaced PNG (grayscale/RGB/RGBA).

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
export function readPng(path) {
  const bytes = readFileSync(path);
  let width, height, channels;
  const chunks = [];
  for (let p = 8; p < bytes.length; ) {
    const n = bytes.readUInt32BE(p),
      type = bytes.toString("ascii", p + 4, p + 8),
      d = bytes.subarray(p + 8, p + 8 + n);
    p += 12 + n;
    if (type === "IHDR") {
      width = d.readUInt32BE(0);
      height = d.readUInt32BE(4);
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[d[9]];
      if (d[8] !== 8 || d[12] !== 0 || !channels)
        throw Error("Unsupported local PNG fixture");
    }
    if (type === "IDAT") chunks.push(d);
  }
  const raw = inflateSync(Buffer.concat(chunks)),
    stride = width * channels,
    decoded = new Uint8Array(stride * height),
    data = new Uint8Array(width * height * 4);
  const paeth = (a, b, c) => {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x,
        a = x >= channels ? decoded[i - channels] : 0,
        b = y ? decoded[i - stride] : 0,
        c = y && x >= channels ? decoded[i - stride - channels] : 0;
      decoded[i] =
        (raw[y * (stride + 1) + x + 1] +
          [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]) &
        255;
    }
  }
  for (let i = 0; i < width * height; i++) {
    const j = i * channels;
    data[i * 4] = decoded[j];
    data[i * 4 + 1] = channels < 3 ? decoded[j] : decoded[j + 1];
    data[i * 4 + 2] = channels < 3 ? decoded[j] : decoded[j + 2];
    data[i * 4 + 3] =
      channels === 2 ? decoded[j + 1] : channels === 4 ? decoded[j + 3] : 255;
  }
  return { width, height, data };
}
