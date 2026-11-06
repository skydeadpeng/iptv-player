// src/storage/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSources, saveSource, removeSource,
  loadFavorites, toggleFavorite, recordPlay, getRecent,
} from './store';
import type { PlaylistSource } from '../types';

const src = (id: string): PlaylistSource => ({
  id, name: `源${id}`, importedAt: 1000, channels: [],
});

describe('store', () => {
  beforeEach(() => localStorage.clear());

  it('源的增改删查', () => {
    expect(loadSources()).toEqual([]);
    saveSource(src('a'));
    saveSource(src('b'));
    expect(loadSources()).toHaveLength(2);
    const a2 = { ...src('a'), name: '改名' };
    saveSource(a2);
    expect(loadSources()).toHaveLength(2);
    expect(loadSources().find(s => s.id === 'a')!.name).toBe('改名');
    removeSource('a');
    expect(loadSources()).toHaveLength(1);
  });

  it('收藏切换', () => {
    expect(loadFavorites()).toEqual([]);
    expect(toggleFavorite('http://a')).toBe(true);   // 加入
    expect(toggleFavorite('http://a')).toBe(false);  // 移除
    expect(loadFavorites()).toEqual([]);
    toggleFavorite('http://a');
    expect(loadFavorites()).toEqual(['http://a']);
  });

  it('最近播放去重置顶且上限 20', () => {
    for (let i = 0; i < 25; i++) recordPlay(`http://ch/${i}`);
    recordPlay('http://ch/5');                        // 已存在，置顶
    const recent = getRecent();
    expect(recent[0]).toBe('http://ch/5');
    expect(recent).toHaveLength(20);
  });

  it('存量非数组 JSON 回退默认值', () => {
    localStorage.setItem('iptv:favorites', '42');     // 合法 JSON 但非数组
    expect(loadFavorites()).toEqual([]);
    expect(toggleFavorite('http://b')).toBe(true);
    expect(loadFavorites()).toEqual(['http://b']);
  });

  it('存量损坏 JSON 回退默认值', () => {
    localStorage.setItem('iptv:recent', '{oops');     // 非法 JSON
    recordPlay('http://ch/x');
    expect(getRecent()).toEqual(['http://ch/x']);
  });
});
