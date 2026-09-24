const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

// 浏览器只请求 Pages 同源路径；后台通过 Cloudflare 内部服务绑定调用。
export default {
  async fetch(request, env) {
    try {
      const { pathname } = new URL(request.url);
      if (pathname.startsWith('/api/') || pathname.startsWith('/_AMapService/')) {
        if (!env.FOOD_API) return Response.json({ error: { code: 'NOT_CONFIGURED' } }, { status: 503, headers });
        return await env.FOOD_API.fetch(request);
      }
      return await env.ASSETS.fetch(request);
    } catch {
      return Response.json({ error: { code: 'NETWORK' } }, { status: 502, headers });
    }
  },
};
