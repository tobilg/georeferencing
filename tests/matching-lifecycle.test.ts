import { expect, it } from "vitest";
import type {
  ResponseMessage,
  WorkerPort,
} from "../packages/matching/src/executor.js";
import { createExecutor } from "../packages/matching/src/executor.js";
import { createSnapshot } from "../packages/matching/src/reference.js";
import type { MatchResult } from "../packages/matching/src/types.js";
import { DEFAULT_MATCH_OPTIONS } from "../packages/matching/src/types.js";
import { syntheticPlan } from "./fixtures/matching.js";

it("bounds live workers and ignores late messages after repeated aborts", async () => {
  const query = syntheticPlan(64, 64);
  const request = {
    query,
    reference: createSnapshot({
      id: "lifecycle",
      width: 64,
      height: 64,
      crs: "EPSG:3857",
      extent: [0, 0, 64, 64],
      source: { id: "test", revision: "1", layers: ["test"] },
      tiles: [{ ...query, x: 0, y: 0 }],
    }),
  };
  const ports: { receive: (message: ResponseMessage) => void; id: number }[] =
    [];
  let live = 0;
  const executor = createExecutor((): WorkerPort => {
    live++;
    const port = { receive: (_message: ResponseMessage) => {}, id: 0 };
    ports.push(port);
    return {
      postMessage(message) {
        port.id = (message as { id: number }).id;
      },
      listen(receive) {
        port.receive = receive;
      },
      terminate() {
        live--;
      },
    };
  });
  for (let i = 0; i < 5; i++) {
    const abort = new AbortController();
    const job = executor.match(request, { signal: abort.signal });
    expect(live).toBe(1);
    await expect(executor.match(request)).rejects.toMatchObject({
      code: "BUSY",
    });
    abort.abort();
    await expect(job).rejects.toMatchObject({ name: "AbortError" });
    expect(live).toBe(0);
  }
  let settled = false;
  const job = executor.match(request).then((result) => {
    settled = true;
    return result;
  });
  const result = {
    status: "not-found",
    referenceSnapshotId: "lifecycle",
    candidates: [],
    diagnostics: {
      backend: "test",
      detector: "sift",
      scoreVersion: "test",
      options: DEFAULT_MATCH_OPTIONS,
      initializationMs: 0,
      matchingMs: 0,
      wasmHeapBytes: 0,
      estimatedMemoryBytes: 0,
      queryFeatures: 0,
      referenceFeatures: 0,
      rejected: {},
    },
  } as MatchResult;
  for (const port of ports.slice(0, -1)) port.receive({ id: port.id, result });
  await Promise.resolve();
  expect(settled).toBe(false);
  ports.at(-1)!.receive({ id: ports.at(-1)!.id, result });
  await expect(job).resolves.toEqual(result);
  expect(live).toBe(1);
  executor.dispose();
  executor.dispose();
  expect(live).toBe(0);
});
