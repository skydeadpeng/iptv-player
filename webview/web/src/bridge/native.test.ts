// src/bridge/native.test.ts
// 壳契约（Task 8 Kotlin 计划，不可改壳）：IptvBridge.pickM3uFile() 无参同步返回 key；
// 结果经 window.__iptvFileReady({key,name,text}) 单对象 payload 异步回传，null = 取消兜底。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchBridge } from './native';

function installBridge(key: string): void {
  window.IptvBridge = { pickM3uFile: () => key };
}

beforeEach(() => {
  delete window.IptvBridge;
  delete window.__iptvFileReady;
});
afterEach(() => {
  delete window.IptvBridge;
  delete window.__iptvFileReady;
});

describe('fetchBridge.pickM3uFile（壳契约：无参返回 key + 单对象 payload）', () => {
  it('无壳（无 window.IptvBridge）返回 null 且不注册回调', async () => {
    await expect(fetchBridge.pickM3uFile()).resolves.toBeNull();
    expect(window.__iptvFileReady).toBeUndefined();
  });

  it('壳返回空 key 时返回 null', async () => {
    installBridge('');
    await expect(fetchBridge.pickM3uFile()).resolves.toBeNull();
    expect(window.__iptvFileReady).toBeUndefined();
  });

  it('key 匹配：单对象 payload → resolve {name,text}，完成后清理回调', async () => {
    installBridge('k1');
    const p = fetchBridge.pickM3uFile();
    expect(window.__iptvFileReady).toBeTypeOf('function');
    window.__iptvFileReady!({ key: 'k1', name: 'a.m3u', text: '#EXTM3U' });
    await expect(p).resolves.toEqual({ name: 'a.m3u', text: '#EXTM3U' });
    expect(window.__iptvFileReady).toBeUndefined();
  });

  it('key 不匹配不 resolve；随后匹配的 payload 仍可 resolve', async () => {
    installBridge('k1');
    const p = fetchBridge.pickM3uFile();
    let settled = false;
    p.then(() => { settled = true; });
    window.__iptvFileReady!({ key: 'other', name: 'x.m3u', text: 'y' });
    await new Promise(r => setTimeout(r, 0));
    expect(settled).toBe(false);
    window.__iptvFileReady!({ key: 'k1', name: 'a.m3u', text: '#EXTM3U' });
    await expect(p).resolves.toEqual({ name: 'a.m3u', text: '#EXTM3U' });
  });

  it('payload null（壳取消兜底）→ resolve null', async () => {
    installBridge('k1');
    const p = fetchBridge.pickM3uFile();
    window.__iptvFileReady!(null);
    await expect(p).resolves.toBeNull();
    expect(window.__iptvFileReady).toBeUndefined();
  });

  it('120s 超时 resolve null 并清理回调（fake timers）', async () => {
    vi.useFakeTimers();
    try {
      installBridge('k1');
      const p = fetchBridge.pickM3uFile();
      const r = p.then(v => ({ called: true, v }));
      await vi.advanceTimersByTimeAsync(120_000);
      expect(await r).toEqual({ called: true, v: null });
      expect(window.__iptvFileReady).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('并发两次选择按 key 各自 resolve（单槽覆盖根治）', async () => {
    const keys = ['k1', 'k2'];
    window.IptvBridge = { pickM3uFile: () => keys.shift()! };
    const p1 = fetchBridge.pickM3uFile();
    const p2 = fetchBridge.pickM3uFile();
    window.__iptvFileReady!({ key: 'k2', name: 'b.m3u', text: 'B' });
    await expect(p2).resolves.toEqual({ name: 'b.m3u', text: 'B' });
    window.__iptvFileReady!({ key: 'k1', name: 'a.m3u', text: 'A' });
    await expect(p1).resolves.toEqual({ name: 'a.m3u', text: 'A' });
  });

  // 回归：key 类型跨 JS/Java 桥不一致（壳 pickM3uFile() 返回 String，回调 JSONObject key 为数字）
  it('壳返回字符串 key、回调 payload.key 为 number → 归一化后仍能匹配 resolve {name,text}', async () => {
    installBridge('1754409600000');
    const p = fetchBridge.pickM3uFile();
    expect(window.__iptvFileReady).toBeTypeOf('function');
    window.__iptvFileReady!({ key: 1754409600000, name: 'a.m3u', text: '#EXTM3U' });
    await expect(p).resolves.toEqual({ name: 'a.m3u', text: '#EXTM3U' });
    expect(window.__iptvFileReady).toBeUndefined();
  });

  it('壳返回 number key、回调 payload.key 为字符串 → 同样能匹配', async () => {
    window.IptvBridge = { pickM3uFile: () => 1754409600000 };
    const p = fetchBridge.pickM3uFile();
    window.__iptvFileReady!({ key: '1754409600000', name: 'a.m3u', text: '#EXTM3U' });
    await expect(p).resolves.toEqual({ name: 'a.m3u', text: '#EXTM3U' });
  });

  // 回归：壳可能改发 {key, name:null, text:null} 表示取消
  it('null 载荷字段（{key,name:null,text:null}）→ 按取消处理 resolve null，不把 null 当文件', async () => {
    installBridge('k1');
    const p = fetchBridge.pickM3uFile();
    window.__iptvFileReady!({ key: 'k1', name: null, text: null });
    await expect(p).resolves.toBeNull();
    expect(window.__iptvFileReady).toBeUndefined();
  });

  it('载荷字段部分为 null（name 有值、text 为 null）→ 同样按取消处理 resolve null', async () => {
    installBridge('k1');
    const p = fetchBridge.pickM3uFile();
    window.__iptvFileReady!({ key: 'k1', name: 'a.m3u', text: null });
    await expect(p).resolves.toBeNull();
    expect(window.__iptvFileReady).toBeUndefined();
  });

  it('null 载荷且 key 不匹配 → 不 resolve 任何 pending（保持 key 匹配语义）', async () => {
    installBridge('k1');
    const p = fetchBridge.pickM3uFile();
    let settled = false;
    p.then(() => { settled = true; });
    window.__iptvFileReady!({ key: 'other', name: null, text: null });
    await new Promise(r => setTimeout(r, 0));
    expect(settled).toBe(false);
    window.__iptvFileReady!({ key: 'k1', name: 'a.m3u', text: '#EXTM3U' });
    await expect(p).resolves.toEqual({ name: 'a.m3u', text: '#EXTM3U' });
  });
});
