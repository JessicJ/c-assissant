export type CountryPackId = "china" | "japan";
export type CountryPackResolution =
  | { status: "resolved"; countryPackId: CountryPackId; normalizedCountry: "CN" | "JP" }
  | { status: "needs_confirmation"; reasonCode: "missing_country" | "unsupported_country" | "ambiguous_country"; message: string };

const aliases: Record<string, { countryPackId: CountryPackId; normalizedCountry: "CN" | "JP" }> = {
  cn: { countryPackId: "china", normalizedCountry: "CN" },
  china: { countryPackId: "china", normalizedCountry: "CN" },
  "people's republic of china": { countryPackId: "china", normalizedCountry: "CN" },
  "peoples republic of china": { countryPackId: "china", normalizedCountry: "CN" },
  jp: { countryPackId: "japan", normalizedCountry: "JP" },
  japan: { countryPackId: "japan", normalizedCountry: "JP" }
};

/** Resolves only a provider-normalized country fact. City or free-text matching is intentionally forbidden. */
export function resolveCountryPack(country: string | undefined): CountryPackResolution {
  const normalized = country?.trim().toLowerCase().replaceAll(/\s+/g, " ") ?? "";
  if (!normalized) return { status: "needs_confirmation", reasonCode: "missing_country", message: "Confirm the destination country before Country Pack preparation." };
  if (normalized.includes(",") || normalized.includes("/")) return { status: "needs_confirmation", reasonCode: "ambiguous_country", message: "V1 supports one confirmed destination country per Plan." };
  const match = aliases[normalized];
  return match ? { status: "resolved", ...match } : { status: "needs_confirmation", reasonCode: "unsupported_country", message: "No Country Pack is available for the normalized destination country." };
}
