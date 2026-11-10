const $ = id => document.getElementById(id);
let state, dirty = false, working = false, connected = false, renderedPlan, renderedLogs, confirmedPlan;
const fields = ['watchDir', 'archiveDir', 'renameTemplate', 'format', 'organizeBy', 'quality'];
function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
async function api(route, body) {
  const response = await fetch(`/api/${route}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
function image(url, name) { const img = document.createElement('img'); img.src = url; img.alt = name; img.loading = 'lazy'; img.onerror = () => { img.alt = '无法预览'; img.onerror = null; }; return img; }
function updateButtons() {
  const busy = working || state?.busy || !connected;
  $('fields').disabled = busy || state?.watching;
  $('scan').disabled = busy || state?.watching || dirty;
  $('copy').disabled = busy || dirty || !state?.plan?.entries.length;
  $('watch').disabled = busy || dirty;
}
async function refresh() {
  state = await api('state');
  connected = true;
  if (!dirty && document.activeElement?.closest('form') === null) {
    for (const key of fields) $(key).value = state.config[key];
    $('rules').value = state.rules;
  }
  $('status').textContent = state.watching ? '● 正在监听' : '○ 监听已停止';
  $('watch').textContent = state.watching ? '停止监听' : '开始监听';
  const planKey = state.plan?.id ?? null;
  if (renderedPlan !== planKey) {
    renderedPlan = planKey; $('entries').replaceChildren();
    for (const entry of state.plan?.entries ?? []) {
      const row = document.createElement('tr');
      const thumb = document.createElement('td'); thumb.append(image(`/api/thumbnail?plan=${planKey}&index=${entry.index}`, entry.name)); row.append(thumb);
      for (const text of [entry.name, entry.relative]) { const cell = document.createElement('td'); cell.textContent = text; row.append(cell); }
      $('entries').append(row);
    }
  }
  $('count').textContent = dirty ? '配置已修改，请保存后重新扫描' : state.plan ? `找到 ${state.plan.entries.length} 张截图；重名会自动编号。` : '尚无有效预览，请扫描';
  const logsKey = state.logs[0]?.id;
  if (renderedLogs !== logsKey) {
    renderedLogs = logsKey; $('logs').replaceChildren();
    for (const log of state.logs) {
      const row = document.createElement('div'); row.className = 'log';
      if (log.destination) row.append(image(`/api/thumbnail?log=${log.id}`, '归档图片'));
      const detail = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = log.message ?? ([log.originalName, log.newName].filter(Boolean).join(' → ') || log.status);
      if (log.status === 'error') title.className = 'error';
      const meta = document.createElement('p'); meta.textContent = `${new Date(log.time).toLocaleTimeString()} · ${log.status}`;
      detail.append(title, meta); row.append(detail); $('logs').append(row);
    }
  }
  updateButtons();
}
async function action(job) {
  working = true; updateButtons();
  try { await job(); await refresh(); }
  catch (error) { notice(error.message, true); }
  finally { working = false; updateButtons(); }
}
$('settings').addEventListener('input', () => { dirty = true; updateButtons(); notice('设置已修改，请保存后继续。'); });
$('settings').addEventListener('submit', event => {
  event.preventDefault(); action(async () => {
    const config = Object.fromEntries(fields.map(key => [key, key === 'quality' ? Number($(key).value) : $(key).value]));
    await api('config', { config, rules: $('rules').value }); dirty = false; notice('设置已保存。');
  });
});
for (const button of document.querySelectorAll('[data-folder]')) button.onclick = () => action(async () => {
  notice('请在 macOS 弹出的窗口中选择文件夹。');
  const result = await api('folder', {});
  if (result.cancelled) { notice('已取消选择，目录保持不变。'); return; }
  $(button.dataset.folder).value = result.path; dirty = true; notice('目录已选择，请保存设置。');
});
$('scan').onclick = () => action(async () => { notice('正在扫描…'); await api('scan', {}); notice('扫描完成，请检查分类和目标路径。'); });
$('copy').onclick = () => {
  confirmedPlan = state.plan.id;
  $('confirmationText').textContent = `将 ${state.plan.entries.length} 张截图复制到：${state.config.archiveDir}`;
  $('confirmation').showModal();
};
$('cancelCopy').onclick = () => $('confirmation').close();
$('executeCopy').onclick = () => {
  $('confirmation').close();
  action(async () => { notice('正在复制…'); await api('copy', { id: confirmedPlan }); notice('复制结束，请在活动日志检查每张图片的结果。'); });
};
$('watch').onclick = () => action(async () => { const route = state.watching ? 'stop' : 'start'; await api(route, {}); notice(route === 'start' ? '已开始监听新增截图；原图会保留。' : '监听已停止。'); });
function disconnected(error) { connected = false; updateButtons(); notice(`连接中断，请检查终端中的服务：${error.message}`, true); }
updateButtons();
refresh().then(() => notice('面板已就绪。建议先使用 demo 测试目录。')).catch(disconnected);
setInterval(() => { if (!working) refresh().catch(disconnected); }, 1500);
