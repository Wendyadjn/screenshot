import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { DEFAULT_RULES, scanScreenshots, copyEntry } from './batch.js';

try {
  const config = JSON.parse(await readFile(process.argv[2] ?? new URL('../config.json', import.meta.url), 'utf8'));
  const rules = process.argv[3] ? await readFile(process.argv[3], 'utf8') : DEFAULT_RULES;
  const plan = await scanScreenshots(config, rules);
  console.table(plan.entries.map(entry => ({ 原文件: entry.source, 计划目标: entry.relative })));
  console.log(`找到 ${plan.entries.length} 张截图。复制到 ${plan.config.archiveDir}；原图和原文件名始终保留，不转换格式。`);
  if (plan.entries.length && stdin.isTTY) {
    const prompt = createInterface({ input: stdin, output: stdout });
    let answer;
    try { answer = await prompt.question('确认执行请输入 COPY；其他输入取消：'); }
    finally { prompt.close(); }
    if (answer === 'COPY') {
      for (const entry of plan.entries) {
        try { console.log(`已复制：${await copyEntry(entry, plan.config)}`); }
        catch (error) { console.error(`失败 ${entry.source}：${error.message}`); process.exitCode = 1; }
      }
    } else console.log('已取消，未复制文件。');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
