# Pages 直连入口

当前入口：https://today-food-direct-check.pages.dev/。用户先在关闭代理、关闭 Wi-Fi、使用手机流量的测试要求下确认小测试页及后台检查成功；完整应用迁移后，再按关闭代理、使用手机流量、刷新并测试定位及“附近哪有”的要求验证，回复“都没问题了”。本次手机环境下的完整应用直连验收已通过。

## 请求路径

浏览器只访问 Pages 同源 `/api/*` 和 `/_AMapService/*`。Pages 的 `_worker.js` 通过内部服务绑定 `FOOD_API` 调用现有 `what-to-eat-today` Worker，保留原始 Request 的 URL、Origin 及客户端信息。浏览器不请求旧 `workers.dev` 地址。

高德凭据仍只保存在后台 Worker 的 Secret 中，Pages 不复制密钥。参数校验、固定上游、响应裁剪、每 IP 限流及总开关均复用后台实现。此方式解决访问入口问题，不改变高德账户费用规则，也不承诺所有网络永久可用。

`_routes.json` 只让两类 API 路径执行 Pages Function，HTML、CSS、JS 和图标直接由 Pages 静态资源提供。顶层 `404.html` 避免未知地址被当作单页应用首页；构建信息、服务器文件、环境文件不进入部署包。

## 构建与发布

```powershell
npm ci
npm run build:pages
npm test
```

构建目录为 `dist-pages/`，共 20 个白名单文件。脚本拒绝服务端凭据变量名和硬编码旧域名。首次发布前还需检查目录中不存在真实密钥值。

控制台方式（本次实际使用）：

1. 打开 `today-food-direct-check` Pages 项目。
2. Settings → Bindings 配置 Service binding：名称 `FOOD_API`，服务 `what-to-eat-today`，入口 Default。
3. Create deployment 选择 Production，上传 `dist-pages` 的内容（可压缩为 ZIP，但 ZIP 根目录必须直接包含 `index.html`、`_worker.js` 等文件）。
4. Save and deploy。绑定修改需新部署才能生效。

CLI 方式需要 Wrangler 已获 Pages 写入权限；原先仅有 Workers 脚本写入的授权不够：

```powershell
npx wrangler pages deploy dist-pages --config cloudflare/pages/wrangler.jsonc --project-name today-food-direct-check --branch main
```

后台更新仍使用根目录 `wrangler.jsonc` 部署 `what-to-eat-today`。仅提交 GitHub 不会自动更新本 Pages 项目。当前命令和控制台操作不购买套餐。

## 验收

- 关闭代理，使用手机流量打开正式 Pages 地址。
- 定位允许/拒绝与手动地点选择；随机抽取后点击“附近哪有”。
- API 配置、地点搜索、附近检索、逆地理编码及 SDK 转换都应使用 Pages 同源路径。
- PWA 在线安装后离线抽取；API 不缓存，门店不能作为离线实时结果。
- 验证导航链接可用，不把搜索中心当作实际出发位置。

官方依据：[Pages Service bindings](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings)、[Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)。
