# Landi weather icons v1

Shared, original presentation assets for email and Web. This resource preparation does not change weather research, provider interpretation, mail rendering, delivery or any live Plan. Adopt icons in product surfaces separately after visual review.

## Visual contract

Use a 64×64 transparent canvas, rounded 2.5px forest strokes, soft sage clouds, muted gold sunshine and blue-green precipitation. Keep silhouettes legible at 24–48px. Light and dark backgrounds must both preserve the symbol; use a cream tile behind small icons in dark surfaces when needed. Avoid emoji, icon fonts and unrelated icon libraries.

Include clear day/night, partly cloudy day/night, cloudy, overcast, light/moderate/heavy rain, showers, thunderstorm, snow, sleet, fog, wind and unavailable. Rain intensity is distinguished by the number and weight of drops as well as its text label. Do not infer a condition from prose or precipitation probability in this asset package. Consumers must use a source-backed normalized weather condition and explicit units; unknown data uses unavailable, never a sunny fallback.

## Shared resources

`assets/weather/v1/` owns SVG source, transparent PNG exports (48, 96 and 192px), a JSON manifest and a framework-neutral ESM registry. `scripts/build-weather-icons.mjs` regenerates the exports and a visual catalog using the existing Playwright dependency; no new runtime dependency is required. Export bytes and their SHA-256 are recorded in the manifest.

Web can import `weatherIcons` from `assets/weather/v1/index.mjs`; explicit `new URL()` asset references allow bundlers to include the resources. Email must use the PNG bytes through the existing inline CID attachment mechanism, never the registry's local URL or SVG. CID naming: `landi-weather-v1-<id>@landi.assets`. Include only used icons; visible temperature and condition remain HTML and plain text. Standalone files may instead use a deployment-owned public HTTPS image URL.

Preview weather values are illustrative and labeled Simulated. They are not forecasts and never enter Plan/provider facts. Default presentation is icon + temperature with unit + short condition name; provenance/query links may be separate. Images are decorative when the same condition is written beside them; otherwise provide its accessible name. This kit alone does not send a test email or replace the existing weather card.

## Review

Inspect all icons at 24, 32 and 48px and on cream and forest surfaces. Check exported PNG dimensions/transparency, manifest hashes, unique IDs and importable registry paths. The catalog is a local development artifact; its controls and scripts never enter email HTML.
