import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(root, 'dist');
if (path.dirname(out) !== path.resolve(root)) throw new Error('输出目录不在项目内');
const files = [['index.html', 'index.html']];
for (const f of await readdir(path.join(root, 'src'))) {
  if (/^[a-z-]+\.(js|css)$/.test(f)) files.push([`src/${f}`, `src/${f}`]);
}
for (const f of ['manifest.webmanifest', 'icon.svg', 'icons/icon-192.png', 'icons/icon-512.png']) files.push([`public/${f}`, f]);
const hash = createHash('sha256');
for (const [source, dest] of files) {
  const content = await readFile(path.join(root, source)); hash.update(dest).update(content);
  await mkdir(path.dirname(path.join(out, dest)), { recursive: true });
  await copyFile(path.join(root, source), path.join(out, dest));
}
const template = await readFile(path.join(root, 'scripts/sw-template.js'), 'utf8');
hash.update(template);
const version = hash.digest('hex').slice(0, 16);
const urls = ['/', ...files.filter(([, dest]) => dest !== 'index.html').map(([, dest]) => '/' + dest)];
const sw = template.replace('__CACHE_NAME__', `what-to-eat-${version}`).replace('__ASSET_URLS__', JSON.stringify(urls));
await writeFile(path.join(out, 'sw.js'), sw);
await writeFile(path.join(out, 'build-info.json'), JSON.stringify({ version, files: urls }, null, 2));
console.log(`生产构建完成：${files.length} 个静态文件；缓存版本 ${version}`);
