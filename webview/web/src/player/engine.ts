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

  /**
   * 换台前的「轻量重置」：停掉旧的播放引擎实例 + 暂停画面。
   *
   * 关键：**不要**在这里 video.removeAttribute('src') / video.load()。
   * 浏览器的资源选择(load)算法是异步任务：load() 排队的任务会在新源挂上之后才执行，
   * 把刚挂好的流 abort 掉（媒体元素进入 NETWORK_EMPTY，readyState 卡在 HAVE_NOTHING），
   * 于是「第二个频道永远出不来画面」，最后被 8s 看门狗判成「播放失败」。
   * Task 9 端到端实证：清掉这两行后，本地 HLS → mux.dev 换台 0.7s 出图；
   * 保留时 100% 卡死并报「播放失败：HLS 超时（8000ms 无数据）」。
   * 换源本身不需要重置元素——各分支都会写 video.src，新 src 会自动中止旧资源。
   */
  function clearAll(): void {
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    if (hls) { hls.destroy(); hls = null; }
    if (tsPlayer) { tsPlayer.pause(); tsPlayer.unload(); tsPlayer.destroy(); tsPlayer = null; }
    video.pause();
  }

  /** 彻底拆毁：额外清掉元素上的 src（只有 destroy 用，换台不能这么干，见 clearAll 注释） */
  function destroyAll(): void {
    clearAll();
    video.removeAttribute('src');
    video.load();
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
        if (!Hls.isSupported()) { clearAll(); fatalCb?.('浏览器不支持 HLS'); return; }
        hls = new Hls({ manifestLoadingTimeOut: timeoutMs, fragLoadingTimeOut: timeoutMs });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) { clearAll(); fatalCb?.(`HLS 致命错误: ${data.details}`); }
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else {
        if (!mpegts.isSupported()) { clearAll(); fatalCb?.('浏览器不支持 mpegts'); return; }
        // type 判定与 selectEngine 同源清洗（剥 ?/# 后小写），避免 b.flv?token=1 / b.FLV 被误建为 mpegts 类型
        const clean = url.split(/[?#]/)[0].toLowerCase();
        tsPlayer = mpegts.createPlayer({ type: (clean.endsWith('.flv') ? 'flv' : 'mpegts'), url });
        tsPlayer.on(mpegts.Events.ERROR, (type) => {
          clearAll(); fatalCb?.(`MPEGTS 致命错误: ${type}`);
        });
        tsPlayer.attachMediaElement(video);
        tsPlayer.load();
        // mpegts.js 1.8.2 将 play() 声明为 void | Promise<void>，用 Promise.resolve 统一吞掉自动播放拒绝
        Promise.resolve(tsPlayer.play()).catch(() => {});
      }
    },

    destroy: destroyAll,
  };
}
