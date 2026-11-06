import { defineConfig } from 'vite';
export default defineConfig({
  base: './',            // 壳内 assets 相对路径加载必需
  build: { target: 'es2020' },
  test: { environment: 'jsdom' },
});
