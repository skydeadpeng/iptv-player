// src/ui/channelRow.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChannelRow } from './channelRow';
import { Channel } from '../types';

const ch: Channel = { name: 'CCTV-1', url: 'http://u/1', group: '央视' };

beforeEach(() => { document.body.innerHTML = ''; });

function row(isFavorite: boolean, onToggle = vi.fn()): { el: HTMLElement; fav: HTMLButtonElement; onToggle: typeof onToggle } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const fav = renderChannelRow(el, ch, isFavorite, onToggle);
  return { el, fav, onToggle };
}

describe('channelRow', () => {
  it('渲染频道名 + 收藏按钮（未收藏为 ☆）', () => {
    const { el, fav } = row(false);
    expect(el.querySelector('.ch-name')!.textContent).toBe('CCTV-1');
    expect(fav.textContent).toBe('☆');
    expect(fav.title).toBe('收藏');
  });

  it('已收藏显示 ★ 且语义反转为「取消收藏」', () => {
    const { fav } = row(true);
    expect(fav.textContent).toBe('★');
    expect(fav.title).toBe('取消收藏');
  });

  it('点击收藏按钮触发回调，且不冒泡到行点击（不误触播放）', () => {
    const { el, fav, onToggle } = row(false);
    const rowClick = vi.fn();
    el.addEventListener('click', rowClick);      // 行点击 = 播放
    fav.click();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(ch);
    expect(rowClick).not.toHaveBeenCalled();       // stopPropagation 生效
  });
});
