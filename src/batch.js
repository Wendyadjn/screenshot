import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, realpath, readdir, open, mkdir, writeFile, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isScreenshot, normalizeConfig } from './butler.js';

export const DEFAULT_RULES = '学习=lecture,course,作业,课程\n工作=meeting,project,会议,项目\n票据=receipt,invoice,发票,收据';

export function parseRules(text) {
  return text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const separator = line.indexOf('=');
    const category = line.slice(0, separator).trim();
    const keywords = line.slice(separator + 1).split(',').map(word => word.trim().toLowerCase()).filter(Boolean);
    if (separator < 1 || !/^[\p{L}\p{N}_ -]{1,40}$/u.test(category) || !keywords.length)
      throw new Error('规则格式：分类=关键词,关键词；分类不能包含路径符号');
    return { category, keywords };
  });
}

const signature = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
const contains = (parent, child) => child === parent || child.startsWith(parent + path.sep);

async function folders(input) {
  const config = normalizeConfig(input);
  config.watchDir = await realpath(config.watchDir);
  // 逐级解析已存在的祖先，识别尚未创建的目标目录中的链接。
  async function resolved(file) {
    try { return await realpath(file); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return path.join(await resolved(path.dirname(file)), path.basename(file));
    }
  }
  config.archiveDir = await resolved(config.archiveDir);
  if (contains(config.watchDir, config.archiveDir) || contains(config.archiveDir, config.watchDir))
    throw new Error('批量整理的源目录和目标目录必须互不包含');
  return config;
}

export async function scanScreenshots(input, rulesText = DEFAULT_RULES) {
  const config = await folders(input);
  const rules = parseRules(rulesText);
  const entries = [];
  for (const name of (await readdir(config.watchDir)).sort()) {
    if (!isScreenshot(name)) continue;
    const source = path.join(config.watchDir, name);
    const stat = await lstat(source);
    if (!stat.isFile()) continue;
    const category = rules.find(rule => rule.keywords.some(word => name.toLowerCase().includes(word)))?.category ?? '其他';
    let date = new Date(stat.mtimeMs);
    const match = name.match(/(20\d{2})[-年](\d{1,2})[-月](\d{1,2})/);
    if (match) {
      const candidate = new Date(+match[1], +match[2] - 1, +match[3]);
      if (candidate.getFullYear() === +match[1] && candidate.getMonth() === +match[2] - 1 && candidate.getDate() === +match[3]) date = candidate;
    }
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    entries.push({ source, relative: path.join(category, month, name), signature: signature(stat) });
  }
  return { config, entries };
}

export async function copyEntry(entry, input) {
  const config = await folders(input);
  if (path.dirname(entry.source) !== config.watchDir || !isScreenshot(entry.source) ||
      path.isAbsolute(entry.relative) || entry.relative.split(path.sep).some(part => part === '..' || !part) ||
      path.basename(entry.relative) !== path.basename(entry.source)) throw new Error('预览路径无效');
  const incoming = await open(entry.source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let data;
  try {
    const stat = await incoming.stat();
    if (!stat.isFile() || signature(stat) !== entry.signature) throw new Error('源文件已变化，请重新扫描');
    data = await incoming.readFile();
    if (signature(await incoming.stat()) !== entry.signature) throw new Error('复制期间源文件变化，请重新扫描');
  } finally { await incoming.close(); }
  const parent = path.join(config.archiveDir, path.dirname(entry.relative));
  // 在创建下一级目录前拒绝已有链接，防止写入归档目录外。
  await mkdir(config.archiveDir, { recursive: true });
  let current = config.archiveDir;
  for (const part of path.dirname(entry.relative).split(path.sep)) {
    current = path.join(current, part);
    try { await mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('目标分类路径不是普通目录');
  }
  // shortcut: 操作期间目标目录必须保持稳定，支持并发修改目录链接时需改用原生目录句柄 API。
  const temporary = path.join(parent, `.snapsort-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
    const { name, ext } = path.parse(entry.relative);
    for (let number = 0; ; number++) {
      const target = path.join(parent, `${name}${number ? ` (${number})` : ''}${ext}`);
      try { await link(temporary, target); return target; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
