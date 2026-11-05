import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const securityHeaders = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

function productionCsp(): Plugin {
  return {
    name: 'mixup-csp',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (ctx.server) return html
        const policy = [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "media-src 'self' blob:",
          "connect-src 'self' ws: wss: http: https:",
          "worker-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'self'",
          "frame-ancestors 'none'",
        ].join('; ')
        const meta = `    <meta http-equiv="Content-Security-Policy" content="${policy}" />`
        return html.replace('</head>', `${meta}\n  </head>`)
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), productionCsp()],
  server: {
    port: 5173,
    strictPort: true,
    headers: securityHeaders,
  },
  preview: {
    headers: securityHeaders,
  },
})
