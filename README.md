# 今天吃什么

一个手机优先的中文网页工具：先随机一个具体餐食，再按选定的直线半径查找高德相关门店。原生 HTML/CSS/JavaScript，Node.js 同源代理，无框架、数据库、账号或运行时 npm 依赖。

**本仓库包含完整前端、Node.js 安全代理、PWA、自动化测试与部署样例。** 支持随机餐食、自动定位、手动地点搜索、附近门店查询和导航跳转。真实高德凭据不包含在仓库中，使用地图功能前需自行配置。门店模拟响应只存在于 `tests/`，生产没有演示模式或假门店兜底。

## 部署状态

项目页面及后台接口已部署到 [Cloudflare 站点](https://what-to-eat-today.liu1214550793.workers.dev/)。经站点所有者确认可消耗高德额度及承担账户规则下的调用费用，已启用定位、地点搜索和附近查店。三个高德凭据保存为 Cloudflare Secret，未包含在公开源码中；没有购买套餐或充值。所有访客的高德调用均使用站点所有者的额度。

2026-09-24：用户已确认正式页面在手机上能打开并正常随机抽取。启用地图后，正式云端的地点搜索、附近查店、逆地理编码及 SDK 坐标转换已通过真实接口验证；手机实际 GPS 定位及导航仍需真机验收。此前开发电脑的 TLS 握手问题在本次验证中未复现，不代表所有网络始终可用。详见 [Cloudflare 验证记录](cloudflare/VALIDATION.md)。

完整功能需要静态资源和后台接口。本仓库提供 Node.js 和 Cloudflare Workers 两种后台部署方式；Workers 可同时托管页面和接口，无需自购服务器。地图功能仍需配置高德凭据及域名白名单。GitHub Pages 只能承载静态部分。Cloudflare 的操作与费用开关见 [部署说明](cloudflare/README.md)。

此前独立的随机简化版、托管试验文件和导出文件不在本仓库内。以下说明均针对完整版。

## 本地启动

要求 Node.js ≥ 22.12（本次实测 24.12.0）、npm。用 HTTP 服务打开，不能双击 HTML。

在 PowerShell 中：

```powershell
git clone https://github.com/Eason70/what-to-eat-today.git
Set-Location 'what-to-eat-today'
npm ci
npm run dev
```

打开终端打印的 [本地应用](http://127.0.0.1:4173)。没有 `.env` 时出现 `.env not found. Continuing without it.` 是正常提示；随机功能仍可使用。此端口的开发模式不注册新的 service worker，避免修改源文件时被缓存遮蔽。

生产构建及本机构建预览：

```powershell
npm run build
npm run check:build
npm run preview
```

预览地址为 [构建预览](http://127.0.0.1:4174)，启用 PWA。`localhost` / 回环地址属于浏览器支持的开发安全上下文；手机通过局域网 IP 访问普通 HTTP 并不等价，完整定位/PWA 应使用正式 HTTPS。源码修改后需重新 `npm run build` 才影响此预览。

测试：

```powershell
npx playwright install chromium
npm test
npm run build
npm run check:build
npm run test:e2e
```

也可以执行 `npm run test:all`。浏览器测试在 4174 端口启动独立构建预览，强制空凭据，不读取本地 `.env`，不复用已运行的服务；请保证该端口未被占用。浏览器报告在 `playwright-report/index.html`，屏幕截图在 `test-results/`；见 [实际测试记录](TEST_REPORT.md)。

## 高德凭据配置

在新环境中，仅在没有 `.env` 的情况下复制模板，填写自己的 Web端 Key、安全密钥与 Web服务 Key 后重启 Node 服务。`.env` 已被 Git 排除，仓库仅保留空值示例。不要把真实值放入源码、README、聊天记录或前端构建变量。

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

| 环境变量 | 用途 |
| --- | --- |
| `AMAP_JS_KEY` | Web端（JS API）Key，浏览器必须可见；在高德控制台限定实际域名，并按平台要求设置开发域名 |
| `AMAP_SECURITY_JS_CODE` | 与 JS Key 对应的安全密钥；仅服务端使用 |
| `AMAP_WEB_SERVICE_KEY` | 单独申请的 Web服务 Key，用于 POI 2.0 和逆地理编码；仅服务端使用，按控制台支持项限制服务器出口 IP |
| `AMAP_RATING_SCALE` | 默认留空。官方 POI 2.0 当前公开表列出评分字段但没有明确量纲；取得账户接口/高德的 5 分制依据后才能填 `5` |
| `PUBLIC_ORIGIN` | 正式站点的 HTTPS 源地址，如 `https://eat.example.com`，不带路径和末尾斜杠 |
| `HOST` / `PORT` | 默认 `127.0.0.1` / `4173`，供同机 HTTPS 反向代理访问 |
| `TRUST_PROXY` | 默认 `false`；仅部署了下文同机 Caddy 配置、且外部无法直连 Node 时设为 `true` |

请在高德控制台确认：两类 Key 的平台正确、POI 2.0/关键字搜索/逆地理编码的权限有效、域名/IP 白名单匹配、调用额度及费用可接受。项目不申请凭据、不购买配额，也不承诺接口长期免费。

只配置 Web服务 Key 时，可以手动搜索地点并查店；JS Key 和安全密钥配齐后才能自动定位。`/api/config` 只返回公开 JS Key 和配置状态，不把服务端密钥传给浏览器。

## 实现与默认值

### 随机与页面

固定 56 个日常食物、8 个特别食物。每次独立先选池（95% / 5%），再在池内等概率选一项；没有历史、去重、保底或隐式加权。分类不参与概率。全部 64 项包含稳定 ID 和最多 3 步搜索映射。

结果在点击时一次确定，840ms 的文字动画只用于展示；减少动态效果时立即展示。动画不调用随机源；快速连点不会排队。屏幕阅读器的 live region 只更新最终结果。首页不显示候选池、隐藏分类或额外筛选。

首次半径 1km，支持 500m / 1km / 3km / 5km；距离只影响查店。结果展开前改条件不查店；展开后改条件重新查询同一道食物。重抽取消搜索并清空旧列表。

### 位置与隐私

自动定位通过 JS API 2.0 `AMap.Geolocation`，设置 `convert: true`、10 秒定位超时、不接受 SDK 的未转换坐标。所有传给 Web API 和导航的坐标均按 **GCJ-02，经度在前、纬度在后** 使用，不直接调用原生 GPS 后混用。

当前 SDK 实测可能返回 `location_type: html5`，坐标已转换但 `isConverted: false`。适配层仅在 `info: SUCCESS` 且消息明确以 `.Convert Success.` 结尾时兼容此格式；已核对返回坐标与真实代理转换结果一致，不重复转换。失败、缺少成功信息或非 html5 来源不能用此兼容分支通过。

为避免用城市/IP 位置冒充精准位置，关闭 IP 自动定位和定位失败的城市兜底。桌面或无可用 GPS 的设备可能需要手动选点。如果收到 IP、未知精度或精度大于所选半径一半的结果，必须确认这个点作为搜索圆心；确认不表示提升了定位精度。手动和确认位置均标为“搜索中心”。

页面加载最多自动尝试一次。支持 Permissions API 的浏览器如果已明确拒绝，则不再次调用定位插件；重试由用户点击触发。没有 Permissions API 时，只进行当前页面的一次尝试，权限提示仍由浏览器控制。

可靠坐标和地址解析分开处理；地址失败显示“当前位置”。自动定位和逆编码都带序号，用户手动选择后晚到响应不会覆盖它。自动定位失败时保留缓存中心，并显著显示“使用上次位置”和保存时间。无缓存不设置默认城市。地点搜索为全国检索，建议输入城市，候选显示可用的省/市/区/地址，必须点选有坐标的结果才生效。

localStorage 只有一个设置键 `what-to-eat-settings-v1`，保存半径和最后可用中心（坐标、名称、来源、时间，以及判断可靠性所需的精度标记）。无权限或损坏时退回内存。**本地保存设置不等于位置不离开设备**：定位、逆编码、查店会把必要信息发送给高德；Node 服务也会接收查询中心。应用不主动记录坐标、Key、行为历史或访问日志。

### POI 搜索、排序和导航

浏览器每次只发送 `foodId`、计划步数、中心和半径。服务器从共享食物表决定关键词，强制餐饮类型、综合排序、商业字段、第一页、每次最多 20 条。有效候选少于 3 家才进入下一步，最多 3 步；成功结束可能只有 0、1、2 家，不补假数据。

按 POI ID 去重并合并有效字段；同名不同分店保留。丢弃无可导航坐标、非餐饮和坐标复核超出半径的记录。没有行政区截断。specific 先于 related，related 标记“同类备选，具体菜品需确认”。关键词来源不是菜单核验。

同层级排序权重集中于 `src/ranking.js`：评分 0.55、距离 0.35、上游顺序 0.10。仅在确认 5 分制时接受大于 0 且不超过 5 的有效评分；0、空、数组和坏值不作低分展示。缺评分的内部基准使用同层有效评分中位数，不把补值展示出来。全层无评分或量纲未确认时，所有店统一关闭评分权重，重归一化距离和顺序项。最后按距离和稳定 ID 打破平局，最多展示 6 家。

零结果与服务失败分开处理。成功零结果才提供逐档扩大，5km 止；出错不扩大、不无限重试。后续查询失败可保留已有部分结果并提示。请求有浏览器取消、服务器取消、超时及版本保护。

“去这里”使用官方 `https://uri.amap.com/marker`，只传准确目的地和 `coordinate=gaode`，`callnative=1` 尝试打开 App；同卡片的“高德网页版”使用 `callnative=0`。进入高德目的地页后确认实际起点和出行方式，不把手动中心或缓存中心当作出发点，不指定步行/驾车，不预先弹窗。App、微信内置浏览器、不同系统的实际跳转表现尚未进行真机验证。

### 安全代理

运行时没有通用 URL 转发接口，只允许固定 `https://restapi.amap.com` 下的必要路径。自有接口为 `/api/nearby`、`/api/places`、`/api/reverse`。JS 安全代理使用官方固定前缀 `/_AMapService`；本应用关闭 IP 定位、单独做逆编码，所以 JS 代理仅开放 `v3/assistant/coordinate/convert` 单坐标转换。服务端注入 JS 安全密钥；过滤 JSONP 回调并从 JSON 重新生成响应，不原样透传上游脚本。未来 SDK 新增必要路径应经真实联调后逐项补充，不能放开通配代理。

真实联调补齐了 SDK 平台标记 `s=rsv3`、`platform=JS`、`logversion=2.0`，避免 Web端 Key 被按 Web服务 Key 校验。CSP 为当前 SDK 的动态执行允许 `unsafe-eval`，脚本域名限定为本站、`webapi.amap.com` 和 `jsapi-service.amap.com`；仍不允许内联脚本。可选的 SDK 日志路径不开放，当前定位链路已验证不依赖它。

校验坐标、四档半径、稳定食物 ID、计划步数、关键词长度和重复参数。上游 8 秒超时、响应体 1MB 上限、不跟随重定向。接口不允许跨站调用，不记录原始上游错误，前端以文本节点渲染第三方文字。CSP、Referrer Policy、禁止页面嵌入和外链 `noopener noreferrer` 已设置。

Node.js 单进程限流默认每 IP 每分钟 90 次、全站每分钟 300 次、每天 5000 次，窗口按服务器时间切分，均集中在 `server/limits.js`。计数仅在内存中，重启重置；多进程不共享配额。Cloudflare 版本使用平台限流绑定，每 IP 每分钟 20 次、各服务节点分别计数，没有全站每日上限。这两种限流均不能作为费用封顶保证，应同时使用高德账户的配额和告警。不可将请求来源检查当作身份认证；本应用无账号或访问隔离，拿到公网链接的人可能访问。

## PWA 与缓存更新

提供 manifest、192/512px PNG 图标及 service worker。首次在线成功缓存后可离线重开和抽食物；首次从未加载过的离线设备不能保证打开。查店离线时显示联网提示，并移除内存里已经展开的旧门店，避免当作实时结果。

构建仅复制静态白名单，按全部前端内容和 worker 模板计算缓存版本。worker 只缓存应用自身文件和食物数据；不缓存高德脚本、API、带查询参数的 URL、位置或门店列表。安装失败不激活半套资源；没有 `skipWaiting`，所有旧页面关闭后新版本整体激活并清理旧应用缓存，不清理其他应用缓存。

更新部署后，先让浏览器在线打开一次获得新 worker，再关闭该站点所有标签和独立 PWA 窗口，重新打开；这可避免新代码配旧数据。需要立即验证新构建时，使用独立浏览器上下文，或在自己的开发工具中清理该站点应用缓存。

手机添加主屏幕：正式 HTTPS 页面在线访问一次；Android 浏览器若支持，使用浏览器菜单“安装应用/添加到主屏幕”；iOS Safari 通常从分享菜单“添加到主屏幕”。菜单名称和支持情况取决于系统/浏览器，没有强制安装弹窗，也没有所有平台一致的承诺。

## 一种生产部署方式：国内单机 Node + Caddy HTTPS

文档以**已有或自行选择的中国内地 Ubuntu 云服务器**为部署目标，使用 Node 单进程和同机 Caddy。已核对阿里云轻量服务器的内地网站备案与地域说明；不绑定其 SDK，不依赖境外免费托管的可达性。当前只完成本地凭据配置，没有你的云资源、域名或备案信息，因此没有执行购买、开户、备案、部署或费用承诺。

1. 自行确认服务器、域名与对外网站所需备案条件，确认预算和高德权限。安装 Node ≥ 22.12 与 Caddy 2，检查 `node --version` 及 `command -v node`。服务器安装步骤以各自官方发行说明为准。
2. 将项目上传到 `/opt/what-to-eat`，保留 `package.json`、锁文件、`server/`、`src/`、`scripts/`、`public/` 和 `index.html`。不要上传开发机的 `.env` 或 `node_modules/`。生产无 npm 运行时依赖，可执行 `npm ci --omit=dev`、`npm run build`、`npm run check:build`。先运行测试的机器需完整 `npm ci`。
3. 在服务器创建专用的 `whattoeat` 系统用户，令其能读取项目。根据 `.env.example` 建立 `.env`，填写真实凭据、`PUBLIC_ORIGIN=https://你的实际域名`、`HOST=127.0.0.1`、`PORT=4173`、`TRUST_PROXY=true`。文件权限设为仅所需用户可读，避免把配置输出到日志。
4. 按 [systemd 样例](server/what-to-eat.service.example) 建立 `/etc/systemd/system/what-to-eat.service`，将 `ExecStart` 中 Node 路径改成第 1 步实际位置，核对用户、项目目录。执行 `sudo systemctl daemon-reload` 和 `sudo systemctl enable --now what-to-eat`。也可先在项目目录运行 `npm start` 检查启动；不要同时占用同一个端口。
5. 按 [Caddy 样例](server/Caddyfile.example) 替换实际域名。Caddy 覆盖客户端传入的 `X-Forwarded-For`，且 Node 只监听本机；此组合下才能信任转发 IP。项目没有 CDN 前置链的配置，不要直接照搬到多级代理。保持访问日志关闭，避免记录查询坐标。
6. DNS 指向服务器，开放 HTTPS/证书签发所需的 80、443 端口，公网不开放 4173。执行 `sudo caddy validate --config /etc/caddy/Caddyfile`，成功后 `sudo systemctl reload caddy`。Caddy 对配置的公网域名自动申请/更新证书，仍需 DNS、端口和证书签发条件满足。
7. 在高德控制台添加真实域名与服务器限制，使用手机通过实际 HTTPS 域名完成下面的联调验收；确认后再分享链接。

更新时在单独发布目录完成构建和校验，再替换运行版本、重启 Node；不要在有用户访问时逐个覆盖正在提供的静态文件。保留上一版本便于回退，并遵循上面的 PWA 更新步骤。

## 已完成的本地联调与后续真机验收

- 已使用真实 Key 验证 JS API 加载、serviceHost 坐标转换和 CSP 兼容性；无脚本异常或 CSP 违规。输入为独立浏览器上下文中的模拟 GPS，未读取或保存用户实际位置。
- 已用公开地标验证地点搜索（20 个候选）、周边 1km 重庆小面搜索（4 家相关候选）和逆编码；请求均经过本地代理调用真实高德接口。门店数随上游数据变化，不代表具体菜品或营业情况已人工核验。
- 在手机分别允许、拒绝、关闭 GPS、模拟弱网/超时；确认缓存来源、粗略定位提示和手动选点可用。
- 继续核验业务评分量纲、营业时间、不同地区与餐食的关键词召回。评分量纲尚未确认，保持评分关闭。
- iOS Safari、Android Chrome、高德已装/未装、微信内置浏览器中的地图打开与网页兜底；手动中心不应成为导航起点。
- 真机软键盘、安全区、屏幕阅读器播报、PWA 安装/升级与离线；目前已做 Chromium 的视口、键盘焦点、减少动画与视口缩小模拟。
- 正式域名的 TLS、反向代理、域名白名单、出口 IP、账户限额、部署地区访问效果；本次未在云服务器实际运行 systemd/Caddy。

## 文件结构

```text
index.html                 单页语义化结构
src/food-data.js            64 项固定数据与逐项检索计划
src/random.js              可注入随机源的纯抽取逻辑
src/storage.js             最小本地设置与异常恢复
src/ranking.js             POI 清洗、距离、去重和排序
src/amap-service.js        定位、地点搜索、查店、导航适配
src/controller.js          状态、请求取消和异步版本保护
src/place-search.js        地点输入防抖与过期响应防护
src/app.js / styles.css    页面事件、安全文本渲染与布局
server/                    固定上游代理、限流、部署配置样例
scripts/                   构建、构建校验、缓存模板与预览
public/                    manifest 与应用图标
tests/                     单元、HTTP 代理与浏览器测试
dist/                      npm run build 生成的静态资源（不包含服务器）
```

## 官方资料与核对时间

核对日期：2026-09-24。接入方式与参数依据以下一手文档；权限、费用和接口行为以实施账户为准。

- [高德搜索 POI 2.0](https://lbs.amap.com/api/webservice/guide/api-advanced/newpoisearch)
- [JS API 快速上手](https://lbs.amap.com/api/javascript-api-v2/getting-started)、[安全密钥和 serviceHost](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)
- [高德定位指南](https://lbs.amap.com/api/javascript-api-v2/guide/services/geolocation)、[Geolocation 参考手册](https://a.amap.com/jsapi/static/doc/20230922/index.html#amapgeolocation)
- [Web 服务错误码](https://lbs.amap.com/api/webservice/guide/tools/info)
- [官方单点 URI](https://lbs.amap.com/api/uri-api/guide/mobile-web/point)。需求给出的[路径规划页](https://lbs.amap.com/api/uri-api/guide/travel/route)本次读取超时；实现采用已核对的目的地页面方案，由用户确认路线。
- [MDN 定位 API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API)、[PWA 安装条件](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [Caddy HTTPS 与反向代理](https://caddyserver.com/docs/quick-starts/reverse-proxy)、[转发头规则](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [阿里云轻量服务器使用须知](https://help.aliyun.com/zh/simple-application-server/product-overview/usage-notes)、[地域与网络说明](https://help.aliyun.com/zh/simple-application-server/product-overview/regions-and-network-connectivity)
