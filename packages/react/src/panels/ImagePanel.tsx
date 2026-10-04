import type { GeoreferencerController, XY } from "@georeferencing/core";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { useGeoreferencer } from "../hooks/useGeoreferencer.js";
import type { Translate } from "../localization.js";
import { identity } from "../localization.js";

/**
 * Image selection/drop, independent image navigation and source GCP picking. Display stretch affects the image panel only; it does not change export pixels.
 *
 * This composable panel subscribes to the controller but does not attach the reference map or install an unsaved-work guard; manage those in the host when composing panels yourself.
 */
export function ImagePanel({
  /** Shared authoritative editor controller; the panel does not own its lifecycle. */
  controller,
  /** Optional translation function; defaults to returning English messages unchanged. */
  t = identity,
}: {
  /** Shared authoritative editor controller; the panel does not own its lifecycle. */
  controller: GeoreferencerController;
  /** Optional translation function; defaults to returning English messages unchanged. */
  t?: Translate;
}) {
  const s = useGeoreferencer(controller),
    image = s.document.sourceImage,
    svg = useRef<SVGSVGElement>(null);
  const view: [number, number, number, number] = s.imageView ?? [
    0, 0, 100, 100,
  ];
  const setView = (next: typeof view | ((value: typeof view) => typeof view)) =>
    controller.setImageView(typeof next === "function" ? next(view) : next);
  const [brightness, setBrightness] = useState(1),
    [contrast, setContrast] = useState(1),
    [histogram, setHistogram] = useState<number[]>([]),
    [stretch, setStretch] = useState<[number, number][]>([
      [0, 255],
      [0, 255],
      [0, 255],
    ]);
  const filterId = `rg-stretch-${useId().replace(/:/g, "")}`;
  const displayPixels = useRef<ImageData | null>(null);
  const stretchHistogram = (local: boolean) => {
    const pixels = displayPixels.current;
    if (!pixels || !image) return;
    const x0 = local
        ? Math.max(0, Math.floor((view[0] * pixels.width) / image.width))
        : 0,
      y0 = local
        ? Math.max(0, Math.floor((view[1] * pixels.height) / image.height))
        : 0,
      x1 = local
        ? Math.min(
            pixels.width,
            Math.ceil(((view[0] + view[2]) * pixels.width) / image.width),
          )
        : pixels.width,
      y1 = local
        ? Math.min(
            pixels.height,
            Math.ceil(((view[1] + view[3]) * pixels.height) / image.height),
          )
        : pixels.height;
    const ranges: [number, number][] = [
        [255, 0],
        [255, 0],
        [255, 0],
      ],
      bins = Array<number>(32).fill(0);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * pixels.width + x) * 4;
        if (!pixels.data[i + 3]) continue;
        for (let c = 0; c < 3; c++) {
          ranges[c][0] = Math.min(ranges[c][0], pixels.data[i + c]);
          ranges[c][1] = Math.max(ranges[c][1], pixels.data[i + c]);
        }
        bins[
          Math.min(
            31,
            Math.floor(
              (pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2]) / 24,
            ),
          )
        ]++;
      }
    setStretch(ranges.map(([lo, hi]) => (hi > lo ? [lo, hi] : [0, 255])));
    setHistogram(bins);
  };
  const drag = useRef<{
    start: XY;
    view: typeof view;
    id?: string;
    point?: XY;
    pointerId: number;
  } | null>(null);
  const [dragPoint, setDragPoint] = useState<{ id: string; point: XY } | null>(
    null,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset only when the immutable source image ID changes, not on document clones during edits.
  useEffect(() => {
    if (image)
      controller.setImageView([
        -image.width * 0.04,
        -image.height * 0.06,
        image.width * 1.08,
        image.height * 1.12,
      ]);
    setBrightness(1);
    setContrast(1);
    setStretch([
      [0, 255],
      [0, 255],
      [0, 255],
    ]);
  }, [image?.id, controller]);
  useEffect(() => {
    if (!s.imageUrl) {
      setHistogram([]);
      return;
    }
    let disposed = false;
    const img = new Image();
    img.onload = () => {
      if (disposed) return;
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      displayPixels.current = ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const data = displayPixels.current.data,
        bins = Array<number>(32).fill(0);
      for (let i = 0; i < data.length; i += 4)
        if (data[i + 3])
          bins[
            Math.min(31, Math.floor((data[i] + data[i + 1] + data[i + 2]) / 24))
          ]++;
      setHistogram(bins);
      canvas.width = 0;
    };
    img.src = s.imageUrl;
    return () => {
      disposed = true;
      displayPixels.current = null;
      img.onload = null;
      img.src = "";
    };
  }, [s.imageUrl]);
  const point = (e: { clientX: number; clientY: number }): XY => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      matrix.inverse(),
    );
    return [p.x, p.y];
  };
  const zoom = (
    factor: number,
    center: XY = [view[0] + view[2] / 2, view[1] + view[3] / 2],
  ) =>
    setView((v) => [
      center[0] + (v[0] - center[0]) * factor,
      center[1] + (v[1] - center[1]) * factor,
      Math.max(1, v[2] * factor),
      Math.max(1, v[3] * factor),
    ]);
  const down = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!image) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    const p = point(e);
    if (s.tool === "gcp" && e.button === 0 && !e.shiftKey) {
      if (p[0] >= 0 && p[1] >= 0 && p[0] <= image.width && p[1] <= image.height)
        controller.setPendingPoint(p);
      return;
    }
    drag.current = {
      start: [e.clientX, e.clientY],
      view,
      pointerId: e.pointerId,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  return (
    <section
      className="rg-image-panel"
      aria-label={t("Source image")}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) void controller.loadImage(file);
      }}
    >
      <div className="rg-panel-heading">
        <h2>{t("Source image")}</h2>
        <label className="rg-file">
          {t(image ? "Replace image" : "Choose image")}
          <input
            aria-label={t("Choose image")}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/tiff,.tif,.tiff"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void controller.loadImage(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {image ? (
        <>
          <div className="rg-image-meta">
            {image.name} · {image.width} × {image.height} px
            {image.georeferenced && (
              <span>
                {" "}
                · {t("Existing georeferencing detected; not adopted")}
              </span>
            )}
          </div>
          <svg
            ref={svg}
            className="rg-image-view"
            role="img"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: This image viewer supports focused arrow-key panning and +/- zoom; numeric inputs provide GCP editing.
            tabIndex={0}
            onKeyDown={(e) => {
              const steps: Record<string, XY> = {
                ArrowLeft: [-0.1, 0],
                ArrowRight: [0.1, 0],
                ArrowUp: [0, -0.1],
                ArrowDown: [0, 0.1],
              };
              if (steps[e.key]) {
                e.preventDefault();
                const [x, y] = steps[e.key];
                setView([
                  view[0] + x * view[2],
                  view[1] + y * view[3],
                  view[2],
                  view[3],
                ]);
              }
              if (e.key === "+" || e.key === "=") {
                e.preventDefault();
                zoom(0.8);
              }
              if (e.key === "-") {
                e.preventDefault();
                zoom(1.25);
              }
            }}
            aria-label={t(
              "Image control point viewer; use numeric table for keyboard placement",
            )}
            viewBox={view.join(" ")}
            onPointerDown={down}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              if (d.id) {
                d.point = point(e);
                setDragPoint({ id: d.id, point: d.point });
              } else {
                const scale = Math.max(
                  view[2] / e.currentTarget.clientWidth,
                  view[3] / e.currentTarget.clientHeight,
                );
                setView([
                  d.view[0] - (e.clientX - d.start[0]) * scale,
                  d.view[1] - (e.clientY - d.start[1]) * scale,
                  d.view[2],
                  d.view[3],
                ]);
              }
            }}
            onPointerUp={(e) => {
              const d = drag.current;
              drag.current = null;
              if (d?.id && d.point)
                controller.updateGcp(d.id, { image: d.point });
              setDragPoint(null);
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setDragPoint(null);
            }}
            onWheel={(e) => {
              zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, point(e));
            }}
          >
            <defs>
              <filter id={filterId} colorInterpolationFilters="sRGB">
                <feComponentTransfer>
                  <feFuncR
                    type="linear"
                    slope={255 / (stretch[0][1] - stretch[0][0])}
                    intercept={-stretch[0][0] / (stretch[0][1] - stretch[0][0])}
                  />
                  <feFuncG
                    type="linear"
                    slope={255 / (stretch[1][1] - stretch[1][0])}
                    intercept={-stretch[1][0] / (stretch[1][1] - stretch[1][0])}
                  />
                  <feFuncB
                    type="linear"
                    slope={255 / (stretch[2][1] - stretch[2][0])}
                    intercept={-stretch[2][0] / (stretch[2][1] - stretch[2][0])}
                  />
                </feComponentTransfer>
              </filter>
            </defs>
            {s.imageUrl && (
              <image
                href={s.imageUrl}
                width={image.width}
                height={image.height}
                style={{
                  filter: `url(#${filterId}) brightness(${brightness}) contrast(${contrast})`,
                }}
              />
            )}
            {s.document.gcps.map((gcp) => {
              const p = dragPoint?.id === gcp.id ? dragPoint.point : gcp.image;
              return (
                <g
                  key={gcp.id}
                  transform={`translate(${p[0]} ${p[1]})`}
                  onPointerDown={(e) => {
                    if (s.mode !== "align") return;
                    e.stopPropagation();
                    e.preventDefault();
                    svg.current?.focus({ preventScroll: true });
                    drag.current = {
                      id: gcp.id,
                      start: p,
                      point: p,
                      view,
                      pointerId: e.pointerId,
                    };
                    svg.current!.setPointerCapture(e.pointerId);
                  }}
                >
                  <circle
                    r={view[2] / 90}
                    fill={gcp.enabled ? "#c95722" : "#666"}
                    stroke="white"
                    strokeWidth={view[2] / 450}
                  />
                  <text
                    y={-view[2] / 55}
                    textAnchor="middle"
                    fill="#132f29"
                    stroke="white"
                    paintOrder="stroke"
                    strokeWidth={view[2] / 400}
                    fontSize={view[2] / 35}
                  >
                    {gcp.label}
                  </text>
                </g>
              );
            })}
            {s.pendingImagePoint && (
              <circle
                cx={s.pendingImagePoint[0]}
                cy={s.pendingImagePoint[1]}
                r={view[2] / 70}
                fill="none"
                stroke="#12695b"
                strokeWidth={view[2] / 300}
              />
            )}
          </svg>
          <div className="rg-toolbar">
            <button
              type="button"
              onClick={() => zoom(0.8)}
              aria-label={t("Zoom image in")}
            >
              +
            </button>
            <button
              type="button"
              onClick={() => zoom(1.25)}
              aria-label={t("Zoom image out")}
            >
              −
            </button>
            <button
              type="button"
              onClick={() =>
                setView([
                  -image.width * 0.04,
                  -image.height * 0.06,
                  image.width * 1.08,
                  image.height * 1.12,
                ])
              }
            >
              {t("Fit image")}
            </button>
            <button
              type="button"
              onClick={() => controller.navigateImageHistory(-1)}
            >
              {t("Previous image view")}
            </button>
            <button
              type="button"
              onClick={() => controller.navigateImageHistory(1)}
            >
              {t("Next image view")}
            </button>
            <button type="button" onClick={() => void controller.removeImage()}>
              {t("Remove image")}
            </button>
          </div>
          <label>
            {t("Linked navigation")}
            <select
              disabled={!s.fit}
              value={s.linkedNavigation}
              onChange={(e) =>
                controller.setLinkedNavigation(
                  e.target.value as "off" | "image-to-map" | "map-to-image",
                )
              }
            >
              <option value="off">{t("Independent views")}</option>
              <option value="image-to-map">{t("Map follows image")}</option>
              <option value="map-to-image">{t("Image follows map")}</option>
            </select>
          </label>
          <details>
            <summary>{t("Display adjustment & histogram")}</summary>
            <div className="rg-toolbar">
              <button type="button" onClick={() => stretchHistogram(false)}>
                {t("Full histogram stretch")}
              </button>
              <button type="button" onClick={() => stretchHistogram(true)}>
                {t("Local histogram stretch")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStretch([
                    [0, 255],
                    [0, 255],
                    [0, 255],
                  ]);
                  setBrightness(1);
                  setContrast(1);
                }}
              >
                {t("Reset display")}
              </button>
            </div>
            <label>
              {t("Brightness")}
              <input
                type="range"
                min="0.25"
                max="2"
                step="0.05"
                value={brightness}
                onChange={(e) => setBrightness(Number(e.target.value))}
              />
            </label>
            <label>
              {t("Contrast")}
              <input
                type="range"
                min="0.25"
                max="2"
                step="0.05"
                value={contrast}
                onChange={(e) => setContrast(Number(e.target.value))}
              />
            </label>
            <svg
              viewBox="0 0 320 50"
              aria-label={t("RGB intensity histogram of preview")}
              className="rg-histogram"
            >
              {histogram.map((v, i) => (
                <rect
                  // biome-ignore lint/suspicious/noArrayIndexKey: The 32 fixed histogram bins retain their position and identity across updates.
                  key={i}
                  x={i * 10}
                  y={50 - (50 * v) / Math.max(1, ...histogram)}
                  width="9"
                  height={(50 * v) / Math.max(1, ...histogram)}
                  fill="currentColor"
                />
              ))}
            </svg>
            <small>
              {t("Display only. Original samples are preserved for export.")}
            </small>
          </details>
        </>
      ) : (
        <div className="rg-empty">
          <span className="rg-cross">＋</span>
          <p>{t("Drop a map, plan, or photograph here.")}</p>
          <small>
            {t(
              "PNG, JPEG, WebP, ordinary TIFF · up to 25 MiB · stays on this device",
            )}
          </small>
        </div>
      )}
    </section>
  );
}
