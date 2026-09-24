const CACHE = '__CACHE_NAME__';
const ASSETS = __ASSET_URLS__;
const allowed = new Set(ASSETS);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try { const cache = await caches.open(CACHE); await cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))); }
    catch (error) { await caches.delete(CACHE); throw error; }
    // 不 skipWaiting：旧页面和新资源不混用，所有旧页面关闭后整体切换。
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('what-to-eat-') && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // 高德脚本、API、位置、查询参数和密钥 URL 永不进入持久缓存。
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search || !allowed.has(url.pathname)) return;
  event.respondWith((async () => (await (await caches.open(CACHE)).match(url.pathname)) || fetch(event.request))());
});
