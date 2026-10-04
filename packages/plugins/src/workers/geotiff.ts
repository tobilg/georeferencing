/** Dedicated GeoTIFF encoding asset. @internal */
import { coordinateUnits } from "@georeferencing/core";
import { installEncoderWorker } from "@georeferencing/core/encoder-worker";
import { encodeGeoTiffBlob } from "../tiff.js";

installEncoderWorker({
  id: "geotiff",
  encode: ({ raster, output }, { definitions, onProgress }) =>
    encodeGeoTiffBlob(
      raster.data,
      raster.width,
      raster.height,
      raster.bounds,
      raster.crs,
      coordinateUnits(raster.crs, definitions) === "degrees",
      output,
      onProgress,
    ),
});
