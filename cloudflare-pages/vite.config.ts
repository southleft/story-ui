import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // Default edge URL - can be overridden at build time
    'import.meta.env.VITE_EDGE_MCP_URL': JSON.stringify(
      process.env.VITE_EDGE_MCP_URL || 'https://story-ui-mcp-edge.southleft-llc.workers.dev'
    ),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
