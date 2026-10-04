/** Dedicated JPEG encoding asset; original raster pixels are returned unchanged. @internal */
import { fail } from "@georeferencing/core";
import { installEncoderWorker } from "@georeferencing/core/encoder-worker";

installEncoderWorker({
  id: "jpeg",
  async encode({ raster, options }, { onProgress }) {
    const quality = options?.quality ?? 0.92;
    const background = options?.background ?? [255, 255, 255];
    if (
      typeof quality !== "number" ||
      !Number.isFinite(quality) ||
      quality < 0 ||
      quality > 1 ||
      !Array.isArray(background) ||
      background.length !== 3 ||
      background.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
    )
      fail("JPEG_OPTIONS", "Invalid JPEG quality or RGB background.");
    const pixels = new Uint8ClampedArray(raster.data.length);
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = raster.data[i + 3] / 255;
      for (let c = 0; c < 3; c++)
        pixels[i + c] =
          raster.data[i + c] * alpha +
          (background as number[])[c] * (1 - alpha);
      pixels[i + 3] = 255;
    }
    const canvas = new OffscreenCanvas(raster.width, raster.height);
    try {
      const context = canvas.getContext("2d");
      if (!context)
        fail("MEMORY_BUDGET", "Cannot allocate the JPEG encoding canvas.");
      context!.putImageData(
        new ImageData(pixels, raster.width, raster.height),
        0,
        0,
      );
      onProgress(0.5);
      const blob = await canvas.convertToBlob({
        type: "image/jpeg",
        quality: quality as number,
      });
      if (blob.type !== "image/jpeg")
        fail("CAPABILITY", "This browser cannot encode JPEG.");
      onProgress(1);
      return blob;
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  },
});
