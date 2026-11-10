import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { isScreenshot, normalizeConfig, processScreenshot, startWatching } from '../src/butler.js';

test('校验配置与截图名称', () => {
  for (const name of ['Screen Shot 2026.png', 'Screenshot 2026.png', '截屏2026.png', '截图2026.PNG', '螢幕快照2026.png']) {
    assert.equal(isScreenshot(name), true);
  }
  assert.equal(isScreenshot('holiday.png'), false);
  assert.equal(isScreenshot('Screenshot.txt'), false);
  assert.throws(() => normalizeConfig({ renameTemplate: '../unsafe' }));
  assert.throws(() => normalizeConfig({ quality: 101 }));
  assert.throws(() => normalizeConfig({ renameTemplate: '{unknown}' }));
  assert.throws(() => normalizeConfig({ watchDir: '/tmp', archiveDir: '/tmp' }));
});

test('转换、无覆盖归档、移动、错误时保留原图', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'butler-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = normalizeConfig({ watchDir: root, archiveDir: path.join(root, 'archive') });
  const source = path.join(root, '截图2026.png');
  await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ff000080' } }).png().toFile(source);
  const first = await processScreenshot(source, config);
  const second = await processScreenshot(source, config);
  assert.notEqual(first.destination, second.destination);
  assert.equal((await sharp(first.destination).metadata()).format, 'webp');
  assert.ok(await readFile(source));
  assert.equal((await readFile(first.destination)).length, first.outputBytes);
  const moved = await processScreenshot(source, { ...config, format: 'jpg', organizeBy: 'type', keepOriginal: false });
  assert.equal(path.basename(path.dirname(moved.destination)), 'jpg');
  assert.equal((await sharp(moved.destination).metadata()).hasAlpha, false);
  await assert.rejects(readFile(source), { code: 'ENOENT' });
  await writeFile(source, 'invalid image');
  await assert.rejects(processScreenshot(source, { ...config, keepOriginal: false }));
  assert.equal(await readFile(source, 'utf8'), 'invalid image');
  const copied = await processScreenshot(source, { ...config, format: 'original', organizeBy: 'none' });
  assert.equal(await readFile(copied.destination, 'utf8'), 'invalid image');
});

test('监听仅处理新增截图，停止时排空队列', { timeout: 12000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'butler-watch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const watchDir = path.join(root, 'desktop');
  await mkdir(watchDir);
  await writeFile(path.join(watchDir, '截图old.png'), 'old');
  const events = [];
  let resolveActivity;
  const activity = new Promise(resolve => { resolveActivity = resolve; });
  const controller = await startWatching({ watchDir, archiveDir: path.join(watchDir, 'archive') }, event => {
    events.push(event);
    if (['success', 'error'].includes(event.status)) resolveActivity(event);
  });
  t.after(() => controller.stop());
  await writeFile(path.join(watchDir, 'holiday.png'), 'unrelated');
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } }).png().toBuffer();
  await writeFile(path.join(watchDir, 'Screenshot new.png'), png);
  const result = await activity;
  assert.equal(result.status, 'success', JSON.stringify(result));
  await controller.stop();
  assert.equal(events.filter(event => event.status === 'success').length, 1);
  assert.ok((await readdir(watchDir)).includes('截图old.png'));
});
