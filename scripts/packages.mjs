// Public npm packages, in publish order: core first, since every other package declares
// it as a peer dependency. Private workspaces (demo, documentation) are not listed.
export const PUBLIC_PACKAGES = [
  "core",
  "plugins",
  "matching",
  "react",
  "openlayers",
  "maplibre",
  "leaflet",
];
