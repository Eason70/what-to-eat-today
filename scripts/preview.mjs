import { createAppServer, readConfig } from '../server/index.js';
const origin = 'http://127.0.0.1:4174';
createAppServer({ config: { ...readConfig(), origin }, production: true }).listen(4174, '127.0.0.1', () => console.log(`Local: ${origin}`));
