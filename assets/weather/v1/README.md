# Landi Weather Icons · v1

16 original, transparent icons matching Landi's forest / sage / muted gold palette. License: Apache-2.0, same as this project.

- `svg/`: 64×64 vector masters for Web.
- `png/`: 48, 96 and 192px transparent exports. Prefer 96px files displayed at 32–48px in email.
- `manifest.json`: stable IDs, English/Chinese names, CID convention and SHA-256 of every export.
- `index.mjs`: framework-neutral registry with explicit asset URLs; unknown IDs return `unavailable`.
- `preview.html`, `contact-sheet.png`, `preview-375.png`: catalog and mobile visual review.

From the component root, regenerate with `node scripts/build-weather-icons.mjs`. Uses existing Playwright; no runtime dependencies or external services.

## Web

Import `getWeatherIcon` from this directory's `index.mjs`. For a provider-backed normalized ID:

```js
const icon = getWeatherIcon(conditionId);
// <img src={icon.svgUrl} width={32} height={32} alt="" />
// Keep temperature + unit + condition name visible beside the icon.
```

## Email

Read the chosen PNG bytes at the existing server attachment boundary. Use the manifest CID as the inline attachment's `cid` and `<img src="cid:...">` reference. Preserve bytes and attachment metadata with assembled mail for retries. Do not send the registry's file URLs, SVG, data URIs or the preview HTML. For remote assets, deploy the same PNG through a public HTTPS URL separately.

These assets do not interpret provider codes or text and do not fabricate forecasts. Map only an already verified normalized condition. Missing weather uses `unavailable` plus explicit unavailable text. Simulated weather must remain labeled. In dark UI, place icons on a small cream tile as demonstrated by the catalog.

Design and usage contract: [weather-icon-kit.md](../../../docs/weather-icon-kit.md).
