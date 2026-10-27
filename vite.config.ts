import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Tauri 期望固定端口，且失败时不自动切换端口。
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // src-tauri 由 cargo 自己监听，避免无谓的重启
      ignored: ['**/src-tauri/**'],
    },
  },
  // 离线要求：所有资源必须打进产物，禁止运行时从 CDN 拉取
  build: {
    target: 'chrome105',
    sourcemap: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      output: {
        manualChunks: {
          milkdown: ['@milkdown/crepe', '@milkdown/kit'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
