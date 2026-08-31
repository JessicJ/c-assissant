# Use English copy for first Movement Cards

The first Movement Action Card implementation will use Landi's current English product language rather than adding Chinese or broader localization work. This keeps the first `/go` slice aligned with the existing V1 interface language and avoids coupling execution semantics to an internationalization effort.

## Considered Options

- Add localized card copy immediately. This would help multilingual demos, but it expands the first slice beyond execution behavior.
- Use current English copy. This keeps implementation focused and consistent with the existing product surface.
