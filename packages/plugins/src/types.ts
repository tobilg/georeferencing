/** Optional deployment overrides for one format's dedicated encoding worker. */
export interface RasterPluginOptions {
  /** Host factory for a dedicated codec worker; takes precedence over workerUrl. */
  workerFactory?: () => Worker;
  /** Same-origin URL of this format's deployed module worker. */
  workerUrl?: string | URL;
}

/** JPEG encoding options. Georeferencing is delivered in required sidecars. */
export interface JpegOptions extends RasterPluginOptions {
  /** Browser JPEG quality in [0, 1]; defaults to 0.92. JPEG is lossy. */
  quality?: number;
  /** Opaque RGB background for transparent/no-data pixels; defaults to white. */
  background?: [number, number, number];
}
