import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const tlsDirectory = join(
  process.env.LOCALAPPDATA ?? homedir(),
  'PowerGridMonitor',
  'certs',
)
const certificatePath = join(tlsDirectory, 'localhost.crt')
const keyPath = join(tlsDirectory, 'localhost.key')
const tls = existsSync(certificatePath) && existsSync(keyPath)
  ? { cert: readFileSync(certificatePath), key: readFileSync(keyPath) }
  : undefined

export default defineConfig({
  plugins: [react()],
  server: {
    https: tls,
    headers: {
      'Content-Security-Policy': "default-src 'self'; base-uri 'self'; connect-src 'self' ws: wss:; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: https://*.tile.openstreetmap.org; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';",
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      ...(tls ? { 'Strict-Transport-Security': 'max-age=86400' } : {}),
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})