# Hamburg example imagery

Retrieved 2026-10-03. These assets belong to the private demo, not the published
core, React or plugins packages. Application code licensing does not relicense imagery.

## Source image

- File: `elbphilharmonie.webp`, original unmodified response, 93,874 bytes, 1240×697.
- User-supplied [hamburg.de image](https://www.hamburg.de/resource/image/244210/landscape_ratio16x9/1240/697/7318622fc10dd5f77769a58ccfc8be1e/93342C630206278A1DD5B335B97E3977/b-dop.webp).
- Publisher: Freie und Hansestadt Hamburg, Landesbetrieb Geoinformation und Vermessung (LGV), via hamburg.de.
- [Context page](https://www.hamburg.de/politik-und-verwaltung/behoerden/behoerde-fuer-stadtentwicklung-und-wohnen/aemter-und-landesbetrieb/landesbetrieb-geoinformation-und-vermessung/produkte-und-dienstleistungen/geodaten-des-lgv/digitaleorthophotos-244130).
- SHA-256: `89cdd3e26f2ff11e77a854d640d7edd759e287af5c7d5464db64f40051dd7d71`.
- No georeferencing, capture date or reuse license is asserted for this web derivative.
  Its source attribution and original rights are retained. It is included as the
  example expressly supplied by the user for this local demo.

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

The user selects all image/map pairs. Initial map framing is not an image transform.
Map features and the aerial photo may differ in date and detail. Use stable ground-level
quay corners or bridge ends. Elevated roofs can be displaced in orthophotos. This
exercise is not a surveyed or QGIS numerical parity fixture.
