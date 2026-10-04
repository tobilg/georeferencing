import proj4 from "proj4";
import type { Extent, XY } from "./types.js";
import { fail, GeoreferenceError } from "./types.js";

/** Validated converters keyed by resolved source and destination definitions. */
const converters = new Map<string, (p: XY) => XY>();
/**
 * Host-supplied projection definitions keyed by normalized CRS identifier, with PROJ
 * strings or WKT as values.
 */
export type Definitions = Record<string, string>;
/**
 * Host-supplied NTv2 grid bytes keyed by the names referenced by `+nadgrids`. No network
 * loading is implicit.
 */
export type DatumGrids = Record<string, ArrayBuffer>;
/**
 * Validate and register host-provided NTv2 buffers in the current JavaScript realm. Worker realms receive their own copies through engine options.
 * Also discards cached converters, so later conversions use the current grids and definitions.
 * @throws {@link GeoreferenceError} If grid headers or registration are invalid.
 */
export function registerDatumGrids(grids: DatumGrids = {}): void {
  converters.clear();
  for (const [name, data] of Object.entries(grids)) {
    if (!name || !(data instanceof ArrayBuffer) || data.byteLength < 352)
      fail("GRID", `Invalid NTv2 datum grid: ${name}`);
    const view = new DataView(data),
      little = view.getInt32(8, true) === 11;
    if (
      new TextDecoder().decode(data.slice(0, 8)) !== "NUM_OREC" ||
      view.getInt32(8, little) !== 11 ||
      view.getInt32(24, little) !== 11 ||
      view.getInt32(40, little) < 1
    )
      fail("GRID", `Expected an NTv2 grid with subgrids: ${name}`);
    try {
      proj4.nadgrid(name, data);
    } catch (e) {
      fail("GRID", `Cannot register datum grid ${name}: ${String(e)}`);
    }
  }
}
/**
 * Normalize recognized EPSG URI/URN forms and CRS84 aliases to a common identifier.
 * Axis-order handling remains the reference provider's responsibility.
 */
export function normalizeCrs(crs: string): string {
  if (/^(?:urn:ogc:def:crs:OGC.*:CRS84|CRS:84|OGC:CRS84)$/i.test(crs))
    return "EPSG:4326";
  const code =
    /(?:^EPSG:|\/def\/crs\/EPSG\/[^/]*\/|^urn:(?:x-)?ogc:def:crs:EPSG:(?:[^:]*):)(\d+)$/i.exec(
      crs,
    );
  return code ? `EPSG:${code[1]}` : crs;
}
/**
 * Reject missing mandatory datum grids before proj4 can silently omit a required shift.
 */
function requireGrids(definition: string): void {
  const p = new proj4.Proj(definition) as unknown as {
    datum?: {
      grids?: {
        name: string;
        mandatory: boolean;
        isNull: boolean;
        grid: unknown;
      }[];
    };
  };
  const missing = p.datum?.grids?.find(
    (g) => g.mandatory && !g.isNull && !g.grid,
  );
  if (missing)
    fail(
      "GRID",
      `Required datum grid '${missing.name}' is unavailable. Supply its NTv2 bytes using datumGrids.`,
    );
}
/**
 * Return the projection's units for display, `degrees` for geographic CRSs, or a
 * descriptive fallback if resolution fails.
 */
export function coordinateUnits(
  crs: string,
  definitions: Definitions = {},
): string {
  try {
    const p = new proj4.Proj(definitions[crs] ?? crs) as unknown as {
      units?: string;
      projName?: string;
    };
    return p.projName === "longlat" ? "degrees" : (p.units ?? "CRS units");
  } catch {
    return "unavailable CRS units";
  }
}
const inlineDefinition = (value: string) =>
  /^(?:PROJCRS|GEOGCRS|GEODCRS|BOUNDCRS|COMPOUNDCRS|GEOGCS|PROJCS)\[|^\+proj=/.test(
    value,
  );
/**
 * Create a validated, reusable coordinate converter between explicit CRSs. Definitions and
 * mandatory datum grids are checked once; the returned function only transforms.
 * Converters are cached by resolved definition, so repeated calls are cheap.
 * @param from - Source CRS identifier or inline definition.
 * @param to - Destination CRS identifier or inline definition.
 * @param definitions - Additional host projection definitions.
 * @returns Converter; its output may be nonfinite outside the projection domain.
 * @throws {@link GeoreferenceError} For missing definitions or required datum grids.
 */
export function createConverter(
  from: string,
  to: string,
  definitions: Definitions = {},
): (p: XY) => XY {
  from = normalizeCrs(from);
  to = normalizeCrs(to);
  const src = definitions[from] ?? from,
    dst = definitions[to] ?? to,
    key = `${src}\u0000${dst}`;
  const cached = converters.get(key);
  if (cached) return cached;
  try {
    if (!proj4.defs(from) && !definitions[from] && !inlineDefinition(from))
      fail("CRS", `Missing projection definition: ${from}`);
    if (!proj4.defs(to) && !definitions[to] && !inlineDefinition(to))
      fail("CRS", `Missing projection definition: ${to}`);
    let convert: (p: XY) => XY;
    if (from === to) convert = (p) => [p[0], p[1]];
    else {
      requireGrids(src);
      requireGrids(dst);
      const c = proj4(src, dst);
      convert = (p) => c.forward([p[0], p[1]]) as XY;
    }
    // Bounded: hosts use a handful of CRS pairs.
    if (converters.size >= 64) converters.clear();
    converters.set(key, convert);
    return convert;
  } catch (e) {
    if (e instanceof GeoreferenceError) throw e;
    return fail("CRS", `Cannot convert ${from} to ${to}: ${String(e)}`);
  }
}
/**
 * Convert an `[x, y]` coordinate between explicit CRSs using proj4. Geographic tuples always use longitude then latitude.
 * @param p - Finite input coordinate in `from`.
 * @param from - Source CRS identifier or inline definition.
 * @param to - Destination CRS identifier or inline definition.
 * @param definitions - Additional host projection definitions.
 * @throws {@link GeoreferenceError} For missing definitions, required datum grids or nonfinite output.
 */
export function project(
  p: XY,
  from: string,
  to: string,
  definitions: Definitions = {},
): XY {
  const convert = createConverter(from, to, definitions);
  let result: XY;
  try {
    result = convert(p);
  } catch (e) {
    return fail(
      "CRS",
      `Cannot convert ${normalizeCrs(from)} to ${normalizeCrs(to)}: ${String(e)}`,
    );
  }
  if (!result.every(Number.isFinite))
    fail("CRS", "Projection produced nonfinite coordinates.");
  return result;
}
/**
 * Transform bounds by sampling all four edges at 65 positions each.
 *
 * The returned enclosure is sampled, not an exact nonlinear extremum. Empty, inverted and recognized wrapped geographic extents are rejected; use a custom split loader for antimeridian queries.
 * @returns Bounding extent in the destination CRS.
 */
export function projectExtent(
  extent: Extent,
  from: string,
  to: string,
  definitions: Definitions = {},
): Extent {
  if (
    !extent.every(Number.isFinite) ||
    extent[0] >= extent[2] ||
    extent[1] >= extent[3]
  )
    fail(
      "EXTENT",
      "Invalid or wrapped extent. Split antimeridian requests explicitly.",
    );
  if (
    from === "EPSG:4326" &&
    (extent[0] < -180 || extent[2] > 180 || extent[1] < -90 || extent[3] > 90)
  )
    fail(
      "WRAP",
      "Wrapped/geographic extent is unsupported; split it in a custom provider.",
    );
  const out: Extent = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i <= 64; i++)
    for (const p of [
      [extent[0] + ((extent[2] - extent[0]) * i) / 64, extent[1]],
      [extent[0] + ((extent[2] - extent[0]) * i) / 64, extent[3]],
      [extent[0], extent[1] + ((extent[3] - extent[1]) * i) / 64],
      [extent[2], extent[1] + ((extent[3] - extent[1]) * i) / 64],
    ]) {
      const q = project(p as XY, from, to, definitions);
      out[0] = Math.min(out[0], q[0]);
      out[1] = Math.min(out[1], q[1]);
      out[2] = Math.max(out[2], q[0]);
      out[3] = Math.max(out[3], q[1]);
    }
  if (to === "EPSG:4326" && out[2] - out[0] > 180)
    fail("WRAP", "Antimeridian-crossing query requires a custom split loader.");
  return out;
}
/**
 * Intersect two extents in the same coordinate space. Returns null when the intersection
 * has no positive area.
 */
export function intersection(a: Extent, b: Extent): Extent | null {
  const e: Extent = [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ];
  return e[0] < e[2] && e[1] < e[3] ? e : null;
}
