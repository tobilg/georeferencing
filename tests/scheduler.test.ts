import { expect, it, vi } from "vitest";
import {
  createJobScheduler,
  createWorkerEngine,
} from "../packages/core/src/engine/index.js";

it("NFR-03/09 host concurrency queue is bounded, fair and cancellable before creating workers", async () => {
  const queue = createJobScheduler(1),
    release = await queue.acquire();
  const abort = new AbortController(),
    cancelled = queue.acquire(abort.signal).catch((e) => e.name),
    waiting = queue.acquire();
  expect(queue.running).toBe(1);
  expect(queue.pending).toBe(2);
  abort.abort();
  expect(await cancelled).toBe("AbortError");
  expect(queue.pending).toBe(1);
  release();
  release();
  const finish = await waiting;
  expect(queue.running).toBe(1);
  expect(queue.pending).toBe(0);
  finish();
  expect(queue.running).toBe(0);
  const occupied = await queue.acquire();
  let created = 0;
  const engine = createWorkerEngine({
    scheduler: queue,
    workerFactory: () => {
      created++;
      throw Error("must not create queued worker");
    },
  });
  const result = engine
    .run(
      { kind: "inspect", file: new File([], "empty.png") },
      { documentId: "x", imageId: "y", alignmentRevision: 1 },
    )
    .catch((e) => e.name);
  engine.dispose();
  expect(await result).toBe("AbortError");
  expect(created).toBe(0);
  expect(queue.pending).toBe(0);
  occupied();
});

it("NFR-03/AC-18 codec overrides share the engine scheduler, transfer buffers and terminate on abort", async () => {
  const queue = createJobScheduler(1),
    release = await queue.acquire();
  let created = 0,
    terminated = 0;
  let posted:
    | {
        request: import("../packages/core/src/engine/index.js").EncodeRequest;
        limits: { maxOutputPixels: number };
      }
    | undefined;
  const engine = createWorkerEngine({
    scheduler: queue,
    limits: { maxOutputPixels: 10 },
    workerFactory: () => {
      throw Error("Must use the codec override");
    },
  });
  const data = new Uint8ClampedArray([10, 20, 30, 255]);
  const abort = new AbortController();
  const result = engine
    .run(
      {
        kind: "encode",
        format: "jpeg",
        output: { crs: "EPSG:3857", resampler: "nearest" },
        raster: {
          width: 1,
          height: 1,
          data,
          bounds: [0, 0, 1, 1],
          crs: "EPSG:3857",
          estimatedBytes: 4,
        },
      },
      { documentId: "document", imageId: "image", alignmentRevision: 1 },
      {
        signal: abort.signal,
        workerFactory: () => {
          created++;
          return {
            postMessage(message: unknown, transfer: Transferable[]) {
              posted = structuredClone(message, { transfer }) as typeof posted;
            },
            terminate() {
              terminated++;
            },
          } as unknown as Worker;
        },
      },
    )
    .catch((error) => error.name);
  expect(created).toBe(0);
  expect(queue.pending).toBe(1);
  release();
  await vi.waitFor(() => expect(posted).toBeDefined());
  expect(created).toBe(1);
  expect(data.byteLength).toBe(0);
  expect([...posted!.request.raster.data]).toEqual([10, 20, 30, 255]);
  expect(posted!.limits.maxOutputPixels).toBe(10);
  abort.abort();
  expect(await result).toBe("AbortError");
  expect(terminated).toBe(1);
  expect(queue.running).toBe(0);
  engine.dispose();
});

it("worker failures carry recoverability and the engine exposes its limits", async () => {
  const tag = { documentId: "d", imageId: "i", alignmentRevision: 1 };
  const fake = (
    respond: (worker: Worker, message: { operationId: string }) => void,
  ) =>
    createWorkerEngine({
      limits: { maxGcps: 12 },
      workerFactory: () => {
        const worker = {
          terminate() {},
          postMessage(message: { operationId: string }) {
            queueMicrotask(() => respond(worker, message));
          },
        } as unknown as Worker;
        return worker;
      },
    });
  const request = { kind: "inspect" as const, file: new File([], "a.png") };
  const crashed = fake((worker) =>
    worker.onerror?.({ message: "" } as ErrorEvent),
  );
  expect(crashed.limits?.maxGcps).toBe(12);
  await expect(crashed.run(request, tag)).rejects.toMatchObject({
    code: "WORKER",
    recoverable: false,
  });
  const garbled = fake((worker) => worker.onmessageerror?.({} as MessageEvent));
  await expect(garbled.run(request, tag)).rejects.toMatchObject({
    recoverable: false,
  });
  for (const recoverable of [true, false, undefined]) {
    const reported = fake((worker, message) =>
      worker.onmessage?.({
        data: {
          tag,
          operationId: message.operationId,
          error: { code: "FORMAT", message: "bad", recoverable },
        },
      } as MessageEvent),
    );
    await expect(reported.run(request, tag)).rejects.toMatchObject({
      code: "FORMAT",
      recoverable: recoverable !== false,
    });
  }
});
