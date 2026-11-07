// src/ui/autoDialog.ts
import { runAutoFetch, cancelAutoFetch, AutoProgress } from '../auto/manager';
import * as autoStore from '../storage/autoStore';
import { SourceSpec } from '../auto/merge';

/**
 * 自动源对话框：源清单（增删）+ 一键获取（拉取/测速进度 + 结果摘要）。
 * onDone 在获取成功后回调（main.ts 用它 reload 频道列表）。
 */
export function showAutoDialog(onDone: () => void): void {
  const dlg = document.createElement('div');
  dlg.id = 'auto-dialog';
  dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:100;';
  dlg.innerHTML = `
    <div style="background:#161616;padding:24px;border-radius:8px;width:480px;max-height:80vh;overflow-y:auto;">
      <h3 style="margin-bottom:12px;">自动获取频道</h3>
      <div id="auto-source-list"></div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <input id="auto-add-name" placeholder="名称" style="width:110px;background:#0a0a0a;color:#eee;border:1px solid #333;padding:6px 8px;">
        <input id="auto-add-url" placeholder="M3U 订阅地址" style="flex:1;background:#0a0a0a;color:#eee;border:1px solid #333;padding:6px 8px;">
        <button id="auto-add-go" style="padding:6px 12px;">添加</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px;align-items:center;">
        <button id="auto-run" style="flex:1;padding:8px;">开始获取</button>
        <button id="auto-cancel-run" style="padding:8px;display:none;">停止</button>
        <button id="auto-close" style="padding:8px;">关闭</button>
      </div>
      <p id="auto-status" style="color:#8cf;margin-top:10px;min-height:1.2em;"></p>
      <p style="color:#666;font-size:12px;margin-top:4px;">测速会并发探测每个频道（5 秒超时），剔除不可用频道；结果缓存 24 小时。</p>
    </div>`;
  document.body.appendChild(dlg);
  const close = () => dlg.remove();

  const listEl = dlg.querySelector<HTMLDivElement>('#auto-source-list')!;
  const statusEl = dlg.querySelector<HTMLParagraphElement>('#auto-status')!;
  const runBtn = dlg.querySelector<HTMLButtonElement>('#auto-run')!;
  const stopBtn = dlg.querySelector<HTMLButtonElement>('#auto-cancel-run')!;

  function renderList(): void {
    listEl.innerHTML = '';
    for (const s of autoStore.loadAutoSources()) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #222;';
      const name = document.createElement('span');
      name.textContent = s.name;
      name.style.cssText = 'flex:none;width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      const url = document.createElement('span');
      url.textContent = s.url;
      url.style.cssText = 'flex:1;color:#888;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      const del = document.createElement('button');
      del.textContent = '删除';
      del.style.cssText = 'background:none;border:none;color:#f66;cursor:pointer;';
      del.onclick = () => { autoStore.saveAutoSources(autoStore.loadAutoSources().filter(x => x.url !== s.url)); renderList(); };
      row.append(name, url, del);
      listEl.appendChild(row);
    }
  }
  renderList();

  dlg.querySelector('#auto-add-go')!.addEventListener('click', () => {
    const nameEl = dlg.querySelector<HTMLInputElement>('#auto-add-name')!;
    const urlEl = dlg.querySelector<HTMLInputElement>('#auto-add-url')!;
    const url = urlEl.value.trim();
    if (!url) return;
    const specs: SourceSpec[] = [...autoStore.loadAutoSources(), { name: nameEl.value.trim() || '自定义源', url }];
    autoStore.saveAutoSources(specs);
    nameEl.value = ''; urlEl.value = '';
    renderList();
  });

  stopBtn.addEventListener('click', () => cancelAutoFetch());
  dlg.querySelector('#auto-close')!.addEventListener('click', close);

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    stopBtn.style.display = '';
    statusEl.textContent = '开始…';
    try {
      const onProgress = (p: AutoProgress): void => { statusEl.textContent = p.detail; };
      const resultP = runAutoFetch(onProgress);
      // runAutoFetch 的取消靠外部 stop；UI 侧等待完成
      const r = await resultP;
      if (r) {
        statusEl.textContent += '，频道列表已更新';
        onDone();
      }
    } finally {
      runBtn.disabled = false;
      stopBtn.style.display = 'none';
    }
  });
}
