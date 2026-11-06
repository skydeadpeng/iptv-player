// src/bridge/native.ts
/** Android 壳注入 window.IptvBridge 时优先走壳；浏览器内直接 fetch（受 CORS 限制，属预期）。 */
interface IptvBridge {
  /**
   * 启动原生文件选择器；同步返回本次请求 key（壳侧 Kotlin 返回 String，JS 侧按 string 归一化；
   * 兼容壳改回 Long 导致的 number）。
   * 结果经 window.__iptvFileReady({key,name,text}) 单对象异步回传（payload 为 null 或 name/text 为 null 表示取消）。
   */
  pickM3uFile(): string | number;
}
declare global {
  interface Window {
    IptvBridge?: IptvBridge;
    /**
     * 壳回传载荷：key 类型跨 JS/Java 桥可能不一致（壳 JSONObject 里的 Long 渲染为 JSON number，
     * 而 pickM3uFile() 返回的是 string），故放宽为 string | number；匹配时按 String(key) 归一化。
     * name/text 为 null 表示用户取消。
     */
    __iptvFileReady?: (payload: { key: string | number; name: string | null; text: string | null } | null) => void;
  }
}

const PICK_TIMEOUT_MS = 120_000; // 用户找文件可能很久，120s 兜底

interface PickedFile { name: string; text: string }

/** key → resolver：单 handler 按 payload.key 分发，根治单槽覆盖（并发/过期回调安全） */
const pending = new Map<string, (file: PickedFile | null) => void>();

function onFileReady(payload: { key: string | number; name: string | null; text: string | null } | null): void {
  if (!payload) { // 壳取消兜底：全部 pending 以 null 结束
    for (const done of [...pending.values()]) done(null);
    return;
  }
  // key 归一化：壳 pickM3uFile() 返回 string，回调 JSONObject 里的 key 常是 number（Kotlin Long）
  const done = pending.get(String(payload.key));
  if (!done) return;
  if (payload.name == null || payload.text == null) {
    // 壳改发 {key, name:null, text:null} 表示取消：与「无壳/超时」语义一致，返回 null
    done(null);
    return;
  }
  done({ name: payload.name, text: payload.text });
}

export const fetchBridge = {
  async fetchText(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },
  hasNative(): boolean { return typeof window !== 'undefined' && !!window.IptvBridge; },
  /** 壳契约版：bridge.pickM3uFile() 无参返回 key；__iptvFileReady 单对象 payload + key 匹配（key 按 String 归一化）+ 120s 超时；无壳/空 key/超时/取消返回 null。 */
  pickM3uFile(): Promise<PickedFile | null> {
    const bridge = typeof window !== 'undefined' ? window.IptvBridge : undefined;
    if (!bridge) return Promise.resolve(null);
    const rawKey = bridge.pickM3uFile();
    if (rawKey == null || rawKey === '') return Promise.resolve(null);
    const key = String(rawKey); // key 归一化：壳可能给 string，也可能给 number（Kotlin Long）
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
