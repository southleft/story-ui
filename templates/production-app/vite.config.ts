import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on mode
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],

    // Define environment variables to expose to the client
    define: {
      // Backend API URL - required for production
      'import.meta.env.VITE_BACKEND_URL': JSON.stringify(
        env.VITE_BACKEND_URL || 'http://localhost:4001'
      ),
      // App title customization
      'import.meta.env.VITE_APP_TITLE': JSON.stringify(
        env.VITE_APP_TITLE || 'Story UI'
      ),
    },

    // Resolve aliases for cleaner imports
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@components': path.resolve(__dirname, './src/components'),
      },
    },

    // Server configuration for development
    server: {
      port: 5173,
      strictPort: false,
      host: true, // Listen on all addresses
      // Proxy API requests to backend in development
      proxy: {
        '/mcp': {
          target: env.VITE_BACKEND_URL || 'http://localhost:4001',
          changeOrigin: true,
        },
        '/story-ui': {
          target: env.VITE_BACKEND_URL || 'http://localhost:4001',
          changeOrigin: true,
        },
      },
    },

    // Build configuration
    build: {
      outDir: 'dist',
      sourcemap: mode === 'development',
      // Optimize chunk size
      rollupOptions: {
        output: {
          manualChunks: {
            // Split vendor chunks for better caching
            'vendor-react': ['react', 'react-dom'],
            'vendor-babel': ['@babel/standalone'],
          },
        },
      },
      // Target modern browsers
      target: 'es2020',
      // Minification
      minify: 'esbuild',
    },

    // Optimize dependencies
    optimizeDeps: {
      include: ['react', 'react-dom', '@babel/standalone'],
    },

    // Preview server configuration (for testing production build locally)
    preview: {
      port: 4173,
      strictPort: false,
      host: true,
    },
  };
});
