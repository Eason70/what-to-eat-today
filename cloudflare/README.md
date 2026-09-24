# Cloudflare 部署

当前面向手机的入口已迁至 [Pages](https://today-food-direct-check.pages.dev/)，通过内部绑定复用本文的 Worker 后台；发布 Pages 页面请看 [Pages 部署说明](pages/README.md)。旧 `workers.dev` 地址在用户手机网络下需要代理，本文的 Worker 仍承担后台接口。

同一个 Worker 提供完整前端和同源接口，使用 Cloudflare 的 workers.dev 地址。无需购买服务器或域名；部署到现有 Free 计划，不主动升级套餐。平台免费配额和高德计费相互独立。

## 发布

在项目根目录执行：

```powershell
npm ci
npx wrangler login --scopes account:read user:read workers_scripts:write
npm run build
npm run check:build
npx wrangler deploy --dry-run
npm run deploy:cloudflare
```

默认名称是 `what-to-eat-today`，实际地址以部署输出为准。先用手机移动网络访问，再测试具体功能；同一平台的测试页能打开并不代表正式站点已完成验收。

本地 Worker 预览使用 `npm run dev:cloudflare`。`npm run types:cloudflare` 生成本机类型文件，不提交版本库。原有 Node.js 启动和测试方式继续可用。

## 地图开关与凭据

本站已获所有者授权，将 `wrangler.jsonc` 的 `AMAP_ENABLED` 设置为字符串 `"true"` 并配置 Cloudflare Secret。公开地图调用会消耗所有者的高德额度。复制本仓库建立自己的站点时，应先改为 `"false"`，完成费用及权限核实后再启用。

设置为 `"false"` 时随机餐食和 PWA 仍可用，地图接口返回 `AMAP_DISABLED`，不加载高德脚本，也不向高德发送请求。需要停用地图时，将该值改回 `"false"` 并重新部署。

只有确认高德账户接口权限、剩余额度及可接受费用后，才执行以下步骤：

1. 在 Cloudflare Worker 的 Settings → Variables and Secrets 添加三个 Secret：`AMAP_JS_KEY`、`AMAP_SECURITY_JS_CODE`、`AMAP_WEB_SERVICE_KEY`。也可以逐个执行 `npx wrangler secret put 变量名`，在交互输入处填写值。不要将值写入命令行、仓库、构建变量或日志。
2. 高德 Web端 Key 的域名白名单加入实际 Worker 域名；Web服务 Key 的限制需与云端运行环境匹配。Cloudflare Workers 没有专属固定出口 IP，不应假定本机 IP 白名单能够沿用。
3. 将 `wrangler.jsonc` 的 `AMAP_ENABLED` 改为 `"true"`，重新部署。在高德账户侧设置可用的额度限制和告警。
4. 用手机验证允许/拒绝定位、手动地点、附近查店、导航跳转。页面随机餐食不依赖地图成功。

`AMAP_JS_KEY` 是浏览器公开 Key，启用后通过 `/api/config` 返回；另外两个密钥只在后台使用。关闭开关时连公开 Key 也不返回。评分量纲未核实，保持 `AMAP_RATING_SCALE` 不设置。

**每 IP 每分钟 20 次限流按 Cloudflare 节点分别计算，不是全局每日配额，也不是费用封顶。** 不应以此承诺高德免费。要求完全不产生高德调用费用时，保持开关关闭。

## 安全与更新

- Worker 复用 Node 后台的参数校验、固定高德上游、响应裁剪和超时限制；静态资源来自 `dist` 白名单构建。
- 构建的 `_headers` 设置 CSP 等响应头；API 单独设置禁止缓存响应头，API 与位置查询不进入 PWA 缓存。
- `observability.enabled=false`：避免自动请求日志持久保存含坐标的 URL；后台也不打印请求内容或原始上游错误。如需诊断，应先制定日志脱敏方式。
- `.env`、`.dev.vars`、`.wrangler`、构建与测试输出均不提交。`dist/build-info.json` 由 `.assetsignore` 排除，不对外上传。
- 更新 PWA 后需关闭旧页面再打开，让新缓存整体生效；正式上线前保留旧版本以便在 Cloudflare 控制台回退。

## 官方资料

- [静态资源与 Worker 路由](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [限流绑定的范围与限制](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [平台计费](https://developers.cloudflare.com/workers/platform/pricing/)
- [Secret 配置](https://developers.cloudflare.com/workers/configuration/secrets/)
