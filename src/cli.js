import { readFile } from 'node:fs/promises';
import { startWatching } from './butler.js';

try {
  const input = JSON.parse(await readFile(process.argv[2] ?? new URL('../config.json', import.meta.url), 'utf8'));
  const butler = await startWatching(input, event => console.log(JSON.stringify(event)));
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try { await butler.stop(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (error) {
  console.error(`启动失败：${error.message}`);
  process.exitCode = 1;
}
