# Hamburg example imagery

These assets belong to the demo application only. They are not part of the
published `@georeferencing/core`, `@georeferencing/plugins` or
`@georeferencing/react` packages, and the repository's MIT license does not apply
to them.

## Source image

- File: `elbphilharmonie.webp`, 1240×697, 93,874 bytes, unmodified.
- © Freie und Hansestadt Hamburg, Landesbetrieb Geoinformation und Vermessung (LGV).
- Digital orthophoto (DOP) excerpt, retrieved 2026-10-03 from the
  [LGV digital orthophoto page](https://www.hamburg.de/politik-und-verwaltung/behoerden/behoerde-fuer-stadtentwicklung-und-wohnen/aemter-und-landesbetrieb/landesbetrieb-geoinformation-und-vermessung/produkte-und-dienstleistungen/geodaten-des-lgv/digitaleorthophotos-244130).
- License: [Datenlizenz Deutschland – Namensnennung – Version 2.0](https://www.govdata.de/dl-de/by-2-0)
  (dl-de/by-2-0).
- SHA-256: `89cdd3e26f2ff11e77a854d640d7edd759e287af5c7d5464db64f40051dd7d71`.
- The file carries no georeferencing metadata; aligning it is the purpose of the demo.

The demo shows this credit next to the example.

## Reference map

The reference view uses live OpenStreetMap street-map tiles through OpenLayers' `OSM`
source, centered on Hamburg harbour. No reference aerial photo or map tiles are bundled.

- Tile URL: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.
- Attribution: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
  displayed on the map.
- [Tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
- Browser requests use normal caching and the source's default CORS/referrer behavior.
  The demo does not prefetch or download tiles for offline use.
- Automated browser tests intercept tile requests with synthetic fixture pixels.

## Accuracy

Initial map framing is not an image transform. Map features and the aerial photo
may differ in date and detail. Use stable ground-level quay corners or bridge ends.
Elevated roofs can be displaced in orthophotos. This exercise is not a surveyed or
QGIS numerical parity fixture.
