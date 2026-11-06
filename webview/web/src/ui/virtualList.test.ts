// src/ui/virtualList.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createVirtualList } from './virtualList';
import { Channel } from '../types';

const ch = (i: number): Channel => ({ name: `台${i}`, url: `http://u/${i}`, group: 'g' });

beforeEach(() => {
  document.body.innerHTML = '<div id="list" style="height:480px"></div>';
  // jsdom 无布局，mock 尺寸
  Object.defineProperty(document.getElementById('list')!, 'clientHeight', { value: 480 });
});

function mounted(): HTMLElement[] {
  return Array.from(document.getElementById('list')!.querySelectorAll('.row'));
}

describe('virtualList', () => {
  it('只渲染可视区 + overscan 的行（1000 条数据）', () => {
    const vl = createVirtualList(document.getElementById('list')!, {
      rowH: 48, overscan: 10, renderItem: (el, item) => { el.textContent = item.name; },
    });
    vl.setItems(Array.from({ length: 1000 }, (_, i) => ch(i)));
    const rows = mounted();
    expect(rows.length).toBeLessThanOrEqual(10 + 10 * 2);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows[0].textContent).toBe('台0');
  });

  it('滚动后窗口平移', () => {
    const vl = createVirtualList(document.getElementById('list')!, {
      rowH: 48, overscan: 0, renderItem: (el, item) => { el.textContent = item.name; },
    });
    vl.setItems(Array.from({ length: 1000 }, (_, i) => ch(i)));
    const list = document.getElementById('list')!;
    list.scrollTop = 48 * 100;                       // 滚到第 100 行
    list.dispatchEvent(new Event('scroll'));
    expect(mounted()[0].textContent).toBe('台100');
  });
});
