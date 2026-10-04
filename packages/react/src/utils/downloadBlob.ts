/**
 * Start a browser download and revoke its temporary object URL after one minute, which
 * leaves large files (such as full-resolution GeoTIFFs) time to start saving in every
 * browser. Invoke from a client-side user action; this utility performs no upload.
 */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  // Some browsers ignore clicks on anchors outside the document.
  document.body.append(a);
  try {
    a.click();
  } finally {
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
