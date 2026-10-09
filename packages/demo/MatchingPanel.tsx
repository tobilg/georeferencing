/** Demo-owned review UI; applications build controls suited to their own workflow. */
import type {
  Definitions,
  GeoreferencerController,
} from "@georeferencing/core";
import type {
  ApplicationToken,
  ImageMatcher,
  MatchOptions,
  MatchResult,
  ReferenceProvider,
  ReferenceSelection,
  ReferenceSnapshot,
  Region,
} from "@georeferencing/matching";
import {
  applyCandidate,
  createApplicationToken,
} from "@georeferencing/matching";
import {
  createBrowserMatcher,
  decodeReferenceImage,
} from "@georeferencing/matching/browser";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
export interface MatchingPanelProps {
  controller: GeoreferencerController;
  provider: ReferenceProvider;
  layers: { id: string; label: string }[];
  initialSelection: ReferenceSelection;
  configurationRevision: string;
  definitions?: Definitions;
  /** Explicit detector and memory budgets; keep query limits aligned with the core engine. */
  matchOptions?: Partial<MatchOptions>;
  matcherFactory?: () => ImageMatcher;
  currentSelection?: () => ReferenceSelection;
  onPreview?: (
    result: MatchResult,
    snapshot: ReferenceSnapshot,
    candidateId: string,
  ) => undefined | (() => void);
}
/** Optional review panel: captures a frozen reference, proposes points only on explicit Apply. */
export function MatchingPanel({
  controller,
  provider,
  layers,
  initialSelection,
  configurationRevision,
  definitions,
  matchOptions,
  matcherFactory = createBrowserMatcher,
  currentSelection,
  onPreview,
}: MatchingPanelProps) {
  const state = useSyncExternalStore(
      controller.subscribe,
      controller.getSnapshot,
      controller.getSnapshot,
    ),
    [selection, setSelection] = useState(initialSelection),
    [region, setRegion] = useState<Region | undefined>(),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState<{
      result: MatchResult;
      snapshot: ReferenceSnapshot;
      token: ApplicationToken;
    } | null>(null),
    [selected, setSelected] = useState(""),
    [mode, setMode] = useState<"merge" | "replace">("merge");
  const matcher = useRef<ImageMatcher | null>(null),
    active = useRef<AbortController | null>(null),
    generation = useRef(0);
  const key = JSON.stringify([
    configurationRevision,
    matchOptions,
    selection,
    region,
    state.document.id,
    state.document.sourceImage?.id,
    state.document.alignmentRevision,
  ]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: any request identity change cancels and invalidates results.
  useEffect(() => {
    generation.current++;
    active.current?.abort();
    setBusy(false);
    setReview(null);
  }, [key]);
  useEffect(
    () => () => {
      generation.current++;
      active.current?.abort();
      matcher.current?.dispose();
      matcher.current = null;
    },
    [],
  );
  useEffect(() => {
    if (review && selected)
      return onPreview?.(review.result, review.snapshot, selected);
  }, [review, selected, onPreview]);
  const start = async () => {
    active.current?.abort();
    const abort = new AbortController();
    active.current = abort;
    const job = ++generation.current;
    setBusy(true);
    setReview(null);
    setStatus("Preparing reference…");
    const token = createApplicationToken(controller, key);
    try {
      const snapshot = await provider.acquire(selection, abort.signal);
      abort.signal.throwIfAborted();
      setStatus("Preparing image…");
      const query = await decodeReferenceImage(
        await controller.getNormalizedImage(abort.signal),
      );
      abort.signal.throwIfAborted();
      matcher.current ??= matcherFactory();
      const result = await matcher.current.match(
        {
          query,
          queryRegion: region,
          reference: snapshot,
          options: matchOptions,
        },
        {
          signal: abort.signal,
          onProgress: (p) => {
            if (job === generation.current)
              setStatus(
                {
                  initializing: "Preparing matcher…",
                  extracting: "Finding image detail…",
                  searching: "Searching selected area…",
                  validating: "Checking possible locations…",
                }[p.stage],
              );
          },
        },
      );
      if (job !== generation.current) return;
      setReview({ result, snapshot, token });
      setSelected(result.bestCandidateId ?? "");
      setStatus(
        result.status === "not-found"
          ? "No reliable match"
          : result.status === "ambiguous"
            ? "Several possible locations"
            : "Match ready for review",
      );
    } catch (error) {
      if (job === generation.current)
        setStatus(
          abort.signal.aborted
            ? "Matching cancelled"
            : error instanceof Error
              ? error.message
              : String(error),
        );
    } finally {
      if (job === generation.current) setBusy(false);
    }
  };
  const image = state.document.sourceImage;
  const guidanceId = useId();
  const unavailable =
    state.loading === "running"
      ? "Wait for the image to finish loading."
      : !image || !state.imageUrl
        ? "Load an image to enable automatic matching."
        : state.mode !== "align"
          ? "Return to Match points to find a location."
          : !selection.layers.length
            ? "Select at least one reference layer."
            : "";
  return (
    <section
      className="rg-auto-match-panel"
      aria-label="Automatic image matching"
    >
      <h2>Find this image on the map</h2>
      <p className="rg-hint">
        Search the selected area, then review the suggested points.
      </p>
      <div className="rg-match-source">
        <fieldset disabled={busy}>
          <legend>Reference layers</legend>
          {layers.map((layer) => (
            <label className="rg-inline" key={layer.id}>
              <input
                type="checkbox"
                checked={selection.layers.includes(layer.id)}
                onChange={(e) =>
                  setSelection({
                    ...selection,
                    layers: e.target.checked
                      ? [...selection.layers, layer.id]
                      : selection.layers.filter((id) => id !== layer.id),
                  })
                }
              />
              {layer.label}
            </label>
          ))}
        </fieldset>
        {currentSelection && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setSelection(currentSelection())}
          >
            Use current map area
          </button>
        )}
      </div>
      <details className="rg-match-settings">
        <summary>Search settings</summary>
        <fieldset disabled={busy}>
          <legend className="rg-visually-hidden">
            Search area and resolution
          </legend>
          <div className="rg-coordinate-entry">
            {(["West", "South", "East", "North"] as const).map((label, i) => (
              <label key={label}>
                {label}
                <input
                  aria-label={`Search ${label}`}
                  type="number"
                  value={selection.extent[i]}
                  onChange={(e) =>
                    setSelection({
                      ...selection,
                      extent: selection.extent.map((v, j) =>
                        j === i ? Number(e.target.value) : v,
                      ) as ReferenceSelection["extent"],
                    })
                  }
                />
              </label>
            ))}
          </div>
          <label>
            Map units per pixel
            <input
              type="number"
              min="0.000001"
              step="any"
              value={selection.resolution}
              onChange={(e) =>
                setSelection({
                  ...selection,
                  resolution: Number(e.target.value),
                })
              }
            />
          </label>
          <p className="rg-hint">Coordinate system: {selection.crs}</p>
        </fieldset>
      </details>
      {image && (
        <details className="rg-match-settings">
          <summary>Choose part of the image</summary>
          <p className="rg-hint">
            Enter the bounds of the plan in image pixels to leave out legends or
            inset plans.
          </p>
          <div className="rg-coordinate-entry">
            {(["x", "y", "width", "height"] as const).map((field) => (
              <label key={field}>
                {
                  {
                    x: "Left (px)",
                    y: "Top (px)",
                    width: "Width (px)",
                    height: "Height (px)",
                  }[field]
                }
                <input
                  type="number"
                  value={
                    (region ?? {
                      x: 0,
                      y: 0,
                      width: image.width,
                      height: image.height,
                    })[field]
                  }
                  onChange={(e) =>
                    setRegion({
                      ...(region ?? {
                        x: 0,
                        y: 0,
                        width: image.width,
                        height: image.height,
                      }),
                      [field]: Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
          </div>
          <button type="button" onClick={() => setRegion(undefined)}>
            Use whole image
          </button>
        </details>
      )}
      <div className="rg-match-actions">
        <button
          type="button"
          className="rg-primary"
          disabled={busy || !!unavailable}
          aria-describedby={guidanceId}
          onClick={() => void start()}
        >
          {busy ? "Finding location…" : "Find location"}
        </button>
        {busy && (
          <button type="button" onClick={() => active.current?.abort()}>
            Cancel matching
          </button>
        )}
        <p id={guidanceId} className="rg-hint" role="status" aria-live="polite">
          {unavailable || status || "Review the result before adding points."}
        </p>
      </div>
      {review?.result.candidates.map((candidate) => (
        <div
          className="rg-match-result"
          data-selected={selected === candidate.id}
          key={candidate.id}
        >
          <label>
            <input
              type="radio"
              name={`matching-candidate-${guidanceId}`}
              checked={selected === candidate.id}
              onChange={() => setSelected(candidate.id)}
            />
            {candidate.rank}.{" "}
            {candidate.extentStatus === "partial"
              ? "Partial match"
              : "Complete match"}{" "}
            · {(candidate.overlapFraction * 100).toFixed(1)}% in search area
          </label>
          <p>
            {candidate.independentInliers} verified features spread over{" "}
            {(candidate.supportCoverage * 100).toFixed(0)}% of the visible plan.{" "}
            {candidate.warnings.join(" ")}
          </p>
          <details>
            <summary>Match diagnostics</summary>
            <pre className="rg-match-diagnostics">
              {JSON.stringify(
                { ...candidate, correspondences: undefined },
                null,
                2,
              )}
            </pre>
          </details>
        </div>
      ))}
      {review && selected && (
        <>
          <label>
            Existing points
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "merge" | "replace")}
            >
              <option value="merge">Keep and add proposed points</option>
              <option value="replace">Replace with proposed points</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              try {
                applyCandidate(
                  controller,
                  review.result,
                  review.result.candidates.find((c) => c.id === selected)!,
                  review.snapshot,
                  review.token,
                  { configurationRevision: key, mode, definitions },
                );
                setStatus(
                  "Points added. Use Run alignment to continue to Check alignment.",
                );
                setReview(null);
              } catch (error) {
                setStatus(String(error));
              }
            }}
          >
            Apply selected location
          </button>
        </>
      )}
    </section>
  );
}
