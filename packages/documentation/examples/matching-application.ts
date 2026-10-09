import type { GeoreferencerController } from "@georeferencing/core";
import type {
  ApplicationToken,
  ImageMatcher,
  MatchExecution,
  MatchResult,
  ReferenceProvider,
  ReferenceSelection,
  ReferenceSnapshot,
} from "@georeferencing/matching";
import {
  applyCandidate,
  createApplicationToken,
} from "@georeferencing/matching";
import { decodeReferenceImage } from "@georeferencing/matching/browser";

interface CandidateReview {
  token: ApplicationToken;
  snapshot: ReferenceSnapshot;
  result: MatchResult;
}

// Called by the host's Start action. This never changes control points.
export async function prepareCandidateReview(
  controller: GeoreferencerController,
  matcher: ImageMatcher,
  provider: ReferenceProvider,
  selection: ReferenceSelection,
  configurationRevision: string,
  execution: MatchExecution = {},
): Promise<CandidateReview> {
  const token = createApplicationToken(controller, configurationRevision);
  const snapshot = await provider.acquire(
    structuredClone(selection),
    execution.signal,
  );
  execution.signal?.throwIfAborted();
  const query = await decodeReferenceImage(
    await controller.getNormalizedImage(execution.signal),
  );
  execution.signal?.throwIfAborted();
  const result = await matcher.match({ query, reference: snapshot }, execution);
  return { token, snapshot, result };
}

// Called separately, only after explicit selection and acceptance in the host UI.
export function applyReviewedLocation(
  controller: GeoreferencerController,
  review: CandidateReview,
  selectedId: string,
  currentConfigurationRevision: string,
  mode: "merge" | "replace" = "merge",
) {
  const candidate = review.result.candidates.find((c) => c.id === selectedId);
  if (!candidate)
    throw new Error("Select a candidate from the current review.");
  applyCandidate(
    controller,
    review.result,
    candidate,
    review.snapshot,
    review.token,
    { configurationRevision: currentConfigurationRevision, mode },
  );
}
