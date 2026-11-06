// src/ui/channelRow.ts
import { Channel } from '../types';

/**
 * 渲染频道行的内容：频道名 + 可点击的收藏按钮（★ 已收藏 / ☆ 未收藏）。
 *
 * 收藏按钮单独成元素（而不是行文本里的 ★ 前缀）的原因：★ 前缀不可点击，
 * 用户没有任何途径调用 ctrl.toggleFavorite()，收藏功能实际不可达。
 *
 * 收藏按钮的点击会 stopPropagation()：行本身的 click 是「播放」，
 * 点收藏不应该同时触发播放。
 *
 * @param el  频道行容器（虚拟列表渲染出来的 .row）
 * @param c   频道
 * @param isFavorite 当前是否已收藏（决定按钮显示 ★ 还是 ☆）
 * @param onToggleFavorite 收藏状态切换回调
 * @returns 收藏按钮元素（便于测试定位）
 */
export function renderChannelRow(
  el: HTMLElement,
  c: Channel,
  isFavorite: boolean,
  onToggleFavorite: (c: Channel) => void,
): HTMLButtonElement {
  el.textContent = '';

  const label = document.createElement('span');
  label.className = 'ch-name';
  label.textContent = c.name;
  label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

  const fav = document.createElement('button');
  fav.className = 'ch-fav';
  fav.type = 'button';
  fav.title = isFavorite ? '取消收藏' : '收藏';
  fav.setAttribute('aria-label', fav.title);
  fav.textContent = isFavorite ? '★' : '☆';
  fav.style.cssText = 'flex:none;background:none;border:none;color:#f5c518;font-size:18px;line-height:1;cursor:pointer;padding:0 4px;';
  fav.addEventListener('click', (ev) => {
    ev.stopPropagation(); // 不冒泡到行点击（播放）
    onToggleFavorite(c);
  });

  el.append(label, fav);
  return fav;
}
