import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      exclude: ['fs']
    }),
  ],
  resolve: {
    alias: {
      'fs/promises': path.resolve(__dirname, 'empty.js'),
      'fs': path.resolve(__dirname, 'empty.js'),
    }
  }
})
