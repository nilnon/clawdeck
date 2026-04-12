import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  // 加载 .env 文件中的环境变量
  const env = loadEnv(mode, process.cwd(), '')
  
  const devPort = parseInt(env.VITE_DEV_PORT || '4096')
  const apiUrl = env.VITE_API_URL || `http://localhost:${env.PORT || '4098'}`
  const wsUrl = apiUrl.replace('http://', 'ws://')
  
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@server': path.resolve(__dirname, 'server'),
        '@shared': path.resolve(__dirname, 'shared'),
      },
    },
    server: {
      port: devPort,
      proxy: {
        '/api': {
          target: apiUrl,
          changeOrigin: true,
        },
        '/ws': {
          target: wsUrl,
          ws: true,
        },
      },
    },
  }
})