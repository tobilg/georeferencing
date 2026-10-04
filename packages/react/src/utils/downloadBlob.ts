/**
 * Start a browser download and revoke its temporary object URL after one second. Invoke
 * from a client-side user action; this utility performs no upload.
 */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
