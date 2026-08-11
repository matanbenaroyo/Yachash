import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import path from 'path';

export default defineConfig({
  // Emit relative asset URLs. The packaged app is loaded via
  // mainWindow.loadFile(dist/index.html) over the file:// protocol, so the
  // default absolute base ('/') would resolve /assets/* against the filesystem
  // root and render a blank window. Vite forces base back to '/' in dev, so the
  // dev server is unaffected.
  base: './',
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            target: 'node18',
            minify: false,
            rollupOptions: {
              external: (id) => {
                // Always externalize electron and native modules
                if (id === 'electron' || id.startsWith('electron/')) return true;
                if (id === 'electron-updater') return true; // Auto-updater
                if (id === 'better-sqlite3') return true;
                if (id === 'node-machine-id') return true; // Native module
                
                // Externalize main dependencies (Supabase will be bundled)
                const externalPackages = [
                  '@anthropic-ai/sdk',
                  'whatsapp-web.js',
                  'puppeteer',
                  'qrcode',
                  'xlsx',
                  'date-fns'
                ];
                
                return externalPackages.some(pkg => id === pkg || id.startsWith(pkg + '/'));
              },
              output: {
                format: 'cjs',
                entryFileNames: '[name].js',
                chunkFileNames: '[name].js',
                assetFileNames: '[name].[ext]'
              }
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            target: 'node18',
            rollupOptions: {
              external: ['electron'],
              output: {
                format: 'cjs',
                entryFileNames: '[name].js'
              }
            }
          }
        }
      }
    ])
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 5173
  },
  optimizeDeps: {
    exclude: ['@whiskeysockets/baileys']
  }
});
