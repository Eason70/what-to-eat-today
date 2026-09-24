import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist-pages');
const info = JSON.parse(await readFile(path.join(root, 'dist/build-info.json'), 'utf8'));
const staticFiles = [...new Set(['index.html', 'sw.js', '_headers', ...info.files.filter(p => p !== '/').map(p => p.slice(1))])];
const allowed = new Set([...staticFiles, '_worker.js', '_routes.json', '404.html']);
for (const file of staticFiles) {
  assert.ok(!file.includes('..') && !path.isAbsolute(file));
  await mkdir(path.dirname(path.join(out, file)), { recursive: true });
  await copyFile(path.join(root, 'dist', file), path.join(out, file));
}
await copyFile(path.join(root, 'cloudflare/pages/worker.js'), path.join(out, '_worker.js'));
await writeFile(path.join(out, '_routes.json'), JSON.stringify({ version: 1, include: ['/api/*', '/_AMapService/*'], exclude: [] }, null, 2));
await writeFile(path.join(out, '404.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>页面不存在</title><h1>页面不存在</h1><a href="/">返回今天吃什么</a></html>');
// 拒绝旧文件或敏感内容混入上传包；不读取或复制本地 .env。
let count = 0;
async function check(dir, prefix = '') {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix + item.name;
    if (item.isDirectory()) { await check(path.join(dir, item.name), relative + '/'); continue; }
    assert.ok(allowed.has(relative), `Pages 构建存在非白名单文件：${relative}`);
    const content = await readFile(path.join(dir, item.name), 'utf8');
    assert.ok(!/AMAP_SECURITY_JS_CODE|AMAP_WEB_SERVICE_KEY|\.workers\.dev/.test(content), `Pages 构建不能包含服务端凭据或直连旧域名：${relative}`);
    count++;
  }
}
await check(out);
assert.equal(count, allowed.size);
console.log(`Pages 构建与白名单校验通过：${count} 个文件，接口通过 FOOD_API 内部绑定调用。`);
