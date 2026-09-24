import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isIP } from 'node:net';
import { textValue } from '../src/ranking.js';
import { buildApiRequest } from './api-request.js';
export { buildApiRequest } from './api-request.js';
import { fetchAmap, ApiError, buildSdkRequest, sanitizePois } from './upstream.js';
import { createLimiter } from './limits.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
export function readConfig(env = process.env) {
  return { jsKey: env.AMAP_JS_KEY || '', securityCode: env.AMAP_SECURITY_JS_CODE || '', webKey: env.AMAP_WEB_SERVICE_KEY || '',
    ratingScale: env.AMAP_RATING_SCALE === '5' ? 5 : null, origin: env.PUBLIC_ORIGIN || '', trustProxy: env.TRUST_PROXY === 'true' };
}
export function createAppServer({ config = readConfig(), production = false, fetchImpl = fetch, limiter = createLimiter(), root = projectRoot, upstreamTimeout = 8000 } = {}) {
  if (production) {
    let origin;
    try { origin = new URL(config.origin); } catch { throw new Error('生产环境必须设置 PUBLIC_ORIGIN 为 HTTPS 源地址'); }
    const localPreview = origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (origin.origin !== config.origin || (origin.protocol !== 'https:' && !localPreview)) throw new Error('生产环境必须使用 HTTPS；仅回环地址允许 HTTP 构建预览');
  }
  const staticRoot = production ? path.join(root, 'dist') : root;
  return createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    // 真实 JS API 2.0 会动态执行代码并从 jsapi-service 加载插件；仍禁止任意域名与内联脚本。
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-eval' https://webapi.amap.com https://jsapi-service.amap.com; connect-src 'self' https://*.amap.com; img-src 'self' data: https://*.amap.com; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
    const json = (status, value) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); } };
    try {
      if (!['GET', 'HEAD'].includes(req.method)) throw new ApiError('METHOD_NOT_ALLOWED', 405);
      if (!req.url || req.url.length > 4096) throw new ApiError('BAD_REQUEST', 400);
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_AMapService/')) {
        if (req.method !== 'GET') throw new ApiError('METHOD_NOT_ALLOWED', 405);
        const origin = config.origin || `http://${req.headers.host}`;
        if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== origin)) throw new ApiError('FORBIDDEN', 403);
        if (req.headers.referer && new URL(req.headers.referer).origin !== origin) throw new ApiError('FORBIDDEN', 403);
        if (url.pathname === '/api/config') {
          json(200, { jsConfigured: !!(config.jsKey && config.securityCode), jsKey: config.jsKey && config.securityCode ? config.jsKey : '', webConfigured: !!config.webKey, pwaEnabled: production }); return;
        }
        let ip = req.socket.remoteAddress || 'unknown';
        if (config.trustProxy && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
          const forwarded = req.headers['x-forwarded-for'];
          if (typeof forwarded === 'string' && isIP(forwarded)) ip = forwarded;
        }
        if (!limiter.allow(ip)) { res.setHeader('Retry-After', '60'); throw new ApiError('RATE_LIMIT', 429); }
        const controller = new AbortController();
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        if (url.pathname.startsWith('/_AMapService/')) {
          const spec = buildSdkRequest(url, config);
          const data = await fetchAmap(spec.path, spec.params, { fetchImpl, signal: controller.signal, timeout: upstreamTimeout });
          const safe = { status: '1', info: 'OK', infocode: '10000', locations: textValue(data.locations, 100) };
          const body = JSON.stringify(safe).replace(/</g, '\\u003c');
          res.writeHead(200, { 'Content-Type': spec.callback ? 'text/javascript; charset=utf-8' : 'application/json; charset=utf-8' });
          res.end(spec.callback ? `${spec.callback}(${body});` : body); return;
        }
        const spec = buildApiRequest(url.pathname, url.searchParams, config);
        if (!config.webKey) throw new ApiError('NOT_CONFIGURED', 503);
        const data = await fetchAmap(spec.path, spec.params, { fetchImpl, signal: controller.signal, timeout: upstreamTimeout });
        if (url.pathname === '/api/reverse') { json(200, { name: textValue(data.regeocode?.formatted_address, 100) }); return; }
        if (!Array.isArray(data.pois)) throw new ApiError('INVALID_RESPONSE', 502);
        json(200, { pois: sanitizePois(data.pois), ...(spec.matchLevel ? { matchLevel: spec.matchLevel, ratingScale: config.ratingScale } : {}) }); return;
      }
      const pathname = decodeURIComponent(url.pathname);
      let relative;
      if (pathname === '/') relative = 'index.html';
      else if (/^\/src\/[a-z-]+\.(js|css)$/.test(pathname)) relative = pathname.slice(1);
      else if (/^\/(icon\.svg|manifest\.webmanifest|icons\/icon-(192|512)\.png|sw\.js)$/.test(pathname)) relative = production ? pathname.slice(1) : `public${pathname}`;
      else throw new ApiError('NOT_FOUND', 404);
      const data = await readFile(path.join(staticRoot, relative)).catch(() => { throw new ApiError('NOT_FOUND', 404); });
      res.setHeader('Cache-Control', 'no-cache');
      if (pathname === '/sw.js') res.setHeader('Service-Worker-Allowed', '/');
      res.writeHead(200, { 'Content-Type': mime[path.extname(relative)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      // 仅固定错误码返回前端；不记录查询 URL、坐标、凭据或第三方响应。
      json(error instanceof ApiError ? error.status : 500, { error: { code: error instanceof ApiError ? error.code : 'UPSTREAM' } });
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173), host = process.env.HOST || '127.0.0.1';
  const server = createAppServer({ production: process.argv.includes('--production') });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.listen(port, host, () => console.log(`Local: http://${host}:${port}`));
}
