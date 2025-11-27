import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // Edge MCP URL - REQUIRED: Set via VITE_EDGE_MCP_URL environment variable
    // Example: VITE_EDGE_MCP_URL=https://your-worker.your-account.workers.dev npm run build
    'import.meta.env.VITE_EDGE_MCP_URL': JSON.stringify(
      process.env.VITE_EDGE_MCP_URL || ''
    ),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
