import type { Cv } from "./backend.js";
import { BACKEND_VERSION, backendError, loadBackend } from "./backend.js";
import { residual, strongest, votePeak } from "./estimate.js";
import type { Features } from "./features.js";
import { extract, extractionWindows, pairFeatures } from "./features.js";
import { corners, distance, transform } from "./geometry.js";
import {
  contentDigest,
  imageSampler,
  referenceSampler,
  validateRequest,
} from "./pixels.js";
import type { MatchExecution, MatchRequest, MatchResult } from "./types.js";
import { validateCandidate } from "./validation.js";
/** Worker-local engine; synchronous backend calls are cancelled by terminating its owner. */
export class MatchingEngine {
  private cv?: Cv;
  private cached?: { key: string; features: Features };
  async match(
    request: MatchRequest,
    execution: MatchExecution = {},
    assetUrl?: string,
  ): Promise<MatchResult> {
    try {
      const { options, region, estimatedMemoryBytes } =
          validateRequest(request),
        start = performance.now();
      execution.onProgress?.({ stage: "initializing", completed: 0, total: 1 });
      this.cv ??= await loadBackend(assetUrl);
      const cv = this.cv,
        initializationMs = performance.now() - start,
        compute = performance.now();
      execution.signal?.throwIfAborted();
      const querySample = imageSampler(request.query),
        refSample = referenceSampler(request.reference);
      const r = request.reference,
        referenceRegion = { x: 0, y: 0, width: r.width, height: r.height };
      // Content digest prevents callers reusing an ID for changed pixels from reusing stale features.
      const hash = r.digest ?? contentDigest(r.tiles);
      const key = JSON.stringify([
        r.id,
        r.source,
        r.width,
        r.height,
        r.tiles.map((t) => [t.x, t.y, t.width, t.height, t.valid]),
        hash,
        options,
      ]);
      const cached =
        this.cached?.key === key ? this.cached.features : undefined;
      // One unit per extraction window, so hosts can show determinate progress.
      const total =
        extractionWindows(region, options).length +
        (cached ? 0 : extractionWindows(referenceRegion, options).length);
      let completed = 0;
      const progress = () => {
        execution.signal?.throwIfAborted();
        execution.onProgress?.({
          stage: "extracting",
          completed: ++completed,
          total,
        });
      };
      const q = extract(cv, querySample, region, options, progress);
      const ref =
        cached ?? extract(cv, refSample, referenceRegion, options, progress);
      this.cached = { key, features: ref };
      execution.onProgress?.({ stage: "searching", completed: 0, total: 1 });
      const tentative = pairFeatures(cv, q, ref, options);
      let pairs = tentative,
        weak = 0;
      const candidates: MatchResult["candidates"] = [],
        rejected: Record<string, number> = {};
      // Remove explained reference correspondences, not query features: repeated locations survive.
      for (
        let attempt = 0;
        attempt < options.maxCandidates * 4 &&
        pairs.length >= options.minInliers;
        attempt++
      ) {
        execution.onProgress?.({
          stage: "validating",
          completed: attempt,
          total: options.maxCandidates * 4,
        });
        const peak = votePeak(pairs, options.minInliers, region),
          hypothesis = strongest(
            cv,
            pairs,
            peak ? [peak] : [],
            options.reprojectionThreshold,
          );
        if (!hypothesis) break;
        if (hypothesis.inliers.length < options.minInliers) {
          rejected["weak-model"] = (rejected["weak-model"] ?? 0) + 1;
          if (++weak >= 3) break;
        } else
          try {
            weak = 0;
            const candidate = validateCandidate(
              hypothesis.inliers,
              tentative,
              region,
              r,
              options,
              querySample,
              refSample,
            );
            const duplicate = candidates.find((c) =>
              corners(region).every(
                (p) =>
                  distance(
                    transform(c.transform, p),
                    transform(candidate.transform, p),
                  ) < 3,
              ),
            );
            if (!duplicate) candidates.push(candidate);
            else if (candidate.score > duplicate.score)
              Object.assign(duplicate, candidate);
          } catch (error) {
            const reason =
              error instanceof Error ? error.message : "backend-fit";
            rejected[reason] = (rejected[reason] ?? 0) + 1;
          }
        // A weak or rejected model only retires its own pairs; three weak models in a row end the search.
        const remaining = pairs.filter(
          (p) =>
            !(
              residual(hypothesis.matrix, p) <=
              options.reprojectionThreshold * 2
            ),
        );
        if (remaining.length === pairs.length) break;
        pairs = remaining;
      }
      candidates.sort(
        (a, b) =>
          b.score - a.score ||
          a.footprint[0][0] - b.footprint[0][0] ||
          a.footprint[0][1] - b.footprint[0][1],
      );
      candidates.splice(options.maxCandidates);
      candidates.forEach((c, i) => {
        c.rank = i + 1;
        c.id = `${r.id}:${i + 1}`;
      });
      const status = !candidates.length
        ? "not-found"
        : candidates[1] &&
            candidates[0].score - candidates[1].score <=
              candidates[0].score * options.ambiguityGap
          ? "ambiguous"
          : "matched";
      if (status === "ambiguous")
        for (const candidate of candidates)
          candidate.warnings.push(
            "Several locations have similar evidence. Review before applying.",
          );
      const heapProbe = cv.matFromArray(1, 1, cv.CV_8UC1, [0]);
      const wasmHeapBytes = heapProbe.data.buffer.byteLength;
      heapProbe.delete();
      return {
        status,
        referenceSnapshotId: r.id,
        candidates,
        bestCandidateId: candidates[0]?.id,
        diagnostics: {
          backend: BACKEND_VERSION,
          detector: options.detector,
          scoreVersion: "evidence/1",
          options,
          initializationMs,
          matchingMs: performance.now() - compute,
          wasmHeapBytes,
          estimatedMemoryBytes,
          queryFeatures: q.points.length,
          referenceFeatures: ref.points.length,
          rejected,
        },
      };
    } catch (error) {
      throw backendError(this.cv, error);
    }
  }
}
