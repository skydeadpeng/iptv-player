// src/bridge/native.ts
/** Android 壳注入 window.IptvBridge 时优先走壳；浏览器内直接 fetch（受 CORS 限制，属预期）。 */
interface IptvBridge {
  /** 启动原生文件选择器；同步返回本次请求 key，结果经 window.__iptvFileReady({key,name,text}) 单对象异步回传（payload 为 null 表示取消）。 */
  pickM3uFile(): string;
}
declare global {
  interface Window {
    IptvBridge?: IptvBridge;
    __iptvFileReady?: (payload: { key: string; name: string; text: string } | null) => void;
  }
}

const PICK_TIMEOUT_MS = 120_000; // 用户找文件可能很久，120s 兜底

interface PickedFile { name: string; text: string }

/** key → resolver：单 handler 按 payload.key 分发，根治单槽覆盖（并发/过期回调安全） */
const pending = new Map<string, (file: PickedFile | null) => void>();

function onFileReady(payload: { key: string; name: string; text: string } | null): void {
  if (!payload) { // 壳取消兜底：全部 pending 以 null 结束
    for (const done of [...pending.values()]) done(null);
    return;
  }
  pending.get(payload.key)?.({ name: payload.name, text: payload.text });
}

export const fetchBridge = {
  async fetchText(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },
  hasNative(): boolean { return typeof window !== 'undefined' && !!window.IptvBridge; },
  /** 壳契约版：bridge.pickM3uFile() 无参返回 key；__iptvFileReady 单对象 payload + key 匹配 + 120s 超时；无壳/空 key/超时/取消返回 null。 */
  pickM3uFile(): Promise<PickedFile | null> {
    const bridge = typeof window !== 'undefined' ? window.IptvBridge : undefined;
    if (!bridge) return Promise.resolve(null);
    const key = bridge.pickM3uFile();
    if (!key) return Promise.resolve(null);
    return new Promise<PickedFile | null>(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (file: PickedFile | null): void => {
        clearTimeout(timer);
        pending.delete(key);
        if (pending.size === 0) delete window.__iptvFileReady;
        resolve(file);
      };
      timer = setTimeout(() => done(null), PICK_TIMEOUT_MS);
      pending.set(key, done);
      window.__iptvFileReady = onFileReady;
    });
  },
};
