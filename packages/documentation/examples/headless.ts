import type { ControllerOptions, XY } from "@georeferencing/core";
import { GeoreferencerController } from "@georeferencing/core";
import { createWorkerEngine } from "@georeferencing/core/engine";
import type { MapAdapter } from "@georeferencing/core/map";
import { geoTiff } from "@georeferencing/plugins/geotiff";

/** Elements and services of a host page without React. */
export interface HostPage {
  /** Shows `snapshot.imageUrl`, the reduced preview of the loaded image. */
  image: HTMLImageElement;
  status: HTMLElement;
  fileInput: HTMLInputElement;
  alignButton: HTMLButtonElement;
  exportButton: HTMLButtonElement;
  /** Adapter for the host map, for example `maplibre(map)` or `leaflet(map, { lib: L })`. */
  adapter: MapAdapter;
  /** Ask the user before replacing unsaved work. */
  confirmDiscard: () => Promise<boolean>;
  persist: NonNullable<ControllerOptions["onSave"]>;
  download: (blob: Blob, name: string) => void;
}

export function mountEditor(page: HostPage) {
  const engine = createWorkerEngine();
  const controller = new GeoreferencerController({
    workingCrs: "EPSG:3857",
    engine,
    previewMode: "manual",
    exports: [geoTiff()],
    onSave: page.persist,
    guard: async () => ((await page.confirmDiscard()) ? "discard" : "cancel"),
  });
  const binding = page.adapter(controller);

  // Render every snapshot. Snapshots are frozen; never mutate them.
  const unsubscribe = controller.subscribe(() => {
    const s = controller.getSnapshot();
    if (s.imageUrl && page.image.src !== s.imageUrl)
      page.image.src = s.imageUrl;
    page.alignButton.disabled = s.document.gcps.length < 3;
    page.exportButton.disabled =
      controller.getExportUnavailable("geotiff") !== null;
    page.status.textContent =
      s.error ??
      (s.pendingImagePoint
        ? "Now click the same spot on the map."
        : `${s.document.gcps.length} control points`);
  });

  const onFile = async () => {
    const file = page.fileInput.files?.[0];
    if (file && (await controller.loadImage(file))) controller.setTool("gcp");
  };
  // A click on the image starts a pair; the map adapter completes it on a map click.
  const onImageClick = (event: MouseEvent) => {
    const source = controller.getSnapshot().document.sourceImage;
    if (!source) return;
    // The displayed image is a reduced preview: convert to original-resolution pixels.
    const box = page.image.getBoundingClientRect();
    const point: XY = [
      ((event.clientX - box.left) / box.width) * source.width,
      ((event.clientY - box.top) / box.height) * source.height,
    ];
    controller.setTool("gcp");
    controller.setPendingPoint(point);
  };
  const onAlign = async () => {
    await controller.refit();
    if (controller.getSnapshot().fit) binding.fitOverlay();
  };
  const onExport = async () => {
    const result = await controller.export("geotiff");
    for (const file of result?.files ?? []) page.download(file.blob, file.name);
  };

  page.fileInput.addEventListener("change", onFile);
  page.image.addEventListener("click", onImageClick);
  page.alignButton.addEventListener("click", onAlign);
  page.exportButton.addEventListener("click", onExport);

  return function unmount() {
    page.fileInput.removeEventListener("change", onFile);
    page.image.removeEventListener("click", onImageClick);
    page.alignButton.removeEventListener("click", onAlign);
    page.exportButton.removeEventListener("click", onExport);
    unsubscribe();
    binding.detach();
    controller.dispose();
    engine.dispose();
  };
}
