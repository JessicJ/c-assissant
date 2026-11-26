export const reviewedTravelDataPaths = Object.freeze([
  "packages/travel-support/data/china/official-source-registry.json",
  "packages/travel-support/data/japan/official-source-registry.json"
]);

const reviewedTravelData = new Set(reviewedTravelDataPaths);
const forbiddenTrackedPath = /(^|\/)(?:\.env(?:\..+)?|data|runtime|secrets)(?:\/|$)|\.(?:sqlite(?:-shm|-wal)?|pem|key|p12|pfx)$/i;

export function isForbiddenTrackedPath(relativePath) {
  return relativePath !== ".env.example"
    && !reviewedTravelData.has(relativePath)
    && forbiddenTrackedPath.test(relativePath);
}

const secretAssignment = /^\s*(?:TELEGRAM_BOT_TOKEN|GOOGLE_MAPS_API_KEY|AMAP_API_KEY|QWEATHER_API_KEY|QWEATHER_API_HOST|WHATSAPP_ACCESS_TOKEN|WHATSAPP_APP_SECRET|WHATSAPP_VERIFY_TOKEN)\s*=\s*([^\s#][^\r\n]*)/gm;
const telegramToken = /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/;
const privateKey = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;

export function trackedContentFailures(relativePath, text) {
  const failures = [];
  secretAssignment.lastIndex = 0;
  if (relativePath !== ".env.example" && secretAssignment.test(text)) failures.push(`A populated Connector secret assignment may be tracked in ${relativePath}.`);
  if (telegramToken.test(text)) failures.push(`A Telegram-style bot token may be tracked in ${relativePath}.`);
  if (privateKey.test(text)) failures.push(`A private key may be tracked in ${relativePath}.`);
  return failures;
}
