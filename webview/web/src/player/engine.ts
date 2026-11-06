import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { selectEngine } from './engineSelect';

export interface Player {
  play(url: string): void;
  destroy(): void;
  onFatal(cb: (msg: string) => void): void;
}

const DEFAULT_TIMEOUT_MS = 8000; // 设计约束：8 秒无数据判定失败

export function createPlayer(video: HTMLVideoElement, opts?: { timeoutMs?: number }): Player {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let hls: Hls | null = null;
  let tsPlayer: mpegts.Player | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let fatalCb: ((msg: string) => void) | null = null;

  function clearAll(): void {
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    if (hls) { hls.destroy(); hls = null; }
    if (tsPlayer) { tsPlayer.pause(); tsPlayer.unload(); tsPlayer.destroy(); tsPlayer = null; }
    video.removeAttribute('src'); video.load();
  }

  function armWatchdog(what: string): void {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      clearAll();
      fatalCb?.(`${what} 超时（${timeoutMs}ms 无数据）`);
    }, timeoutMs);
  }

  video.addEventListener('playing', () => {
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  });

  return {
    onFatal(cb) { fatalCb = cb; },

    play(url: string): void {
      clearAll();
      armWatchdog(selectEngine(url) === 'hls' ? 'HLS' : 'TS/FLV');

      if (selectEngine(url) === 'hls') {
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = url; video.play().catch(() => {});
          return;
        }
        if (!Hls.isSupported()) { fatalCb?.('浏览器不支持 HLS'); return; }
        hls = new Hls({ manifestLoadingTimeOut: timeoutMs, fragLoadingTimeOut: timeoutMs });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) { clearAll(); fatalCb?.(`HLS 致命错误: ${data.details}`); }
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else {
        if (!mpegts.isSupported()) { fatalCb?.('浏览器不支持 mpegts'); return; }
        tsPlayer = mpegts.createPlayer({ type: (url.endsWith('.flv') ? 'flv' : 'mpegts'), url });
        tsPlayer.on(mpegts.Events.ERROR, (type) => {
          clearAll(); fatalCb?.(`MPEGTS 致命错误: ${type}`);
        });
        tsPlayer.attachMediaElement(video);
        tsPlayer.load();
        // mpegts.js 1.8.2 将 play() 声明为 void | Promise<void>，用 Promise.resolve 统一吞掉自动播放拒绝
        Promise.resolve(tsPlayer.play()).catch(() => {});
      }
    },

    destroy: clearAll,
  };
}
