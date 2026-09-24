export const RANKING_WEIGHTS = Object.freeze({ rating: 0.55, distance: 0.35, provider: 0.10 });
export const RADII = Object.freeze([500, 1000, 3000, 5000]);
export const textValue = (v, limit = 240) => typeof v === 'string' ? v.trim().slice(0, limit) : '';
export function numberValue(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  if (typeof v === 'string' && (!v.trim() || !/^-?\d+(\.\d+)?$/.test(v.trim()))) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
export function coordinates(v) {
  const a = typeof v === 'string' ? v.split(',') : Array.isArray(v) ? v : [v?.lng, v?.lat];
  if (a.length !== 2) return null;
  const lng = numberValue(a[0]), lat = numberValue(a[1]);
  if (lng === null || lat === null || Math.abs(lng) > 180 || Math.abs(lat) > 90 || (lng === 0 && lat === 0)) return null;
  return { lng, lat };
}
export function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function validRating(value, scale) {
  if (scale !== 5) return null;
  const n = numberValue(value);
  return n !== null && n > 0 && n <= 5 ? n : null;
}
export function normalizePois(pois, { center, radius, matchLevel, ratingScale = null }) {
  if (!Array.isArray(pois) || !coordinates(center) || !RADII.includes(radius) || !['specific', 'related'].includes(matchLevel)) return [];
  return pois.slice(0, 20).flatMap((poi, order) => {
    if (!poi || typeof poi !== 'object') return [];
    const id = textValue(poi.id, 100), name = textValue(poi.name), position = coordinates(poi.location);
    // 仅接受餐饮 POI；按坐标自行核算直线距离，忽略上游 distance 字符串。
    if (!id || !name || !position || !/^05\d{4}(?:\||$)/.test(textValue(poi.typecode))) return [];
    const distance = distanceMeters(center, position);
    if (distance > radius) return [];
    const business = poi.business && !Array.isArray(poi.business) ? poi.business : {};
    return [{ id, name, ...position, distance, matchLevel,
      address: textValue(poi.address), rating: validRating(business.rating, ratingScale),
      hours: textValue(business.opentime_today) || textValue(business.opentime_week),
      providerScore: 1 - order / Math.max(1, Math.min(pois.length, 20) - 1),
    }];
  });
}
export function mergePois(...batches) {
  const map = new Map();
  for (const poi of batches.flat()) {
    const prev = map.get(poi.id);
    if (!prev) { map.set(poi.id, { ...poi }); continue; }
    const better = prev.matchLevel === 'related' && poi.matchLevel === 'specific' ? poi : prev;
    const other = better === prev ? poi : prev;
    map.set(poi.id, { ...better, address: better.address || other.address, hours: better.hours || other.hours, rating: better.rating ?? other.rating });
  }
  return [...map.values()];
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
export function rankPois(pois, radius, ratingScale = null) {
  return ['specific', 'related'].flatMap(level => {
    const group = pois.filter(p => p.matchLevel === level);
    const ratings = group.map(p => validRating(p.rating, ratingScale)).filter(v => v !== null);
    const baseline = ratings.length ? median(ratings) : null;
    const { rating: rw, distance: dw, provider: pw } = RANKING_WEIGHTS;
    const denominator = baseline === null ? dw + pw : rw + dw + pw;
    return group.map(p => ({ ...p, score: (
      (baseline === null ? 0 : rw * ((validRating(p.rating, ratingScale) ?? baseline) / 5)) +
      dw * (1 - Math.min(1, Math.max(0, p.distance / radius))) + pw * p.providerScore
    ) / denominator })).sort((a, b) => b.score - a.score || a.distance - b.distance || a.id.localeCompare(b.id));
  }).slice(0, 6).map(({ score, ...p }) => p);
}
export function normalizePlaces(pois) {
  if (!Array.isArray(pois)) return [];
  const seen = new Set();
  return pois.slice(0, 20).flatMap(p => {
    const position = coordinates(p?.location), name = textValue(p?.name), id = textValue(p?.id, 100);
    if (!position || !name || !id || seen.has(id)) return [];
    seen.add(id);
    const address = [...new Set([p.pname, p.cityname, p.adname, p.address].map(x => textValue(x)).filter(Boolean))].join(' · ');
    return [{ id, name, ...position, address }];
  });
}
export function needsCenterConfirmation(center, radius) {
  if (!coordinates(center)) return true;
  if (['manual', 'confirmed'].includes(center.source)) return false;
  return center.coarse === true || numberValue(center.accuracy) === null || center.accuracy <= 0 || center.accuracy > radius / 2;
}
export const radiusLabel = radius => radius < 1000 ? `${radius}m` : `${radius / 1000}km`;
