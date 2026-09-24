import { buildApiRequest } from '../server/api-request.js';
import { ApiError, buildSdkRequest, fetchAmap, sanitizePois } from '../server/upstream.js';
import { textValue } from '../src/ranking.js';

const routes = new Set(['/api/config', '/api/nearby', '/api/places', '/api/reverse', '/_AMapService/v3/assistant/coordinate/convert']);
const securityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
};
const json = (status, body, extra = {}) => Response.json(body, { status, headers: { ...securityHeaders, ...extra } });

// 通过参数注入上游仅用于测试；生产入口始终使用标准 fetch。
export async function handleRequest(request, env, { fetchImpl = fetch } = {}) {
  try {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/_AMapService/')) {
      if (!['GET', 'HEAD'].includes(request.method)) throw new ApiError('METHOD_NOT_ALLOWED', 405);
      return await env.ASSETS.fetch(request);
    }
    if (request.method !== 'GET') throw new ApiError('METHOD_NOT_ALLOWED', 405);
    if (request.url.length > 4096) throw new ApiError('BAD_REQUEST', 400);
    if (!routes.has(url.pathname)) throw new ApiError('NOT_FOUND', 404);
    const origin = request.headers.get('Origin'), referer = request.headers.get('Referer');
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || (origin && origin !== url.origin)) throw new ApiError('FORBIDDEN', 403);
    if (referer) {
      let refererOrigin;
      try { refererOrigin = new URL(referer).origin; } catch { throw new ApiError('BAD_REQUEST', 400); }
      if (refererOrigin !== url.origin) throw new ApiError('FORBIDDEN', 403);
    }
    const enabled = env.AMAP_ENABLED === 'true';
    const config = {
      jsKey: enabled ? env.AMAP_JS_KEY || '' : '',
      securityCode: enabled ? env.AMAP_SECURITY_JS_CODE || '' : '',
      webKey: enabled ? env.AMAP_WEB_SERVICE_KEY || '' : '',
      ratingScale: env.AMAP_RATING_SCALE === '5' ? 5 : null,
    };
    if (url.pathname === '/api/config') return json(200, {
      jsConfigured: !!(config.jsKey && config.securityCode),
      jsKey: config.jsKey && config.securityCode ? config.jsKey : '',
      webConfigured: !!config.webKey, pwaEnabled: true, amapEnabled: enabled,
    });
    if (!enabled) throw new ApiError('AMAP_DISABLED', 503);
    const sdk = url.pathname.startsWith('/_AMapService/');
    const spec = sdk ? buildSdkRequest(url, config) : buildApiRequest(url.pathname, url.searchParams, config);
    if (!sdk && !config.webKey) throw new ApiError('NOT_CONFIGURED', 503);
    // 平台限流绑定缺失或异常时停止请求，不能放开真实高德调用。
    if (!env.API_RATE_LIMITER) throw new ApiError('NOT_CONFIGURED', 503);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!(await env.API_RATE_LIMITER.limit({ key: ip })).success) throw new ApiError('RATE_LIMIT', 429);
    const data = await fetchAmap(spec.path, spec.params, { fetchImpl, signal: request.signal });
    if (sdk) {
      const body = JSON.stringify({ status: '1', info: 'OK', infocode: '10000', locations: textValue(data.locations, 100) }).replace(/</g, '\\u003c');
      return new Response(spec.callback ? `${spec.callback}(${body});` : body, { headers: {
        ...securityHeaders, 'Content-Type': spec.callback ? 'text/javascript; charset=utf-8' : 'application/json; charset=utf-8',
      } });
    }
    if (url.pathname === '/api/reverse') return json(200, { name: textValue(data.regeocode?.formatted_address, 100) });
    if (!Array.isArray(data.pois)) throw new ApiError('INVALID_RESPONSE', 502);
    return json(200, { pois: sanitizePois(data.pois), ...(spec.matchLevel ? { matchLevel: spec.matchLevel, ratingScale: config.ratingScale } : {}) });
  } catch (error) {
    // 不记录坐标、密钥、请求 URL 或上游响应。
    return json(error instanceof ApiError ? error.status : 500,
      { error: { code: error instanceof ApiError ? error.code : 'UPSTREAM' } },
      error?.code === 'RATE_LIMIT' ? { 'Retry-After': '60' } : {});
  }
}

export default { fetch: (request, env) => handleRequest(request, env) };
