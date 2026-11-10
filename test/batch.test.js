import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanScreenshots, copyEntry, parseRules } from '../src/batch.js';

test('SnapSort 只读预览、分类优先级、保留原图、重名与过期预览', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'snapsort-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = { watchDir: path.join(root, 'in'), archiveDir: path.join(root, 'out'), keepOriginal: false };
  await mkdir(config.watchDir);
  const source = path.join(config.watchDir, 'Screenshot 2026-10-27 lecture.png');
  await writeFile(source, 'original');
  await writeFile(path.join(config.watchDir, 'photo.png'), 'photo');
  await symlink(source, path.join(config.watchDir, 'Screenshot link.png'));
  const plan = await scanScreenshots(config, '学习=lecture\n工作=lecture');
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].relative, '学习/2026-10/Screenshot 2026-10-27 lecture.png');
  await assert.rejects(access(config.archiveDir));
  const first = await copyEntry(plan.entries[0], config);
  const second = await copyEntry(plan.entries[0], config);
  assert.notEqual(first, second);
  assert.equal(await readFile(source, 'utf8'), 'original');
  assert.equal(await readFile(first, 'utf8'), 'original');
  await writeFile(source, 'changed');
  await assert.rejects(copyEntry(plan.entries[0], config), /变化/);
  await assert.rejects(scanScreenshots({ ...config, archiveDir: path.join(config.watchDir, 'out') }), /互不包含/);
  assert.throws(() => parseRules('../escape=lecture'));
});

test('目标分类链接拒绝写入', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'snapsort-link-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = { watchDir: path.join(root, 'in'), archiveDir: path.join(root, 'out') };
  await mkdir(config.watchDir);
  await mkdir(config.archiveDir);
  await mkdir(path.join(root, 'outside'));
  await writeFile(path.join(config.watchDir, 'Screenshot lecture.png'), 'original');
  const plan = await scanScreenshots(config);
  await symlink(path.join(root, 'outside'), path.join(config.archiveDir, '学习'));
  await assert.rejects(copyEntry(plan.entries[0], config), /普通目录/);
  await assert.rejects(access(path.join(root, 'outside', path.dirname(plan.entries[0].relative).split('/')[1])));
});
