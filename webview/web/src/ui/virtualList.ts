// src/ui/virtualList.ts
import { Channel } from '../types';

export interface VirtualList {
  setItems(items: Channel[]): void;
  destroy(): void;
}

interface Opts {
  rowH: number;
  overscan?: number;
  renderItem(el: HTMLElement, item: Channel, index: number): void;
}

/** 固定行高虚拟滚动：仅渲染可视区(±overscan)的行，保证 1000+ 频道流畅。 */
export function createVirtualList(container: HTMLElement, opts: Opts): VirtualList {
  const { rowH, overscan = 10, renderItem } = opts;
  let items: Channel[] = [];
  const spacer = document.createElement('div');
  spacer.style.position = 'relative';
  container.appendChild(spacer);

  function render(): void {
    const start = Math.max(0, Math.floor(container.scrollTop / rowH) - overscan);
    const visible = Math.ceil(container.clientHeight / rowH) + overscan * 2;
    const end = Math.min(items.length, start + visible);
    spacer.style.height = `${items.length * rowH}px`;
    spacer.querySelectorAll('.row').forEach(n => n.remove());
    for (let i = start; i < end; i++) {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.cssText = `position:absolute;top:${i * rowH}px;height:${rowH}px;width:100%;display:flex;align-items:center;padding:0 12px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
      renderItem(row, items[i], i);
      spacer.appendChild(row);
    }
  }

  container.addEventListener('scroll', render);
  return {
    setItems(next) { items = next; container.scrollTop = 0; render(); },
    destroy() { container.removeEventListener('scroll', render); spacer.remove(); },
  };
}
