// src/ui/importDialog.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupImportDialog, showImportDialog } from './importDialog';

// jsdom 无真实网络：stub 全局 fetch（fetchBridge.fetchText 内部调用），不改被测模块
const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  text: async () => '#EXTM3U\n#EXTINF:-1,CCTV-1\nhttp://example.com/1.m3u8\n',
}));

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('importDialog', () => {
  it('成功导入调用 onImported 并关闭对话框', async () => {
    const onImported = vi.fn(() => null);
    setupImportDialog({ onImported });
    showImportDialog();
    const ta = document.querySelector<HTMLTextAreaElement>('#import-url')!;
    ta.value = 'http://example.com/live.m3u';
    document.querySelector<HTMLButtonElement>('#import-go')!.click();
    await vi.waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(document.getElementById('import-dialog')).toBeNull();
  });

  it('onImported 返回错误字符串时显示错误且不关闭', async () => {
    const onImported = vi.fn(() => '解析出 0 个频道，请检查文件格式');
    setupImportDialog({ onImported });
    showImportDialog();
    document.querySelector<HTMLTextAreaElement>('#import-url')!.value = 'x';
    document.querySelector<HTMLButtonElement>('#import-go')!.click();
    await vi.waitFor(() => expect(document.querySelector('#import-error')!.textContent).toContain('0 个频道'));
    expect(document.getElementById('import-dialog')).not.toBeNull();
  });
});
