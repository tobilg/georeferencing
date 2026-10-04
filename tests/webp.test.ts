import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "../packages/core/src/core/types.js";
import { inspectImage } from "../packages/core/src/engine/image.js";

const image = readFileSync("packages/demo/public/elbphilharmonie.webp");
/** Container fixtures exercise header validation; decoding uses real browser fixtures. */
function container(tag: string, data: Uint8Array) {
  const bytes = new Uint8Array(20 + data.length + (data.length % 2));
  bytes.set(new TextEncoder().encode("RIFF"));
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  bytes.set(new TextEncoder().encode(tag), 12);
  new DataView(bytes.buffer).setUint32(16, data.length, true);
  bytes.set(data, 20);
  return new File([bytes], "fixture.webp");
}
describe("IMG-03/05/07 WebP input", () => {
  it("reads the original Hamburg image and enforces pixel budgets before decoding", async () => {
    const file = new File([image], "hamburg.webp");
    expect(await inspectImage(file, DEFAULT_LIMITS)).toMatchObject({
      format: "webp",
      width: 1240,
      height: 697,
      orientation: 1,
    });
    await expect(
      inspectImage(file, { ...DEFAULT_LIMITS, maxInputPixels: 100 }),
    ).rejects.toThrow(/input limit/);
  });
  it("rejects truncated containers, animation and missing image chunks", async () => {
    await expect(
      inspectImage(
        new File([image.subarray(0, 48)], "cut.webp"),
        DEFAULT_LIMITS,
      ),
    ).rejects.toThrow(/length/);
    await expect(
      inspectImage(
        container("VP8X", new Uint8Array([2, 0, 0, 0, 1, 0, 0, 1, 0, 0])),
        DEFAULT_LIMITS,
      ),
    ).rejects.toThrow(/Animated/);
    await expect(
      inspectImage(container("VP8X", new Uint8Array(10)), DEFAULT_LIMITS),
    ).rejects.toThrow(/one image/);
    await expect(
      inspectImage(container("VP8 ", new Uint8Array(4)), DEFAULT_LIMITS),
    ).rejects.toThrow(/header/);
  });
  it("reads lossless dimensions without decoding", async () => {
    const header = new Uint8Array(5);
    header[0] = 0x2f;
    new DataView(header.buffer).setUint32(1, 19 | (29 << 14), true);
    expect(
      await inspectImage(container("VP8L", header), DEFAULT_LIMITS),
    ).toMatchObject({ width: 20, height: 30, format: "webp" });
  });
});
