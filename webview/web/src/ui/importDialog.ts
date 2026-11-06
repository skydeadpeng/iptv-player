// src/ui/importDialog.ts
import { fetchBridge } from '../bridge/native';

interface ImportOpts { onImported(text: string, name: string): string | null; }
let opts: ImportOpts | null = null;

export function setupImportDialog(o: ImportOpts): void { opts = o; }

export function showImportDialog(): void {
  const dlg = document.createElement('div');
  dlg.id = 'import-dialog';
  dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:100;';
  dlg.innerHTML = `
    <div style="background:#161616;padding:24px;border-radius:8px;width:420px;">
      <h3 style="margin-bottom:12px;">添加订阅源</h3>
      <textarea id="import-url" rows="2" placeholder="输入 M3U 订阅地址" style="width:100%;background:#0a0a0a;color:#eee;border:1px solid #333;padding:8px;"></textarea>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button id="import-go" style="flex:1;padding:8px;">订阅</button>
        <button id="import-file" style="flex:1;padding:8px;">导入本地文件</button>
        <button id="import-cancel" style="padding:8px;">取消</button>
      </div>
      <p id="import-error" style="color:#f66;margin-top:8px;min-height:1em;"></p>
    </div>`;
  document.body.appendChild(dlg);

  const close = () => dlg.remove();
  dlg.querySelector('#import-cancel')!.addEventListener('click', close);

  dlg.querySelector('#import-go')!.addEventListener('click', async () => {
    const url = dlg.querySelector<HTMLTextAreaElement>('#import-url')!.value.trim();
    if (!url) return;
    try {
      const text = await fetchBridge.fetchText(url);
      const err = opts!.onImported(text, url);
      if (err) { dlg.querySelector('#import-error')!.textContent = err; return; }
      close();
    } catch (e) {
      dlg.querySelector('#import-error')!.textContent = `下载失败：${e instanceof Error ? e.message : e}`;
    }
  });

  dlg.querySelector('#import-file')!.addEventListener('click', async () => {
    // 壳内走原生 Bridge；纯浏览器回退 input[type=file]
    if (fetchBridge.hasNative()) {
      const file = await fetchBridge.pickM3uFile();
      if (!file) return; // 用户取消或超时
      const err = opts!.onImported(file.text, file.name);
      if (err) { dlg.querySelector('#import-error')!.textContent = err; return; }
      close();
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.m3u,.m3u8,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const err = opts!.onImported(await file.text(), file.name);
      if (err) { dlg.querySelector('#import-error')!.textContent = err; return; }
      close();
    };
    input.click();
  });
}
