import chokidar from 'chokidar';
import sharp from 'sharp';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, mkdir, readFile, writeFile, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const extensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
export function isScreenshot(file) {
  return extensions.has(path.extname(file).toLowerCase()) &&
    /^(screen\s?shot|screenshot|截[图圖屏]|屏幕截图|螢幕截圖|屏幕快照|螢幕快照)/i.test(path.basename(file));
}

function expand(file) {
  return path.resolve(file === '~' ? os.homedir() : file.startsWith('~/')
    ? path.join(os.homedir(), file.slice(2)) : file);
}

function screenshotFolder() {
  if (process.platform === 'darwin') {
    try {
      return execFileSync('/usr/bin/defaults', ['read', 'com.apple.screencapture', 'location'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { /* 未配置截图位置时使用桌面。 */ }
  }
  return path.join(os.homedir(), 'Desktop');
}

export function normalizeConfig(input) {
  const config = {
    watchDir: null, archiveDir: '~/Pictures/ScreenshotButler',
    renameTemplate: 'Screenshot_{YYYY}{MM}{DD}_{HH}{mm}{ss}',
    format: 'webp', quality: 82, organizeBy: 'month', keepOriginal: true,
    ...input,
  };
  if (config.watchDir !== null && (typeof config.watchDir !== 'string' || !config.watchDir.trim()))
    throw new Error('watchDir 必须是有效路径或 null');
  if (typeof config.archiveDir !== 'string' || !config.archiveDir.trim())
    throw new Error('archiveDir 必须是有效路径');
  if (!['original', 'png', 'webp', 'jpg'].includes(config.format))
    throw new Error('format 仅支持 original / png / webp / jpg');
  if (!['month', 'type', 'none'].includes(config.organizeBy))
    throw new Error('organizeBy 仅支持 month / type / none');
  if (!Number.isInteger(config.quality) || config.quality < 1 || config.quality > 100)
    throw new Error('quality 必须是 1–100 的整数');
  if (typeof config.keepOriginal !== 'boolean') throw new Error('keepOriginal 必须为布尔值');
  if (typeof config.renameTemplate !== 'string' || !config.renameTemplate.trim() ||
      /[/\\\x00-\x1f:]/.test(config.renameTemplate) ||
      config.renameTemplate.replace(/\{(YYYY|MM|DD|HH|mm|ss)\}/g, '').match(/[{}]/))
    throw new Error('重命名规则含非法字符或未知占位符');
  config.watchDir = expand(config.watchDir ?? screenshotFolder());
  config.archiveDir = expand(config.archiveDir);
  if (config.watchDir === config.archiveDir) throw new Error('监听目录与归档目录必须不同');
  return config;
}

function dateParts(date) {
  return Object.fromEntries(['YYYY', 'MM', 'DD', 'HH', 'mm', 'ss'].map((key, index) =>
    [key, String([date.getFullYear(), date.getMonth() + 1, date.getDate(),
      date.getHours(), date.getMinutes(), date.getSeconds()][index]).padStart(index ? 2 : 4, '0')]));
}

export async function processScreenshot(source, config) {
  if (!isScreenshot(source)) return null;
  const before = await lstat(source);
  if (!before.isFile()) return null;
  const original = await readFile(source);
  const date = dateParts(new Date(before.birthtimeMs > 0 ? before.birthtimeMs : before.mtimeMs));
  const extension = config.format === 'original' ? path.extname(source).slice(1).toLowerCase() : config.format;
  const subdir = config.organizeBy === 'month' ? `${date.YYYY}-${date.MM}` :
    config.organizeBy === 'type' ? extension : '';
  const directory = path.join(config.archiveDir, subdir);
  const name = config.renameTemplate.replace(/\{(YYYY|MM|DD|HH|mm|ss)\}/g, (_, key) => date[key]);
  if (Buffer.byteLength(`${name}.${extension}`) > 240) throw new Error('生成的文件名过长');
  let output = original;
  if (config.format !== 'original') {
    let image = sharp(original).rotate();
    if (config.format === 'jpg') image = image.flatten({ background: '#ffffff' }).jpeg({ quality: config.quality });
    else if (config.format === 'webp') image = image.webp({ quality: config.quality });
    else image = image.png();
    output = await image.toBuffer();
  }
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.butler-${randomUUID()}.tmp`);
  let destination;
  try {
    await writeFile(temporary, output, { flag: 'wx', mode: 0o600 });
    for (let number = 0; ; number++) {
      destination = path.join(directory, `${name}${number ? `_${number}` : ''}.${extension}`);
      try {
        // 同目录硬链接让完整文件一次可见，且不会覆盖已有归档。
        await link(temporary, destination);
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  let warning;
  if (!config.keepOriginal) {
    try {
      const after = await lstat(source);
      if (after.ino !== before.ino || after.dev !== before.dev || after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
        throw new Error('处理期间源文件发生变化，已保留源文件');
      // shortcut: 检查与删除之间仍有竞态，只对已完成写入的本地截图启用移动模式。
      await unlink(source);
    } catch (error) { warning = `归档已完成，源文件未删除：${error.message}`; }
  }
  return { status: warning ? 'warning' : 'success', source, destination,
    originalName: path.basename(source), newName: path.basename(destination),
    inputBytes: original.length, outputBytes: output.length, warning };
}

export async function startWatching(input, onActivity = () => {}) {
  const config = normalizeConfig(input);
  const info = await lstat(config.watchDir);
  if (!info.isDirectory()) throw new Error('监听路径必须是目录，且不能是符号链接');
  await access(config.watchDir, constants.R_OK);
  let queue = Promise.resolve();
  let stopped = false;
  const report = event => onActivity({ time: new Date().toISOString(), ...event });
  const watcher = chokidar.watch(config.watchDir, {
    ignoreInitial: true, depth: 0, followSymlinks: false,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 100 },
    ignored: file => file === config.archiveDir || path.basename(file).startsWith('.'),
  });
  watcher.on('add', file => {
    if (stopped || !isScreenshot(file)) return;
    queue = queue.then(async () => {
      try {
        const result = await processScreenshot(file, config);
        if (result) report(result);
      } catch (error) { report({ status: 'error', source: file, message: error.message }); }
    });
  });
  watcher.on('error', error => report({ status: 'error', message: error.message }));
  try {
    await new Promise((resolve, reject) => {
      watcher.once('ready', resolve);
      watcher.once('error', reject);
    });
  } catch (error) { await watcher.close(); throw error; }
  report({ status: 'watching', watchDir: config.watchDir, config });
  return {
    config,
    async stop() {
      stopped = true;
      await watcher.close();
      await queue;
      report({ status: 'stopped' });
    },
  };
}
