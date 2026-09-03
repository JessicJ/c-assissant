export function normalizeWhatsAppUserNumber(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/^\+/, "").replace(/[\s()-]/g, "");
  return normalized && /^\d{7,15}$/.test(normalized) ? normalized : undefined;
}
