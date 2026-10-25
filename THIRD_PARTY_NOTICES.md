# Third-party notices

## Leaflet 1.9.4

Bundled from the npm `leaflet@1.9.4` package without running scripts. BSD-2-Clause license retained at `public/vendor/leaflet/LICENSE`. Source: https://github.com/Leaflet/Leaflet/tree/v1.9.4

## Natural Earth 5.1.2

Offline basemap: 1:50m admin-0 countries, public domain. Source: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson

Source SHA-256: `3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb`

Only geometry and the English country name are retained; geometry coordinates are unchanged. Terms: https://www.naturalearthdata.com/about/terms-of-use/

This generalized basemap is context only, not authoritative jurisdictional boundaries, navigational guidance or an analysis region source. Borders and naming do not imply endorsement. No remote basemap tiles are requested.

## robust-predicates 3.0.2

The unmodified `esm/orient2d.js` and `esm/util.js` files are bundled in `shared/vendor/robust-predicates/`, with their Unlicense retained as `LICENSE`. Source: https://github.com/mourner/robust-predicates . Downloaded from the official npm registry without executing installation scripts; the archive's SHA-512 integrity was verified against registry metadata.

- Package integrity: `sha512-IXgzBWvWQwE6PrDI05OvmXUIruQTcoMDzRsOd5CDvHCVLcLHMTSYvOK5Cm46kWqlV3yAbuSpBZdJ5oP5OUoStg==`
- `orient2d.js` SHA-256: `ba1af2b1ea71924fa2e0a3e50b8972d3a83ab9a9f406dd73e851c9763a8eb741`
- `util.js` SHA-256: `97801e98a1cc91a330fe1b0e56bd5254d6a1305eb7cd2cb8e25c8b69212dcfa9`

The orientation predicate is used for geometry topology checks. The application supplies its own spatial index and validation rules. All files are served locally; no package installation or CDN access is required at runtime.

## Infrastructure vector-tile decoding

These pinned sources were obtained from the official npm registry without executing installation scripts. Each archive's SHA-512 integrity was verified against its package metadata. Only the runtime entry point, package metadata and license are retained. Decoding runs on the local Node server; no CDN or runtime package installation is required.

| Package | License / retained notice | Verified archive integrity |
| --- | --- | --- |
| `@mapbox/vector-tile` 3.0.0 | BSD-3-Clause · `server/vendor/vector-tile/LICENSE.txt` | `sha512-Qf10S1uIHMk20ri/IVBnpS+esUEkVaR5Hftmz88jTInrpmWgPGJfPe3LVjjlE77trLx8tH6qjTG7uWH9hIq/0Q==` |
| `pbf` 5.1.2 | BSD-3-Clause · `server/vendor/pbf/LICENSE` | `sha512-mnvGdvOrIvJOBGUEdGkrVXjN8E/VkIJCkf2eS1DH2yv82ORUlLttmDt0rWY38yYZmVwciZwBUvHM20qxBZf40w==` |
| `@mapbox/point-geometry` 1.1.0 | ISC · `server/vendor/point-geometry/LICENSE` | `sha512-YGcBz1cg4ATXDCM/71L9xveh4dynfGmcLDqufR+nQQy3fKwsAZsWd/x4621/6uJaeB9mwOHE6hPeDgXz9uViUQ==` |

Sources: [vector-tile-js](https://github.com/mapbox/vector-tile-js), [pbf](https://github.com/mapbox/pbf), [point-geometry](https://github.com/mapbox/point-geometry). The vector-tile entry point has one local change: its point-geometry import uses the vendored relative path. The other runtime files are unmodified. Compiler-only pbf dependencies and development/type packages are not used or bundled.
