// src/player/engine.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPlayer } from './engine';

/**
 * 回归测试：换台时不得对 <video> 做 removeAttribute('src') / load()。
 *
 * 背景（Task 9 浏览器端到端实证）：Chrome 的资源选择算法是异步任务，
 * load() 排队的任务会在新源挂上之后才执行，把刚挂好的流 abort 掉
 * （媒体元素卡在 NETWORK_EMPTY）→ 换台后画面永远出不来，8s 后被看门狗
 * 判成「播放失败：HLS 超时」。修复前本地 HLS → mux.dev 换台 100% 失败，
 * 修复后 0.7s 出图。
 */
function fakeVideo(): { el: HTMLVideoElement; calls: string[] } {
  const el = document.createElement('video');
  const calls: string[] = [];
  el.pause = (() => { calls.push('pause'); }) as HTMLVideoElement['pause'];
  el.load = (() => { calls.push('load'); }) as HTMLVideoElement['load'];
  const origRemove = el.removeAttribute.bind(el);
  el.removeAttribute = ((name: string) => { calls.push(`removeAttribute:${name}`); origRemove(name); }) as HTMLVideoElement['removeAttribute'];
  // jsdom 无 MSE/原生 HLS：canPlayType 返回 '' → 走 hls.js 分支 → Hls.isSupported() 为 false → 致命错误
  el.canPlayType = (() => '') as HTMLVideoElement['canPlayType'];
  return { el, calls };
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('player engine 换台重置', () => {
  it('play()/换台 只暂停，不调用 load() 与 removeAttribute(src)', () => {
    const { el, calls } = fakeVideo();
    const player = createPlayer(el);
    player.play('http://example.com/a.m3u8');
    player.play('http://example.com/b.m3u8');   // 换台
    player.play('http://example.com/c.m3u8');
    expect(calls.filter(c => c === 'load')).toHaveLength(0);
    expect(calls.filter(c => c.startsWith('removeAttribute'))).toHaveLength(0);
    expect(calls.filter(c => c === 'pause').length).toBeGreaterThan(0);  // 至少暂停过一次
  });

  it('destroy() 才彻底清空元素（removeAttribute(src) + load）', () => {
    const { el, calls } = fakeVideo();
    const player = createPlayer(el);
    player.play('http://example.com/a.m3u8');
    player.destroy();
    expect(calls).toContain('removeAttribute:src');
    expect(calls).toContain('load');
  });

  it('致命错误回调能收到「不支持」提示（不抛未捕获异常）', () => {
    const { el } = fakeVideo();
    const player = createPlayer(el);
    const onFatal = vi.fn();
    player.onFatal(onFatal);
    player.play('http://example.com/a.m3u8');
    expect(onFatal).toHaveBeenCalled();
    expect(String(onFatal.mock.calls[0][0])).toContain('HLS');
  });
});
