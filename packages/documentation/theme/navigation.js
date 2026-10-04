// Let long import paths in the sidebar (such as @georeferencing/core/openlayers) wrap
// after "/" instead of being clipped. TypeDoc builds the navigation with JavaScript, so
// labels are adjusted whenever navigation nodes are added.
const pathBreak = "/​";
function wrapPaths(root) {
  for (const label of root.querySelectorAll(
    ".tsd-navigation a, .tsd-navigation span",
  )) {
    for (const node of label.childNodes)
      if (
        node.nodeType === Node.TEXT_NODE &&
        node.data.includes("/") &&
        !node.data.includes(pathBreak)
      )
        node.data = node.data.replaceAll("/", pathBreak);
  }
}
new MutationObserver(() => wrapPaths(document)).observe(
  document.documentElement,
  {
    childList: true,
    subtree: true,
  },
);
document.addEventListener("DOMContentLoaded", () => wrapPaths(document));
