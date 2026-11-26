# Fixed Landi email illustrations

The six user-supplied illustrations in `important-update/v1` replace dynamically generated Important Update photographs. The editorial cover places its HTML event headline in the artwork’s left negative space and keeps the traveler on the right. HTTPS background/VML and a sage fallback preserve readable text without a separate title strip. JPEGs preserve the source aspect ratio and full composition; `manifest.json` records source filenames, dimensions and digests. Source PNGs in the user's Downloads folder are untouched. No image API or runtime upload is used.

The default artwork is already publicly hosted at `https://raw.githubusercontent.com/JessicJ/c-assissant/cec3eca9bfb58f54ff997d0b7c4e85fa3218825d/assets/email`. New installations use it automatically; blank or missing environment configuration needs no setup.

For an optional private deployment override, publish the **contents of this directory** to a static public HTTPS directory through the deployment owner's existing website/CDN. Set `LANDI_EMAIL_ASSET_BASE_URL` in the deployment's private configuration to that directory, without a query or fragment. For example, a base of `https://assets.example.org/email` must expose `https://assets.example.org/email/important-update/v1/weather-impact.jpg`. Do not use localhost, expiring signed URLs or login-protected files. Do not change or overwrite a published version; publish a new version for artwork changes so older emails remain readable.

This is deployment configuration, not traveler setup. The default six JPEGs and manifest were published with the user’s authorization; no new hosting account was created. Local design previews may substitute the same checked bytes for offline display, while actual emails retain HTTPS links. Verify anonymous mobile access and actual Gmail/Apple Mail display before enabling production delivery.

Run the local six-case preview from the component root:

```sh
node scripts/preview-important-update.mjs data/email-manual-tests/important-update-static
```

The preview wrapper labels all examples as simulated. Preview substitutions are never passed to SMTP. Existing small PNG icons remain CID parts; the six illustrations are normal HTTPS references and do not become `event-hero` attachments.
