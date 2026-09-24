import { FOOD_BY_ID } from '../src/food-data.js';
import { coordinates, RADII } from '../src/ranking.js';
import { ApiError } from './upstream.js';

function positionParams(params) {
  const position = coordinates({ lng: params.get('lng'), lat: params.get('lat') });
  if (!position) throw new ApiError('BAD_REQUEST', 400);
  return `${position.lng.toFixed(6)},${position.lat.toFixed(6)}`;
}
function allowedParams(params, allowed) {
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new ApiError('BAD_REQUEST', 400);
}
export function buildApiRequest(pathname, params, config) {
  if (pathname === '/api/nearby') {
    allowedParams(params, ['foodId', 'step', 'lng', 'lat', 'radius']);
    const food = FOOD_BY_ID.get(params.get('foodId')), stepString = params.get('step'), radius = Number(params.get('radius'));
    if (!food || !/^[0-2]$/.test(stepString || '') || !food.searchPlan[Number(stepString)] || !RADII.includes(radius)) throw new ApiError('BAD_REQUEST', 400);
    const query = food.searchPlan[Number(stepString)];
    return { path: '/v5/place/around', params: { key: config.webKey, keywords: query.keyword, location: positionParams(params), radius, types: '050000', sortrule: 'weight', show_fields: 'business', page_size: 20, page_num: 1, output: 'json' }, matchLevel: query.matchLevel };
  }
  if (pathname === '/api/places') {
    allowedParams(params, ['q']);
    const q = params.get('q')?.trim();
    if (!q || q.length > 80 || /[\x00-\x1f|]/.test(q)) throw new ApiError('BAD_REQUEST', 400);
    return { path: '/v5/place/text', params: { key: config.webKey, keywords: q, page_size: 20, page_num: 1, output: 'json' } };
  }
  if (pathname === '/api/reverse') {
    allowedParams(params, ['lng', 'lat']);
    return { path: '/v3/geocode/regeo', params: { key: config.webKey, location: positionParams(params), extensions: 'base', radius: 100, output: 'json' } };
  }
  throw new ApiError('NOT_FOUND', 404);
}
