import http from 'node:http';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { normalizeConfig, startWatching } from './butler.js';
import { DEFAULT_RULES, parseRules, scanScreenshots, copyEntry } from './batch.js';

const run = promisify(execFile);
export async function createDashboard({ configFile = new URL('../dashboard.config.json', import.meta.url), initialConfig } = {}) {
  let saved;
  try { saved = JSON.parse(await readFile(configFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let config = normalizeConfig(initialConfig ?? saved?.config ?? JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8')));
  // 面板版始终保留原图，避免后台监听意外删除文件。
  config.keepOriginal = true;
  let rules = saved?.rules ?? DEFAULT_RULES;
  parseRules(rules);
  let watcher, plan, busy = false, revision = 0;
  const logs = [];
  const activity = event => {
    logs.unshift({ ...event, id: ++revision, time: new Date().toISOString() });
    logs.splice(100);
  };
  const state = () => ({ config, rules, watching: !!watcher, busy, logs,
    plan: plan ? { id: plan.id, entries: plan.entries.map((entry, index) => ({ index, name: entry.relative.split('/').at(-1), relative: entry.relative })) } : null });
  const server = http.createServer(async (req, res) => {
    const origin = `http://${req.headers.host}`;
    const expectedHost = `127.0.0.1:${server.address().port}`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'");
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      if (req.headers.host !== expectedHost || (req.headers.origin && req.headers.origin !== origin)) return json(403, { error: '仅允许本地面板访问' });
      const url = new URL(req.url, origin);
      if (req.method === 'GET') {
        if (url.pathname === '/api/state') return json(200, state());
        if (url.pathname === '/api/thumbnail') {
          const index = Number(url.searchParams.get('index'));
          const logId = Number(url.searchParams.get('log'));
          const source = logId ? logs.find(log => log.id === logId)?.destination :
            url.searchParams.get('plan') === String(plan?.id) && Number.isInteger(index) ? plan?.entries[index]?.source : null;
          if (!source) return json(404, { error: '图片不存在或预览已失效' });
          const image = await sharp(source).resize(160, 100, { fit: 'inside', withoutEnlargement: true }).jpeg().toBuffer();
          res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(image);
        }
        const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
        const file = files[url.pathname];
        if (!file) return json(404, { error: '不存在' });
        res.writeHead(200, { 'Content-Type': file[1] });
        return res.end(await readFile(new URL(`../public/${file[0]}`, import.meta.url)));
      }
      if (req.method !== 'POST') return json(405, { error: '不支持的方法' });
      if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') return json(403, { error: '请求来源无效' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 65536) throw new Error('请求过大'); }
      const input = JSON.parse(body || '{}');
      if (busy) return json(409, { error: '任务进行中，请稍后' });
      busy = true;
      try {
        if (url.pathname === '/api/config') {
          if (watcher) throw new Error('请先停止监听再修改配置');
          const next = normalizeConfig({ ...input.config, keepOriginal: true });
          parseRules(input.rules);
          await writeFile(`${fileURLToPathIfNeeded(configFile)}.tmp`, JSON.stringify({ config: next, rules: input.rules }, null, 2), { mode: 0o600 });
          await rename(`${fileURLToPathIfNeeded(configFile)}.tmp`, configFile);
          config = next; rules = input.rules; plan = null;
        } else if (url.pathname === '/api/scan') {
          if (watcher) throw new Error('请先停止监听再批量扫描');
          plan = null;
          plan = { ...await scanScreenshots(config, rules), id: ++revision };
        } else if (url.pathname === '/api/copy') {
          if (watcher || !plan || input.id !== plan.id) throw new Error('预览已失效，请重新扫描');
          const current = plan; plan = null;
          for (const entry of current.entries) {
            try { const destination = await copyEntry(entry, current.config); activity({ status: 'success', originalName: entry.relative.split('/').at(-1), destination, message: `已复制：${destination}` }); }
            catch (error) { activity({ status: 'error', message: `${entry.source}：${error.message}` }); }
          }
        } else if (url.pathname === '/api/start') {
          if (watcher) throw new Error('已经在监听');
          plan = null; watcher = await startWatching(config, activity);
        } else if (url.pathname === '/api/stop') {
          await watcher?.stop(); watcher = null;
        } else if (url.pathname === '/api/folder') {
          if (process.platform !== 'darwin') throw new Error('目录选择仅支持 macOS，请输入路径');
          try {
            const { stdout } = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `
              ObjC.import('Cocoa');
              const app = $.NSApplication.sharedApplication;
              app.setActivationPolicy(1);
              app.activateIgnoringOtherApps(true);
              const panel = $.NSOpenPanel.openPanel;
              panel.canChooseFiles = false;
              panel.canChooseDirectories = true;
              panel.allowsMultipleSelection = false;
              panel.title = '选择 SnapSort 文件夹';
              panel.runModal === 1 ? ObjC.unwrap(panel.URL.path) : '';
            `], { timeout: 120000 });
            const selected = stdout.trim();
            return json(200, selected ? { path: selected } : { cancelled: true });
          } catch (error) {
            if (error.stderr?.includes('(-128)')) return json(200, { cancelled: true });
            throw new Error('无法选择文件夹，请重试或直接输入目录路径');
          }
        } else return json(404, { error: '不存在' });
        return json(200, { ok: true });
      } finally { busy = false; }
    } catch (error) { if (!res.headersSent) json(400, { error: error.message }); else res.end(); }
  });
  return { server, async stop() { await watcher?.stop(); await new Promise(resolve => server.close(resolve)); } };
}

const fileURLToPathIfNeeded = file => file instanceof URL ? fileURLToPath(file) : file;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createDashboard();
  app.server.listen(3210, '127.0.0.1', () => console.log('SnapSort 控制面板：http://127.0.0.1:3210（Control+C 停止）'));
  app.server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.stop(); });
}
