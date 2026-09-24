import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const info = JSON.parse(await readFile(path.join(root, 'build-info.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.webmanifest'), 'utf8'));
assert.equal(manifest.start_url, '/');
const allowed = new Set(['index.html', 'sw.js', 'build-info.json', '_headers', '.assetsignore', ...info.files.filter(p => p !== '/').map(p => p.slice(1))]);
async function verify(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) { await verify(path.join(dir, entry.name), relative + '/'); continue; }
    assert.ok(allowed.has(relative), `非白名单构建文件：${relative}`);
    const buffer = await readFile(path.join(dir, entry.name));
    if (/\.(html|js|css)$/.test(relative)) {
      const text = buffer.toString('utf8');
      assert.ok(!/AMAP_SECURITY_JS_CODE|AMAP_WEB_SERVICE_KEY|TEST_WEB_SECRET|TEST_JS_SECRET|window\.resolveGeo/.test(text), `构建含服务器配置或测试注入：${relative}`);
      for (const key of ['AMAP_SECURITY_JS_CODE', 'AMAP_WEB_SERVICE_KEY']) if (process.env[key]) assert.ok(!text.includes(process.env[key]), '服务器凭据不得出现在构建中');
    }
  }
}
await verify(root);
for (const icon of manifest.icons) {
  const bytes = await readFile(path.join(root, icon.src.replace(/^\//, '')));
  const [width, height] = icon.sizes.split('x').map(Number);
  assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height);
}
for (const url of info.files) await readFile(path.join(root, url === '/' ? 'index.html' : url.slice(1)));
console.log(`构建校验通过：${info.files.length} 个缓存资源、图标尺寸、无服务端凭据或测试注入`);
