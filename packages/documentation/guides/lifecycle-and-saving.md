---
group: Guides
title: Image lifecycle and saving
---

# Image lifecycle and saving

## One authoritative document

The controller owns the editor state. Its frozen `Document` is serializable; files, decoded buffers, maps, layers, workers and object URLs are separate resources. Use controller methods to edit state. `onChange` lets the host mirror committed drafts, but is not a persistence acknowledgement.

`documentRevision` advances on committed changes, including undo/redo. GCP/model/working-CRS edits also advance `alignmentRevision`, cancel obsolete processing, and clear alignment confirmation and feature review. Geographic drawings stay anchored to their existing longitude/latitude coordinates.

## Load, remove and restore

Call `loadImage(file)`, `removeImage()` or `restoreSession(json, originalFile)`. They guard unsaved work before replacing it. The ready-made editor supplies a Save/Discard/Cancel dialog; a headless/composed integration supplies `ControllerOptions.guard`. With no guard, dirty replacement defaults to cancel.

Save failure or cancellation preserves the current document. If edits arrive while a guard or save is pending, the controller asks again about the newer revision. Accepted replacement cancels old jobs, clears image-dependent state/history, releases the old preview URL and preserves the host map view. Late worker results cannot overwrite the new image.

Session JSON contains metadata, GCPs, drawings, settings and provenance, not source bytes. Restoring requires a matching SHA-256 fingerprint, dimensions and orientation. Use `hostAssetId` in stored image metadata to associate a host-managed original asset. The host must arrange any asset storage or retrieval itself. Unknown session schema versions are rejected rather than migrated silently.

## Confirm, draw and review

Digitizing is opt-in through `digitizing: true`. `confirm()` requires a valid fit for exactly the current image/alignment and enters drawing mode. Point, LineString and Polygon features require stable unique string IDs and JSON properties. The OpenLayers binding assigns IDs for its new drawings.

`setFeatures` accepts structurally valid geographic drafts, including editable topology errors. Accepted saving requires valid topology. `deleteFeature` and `updateProperties` preserve document scope and participate in undo/redo.

After returning to alignment and changing it, existing drawings remain geographically fixed. Confirm the new alignment and call `reviewFeatures()` after explicit user review before accepted saving. A successful raster export is not confirmation or feature review.

## Host persistence contract

| Operation | Host callback | Eligibility |
| --- | --- | --- |
| `save("draft")` | `onSaveDraft` | Handler configured; unfinished alignment/drawings may be retained |
| `save()` or `save("features")` | `onSave` | Matching bytes, valid current fit, confirmed alignment, reviewed drawings, valid geometry and configured drawing bounds |

The host receives a frozen snapshot. For accepted features, `SaveEnvelope` includes the document ID/revision, standard geographic GeoJSON, source/alignment provenance, processing engine version and diagnostic formula/CRS.

Implement `replace-document-features` only within the supplied document ID. Omitted IDs mean deletions from that document's prior accepted set, including an empty set. Never clear unrelated host data. Use the provided `requestId` as an idempotency key: retrying the same document/revision/save kind reuses it. A save call for the same document, revision and kind as the pending request shares it. Any other call (a different kind, or a newer revision) waits for the pending request to settle and then submits its own snapshot, so a features save is never silently satisfied by a draft save. An edit made while a save runs requires another explicit save afterwards.

Resolve only when the submitted snapshot is durably accepted by your storage; reject on failure. The controller reports failure and retains the draft. Success acknowledges only the revision that was submitted. Newer edits remain dirty, and completion from an old document cannot mark a replacement document saved.

Draft and accepted-feature acknowledgements are separate. A saved draft can satisfy an unsaved-work guard without making features accepted. Session downloads do not mark work saved. Feature persistence does not require raster export.

## Resource ownership

`suspend()` cancels image/fit/export operations and revokes the image URL, retaining source bytes and document state for remount. `start()` resumes that session. These are suitable for React Strict Mode setup/cleanup.

When permanently finished, detach/unmount the map integration, call `controller.dispose()`, and call `engine.dispose()` when no other consumer uses it. The controller does not dispose host maps/layers or shared engines. Pending host save requests are not cancelled by suspension; their revision bookkeeping still applies.
