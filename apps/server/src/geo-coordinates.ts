export function validLongitudeLatitude(value: string): boolean {
  const [longitude, latitude, extra] = value.split(",");
  if (extra || longitude === undefined || latitude === undefined) return false;
  const lng = Number(longitude);
  const lat = Number(latitude);
  return Number.isFinite(lng) && lng >= -180 && lng <= 180 && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}
