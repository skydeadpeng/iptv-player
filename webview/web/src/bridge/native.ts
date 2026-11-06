// src/bridge/native.ts
/** Android 壳注入 window.IptvBridge 时优先走壳；浏览器内直接 fetch（受 CORS 限制，属预期）。 */
interface IptvBridge {
  /** 启动原生文件选择器；结果经 window.__iptvFileReady(key, file) 异步回传（file 为 null 表示取消）。 */
  pickM3uFile(key: string): void;
}
declare global {
  interface Window {
    IptvBridge?: IptvBridge;
    __iptvFileReady?: (key: string, file: { name: string; text: string } | null) => void;
  }
}

const PICK_TIMEOUT_MS = 120_000; // 用户找文件可能很久，120s 兜底

interface PickedFile { name: string; text: string }

export const fetchBridge = {
  async fetchText(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },
  hasNative(): boolean { return typeof window !== 'undefined' && !!window.IptvBridge; },
  /** 异步等待版：key 匹配 + __iptvFileReady 回调 + 120s 超时；无壳/超时/取消返回 null。 */
  pickM3uFile(): Promise<PickedFile | null> {
    const bridge = typeof window !== 'undefined' ? window.IptvBridge : undefined;
    if (!bridge) return Promise.resolve(null);
    const key = `m3u-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise<PickedFile | null>(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (file: PickedFile | null): void => {
        clearTimeout(timer);
        delete window.__iptvFileReady;
        resolve(file);
      };
      timer = setTimeout(() => done(null), PICK_TIMEOUT_MS);
      window.__iptvFileReady = (k, file) => { if (k === key) done(file); };
      bridge.pickM3uFile(key);
    });
  },
};
