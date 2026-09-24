import { createAppServer, readConfig } from '../server/index.js';
// 自动化测试永不加载开发者 .env，也不复用可能含真实凭据的预览进程。
const config = { ...readConfig({}), origin: 'http://127.0.0.1:4174' };
createAppServer({ config, production: true }).listen(4174, '127.0.0.1');
