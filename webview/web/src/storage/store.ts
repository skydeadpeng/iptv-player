// src/storage/store.ts
import { PlaylistSource } from '../types';

const K_SOURCES = 'iptv:sources';
const K_FAVS = 'iptv:favorites';
const K_RECENT = 'iptv:recent';
const RECENT_MAX = 20;

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function writeJSON(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadSources(): PlaylistSource[] {
  return readJSON<PlaylistSource[]>(K_SOURCES, []);
}
export function saveSource(src: PlaylistSource): void {
  const all = loadSources().filter(s => s.id !== src.id);
  all.push(src);
  writeJSON(K_SOURCES, all);
}
export function removeSource(id: string): void {
  writeJSON(K_SOURCES, loadSources().filter(s => s.id !== id));
}

export function loadFavorites(): string[] {
  return readJSON<string[]>(K_FAVS, []);
}
export function toggleFavorite(url: string): boolean {
  const favs = loadFavorites();
  const idx = favs.indexOf(url);
  if (idx >= 0) favs.splice(idx, 1); else favs.unshift(url);
  writeJSON(K_FAVS, favs);
  return idx < 0;
}

export function recordPlay(url: string): void {
  const recent = getRecent().filter(u => u !== url);
  recent.unshift(url);
  writeJSON(K_RECENT, recent.slice(0, RECENT_MAX));
}
export function getRecent(max = RECENT_MAX): string[] {
  return readJSON<string[]>(K_RECENT, []).slice(0, max);
}
