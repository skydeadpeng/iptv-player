// src/ui/controls.ts —— Task 6 整体替换为完整实现
import { Channel } from '../types';
export function initControls(_root: HTMLElement, _refilter: () => void) {
  return {
    filter(chs: Channel[]): Channel[] { return chs; },
    setPlay(_fn: (c: Channel) => void): void {},
    setChannelList(_chs: Channel[]): void {},
    setKeyword(_kw: string): void {},
    stepChannel(_d: 1 | -1): void {},
    toggleFavorite(_c: Channel): void {},
    favorites(): string[] { return []; },
    ratio: 'contain' as const,
    cycleRatio(): void {},
  };
}
