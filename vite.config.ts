import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Content-Security-Policy лише в зібраному сайті (dev-сервер Vite вставляє inline-скрипти).
// Сторінка може ходити тільки на api.github.com — токен нікуди більше не потрапить.
const csp: Plugin = {
  name: 'csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src https://api.github.com; base-uri 'none'; form-action 'none'; object-src 'none'" />`,
    ),
}

// Лише для `npm run dev`: віддає файли з сусідньої папки ../fluent-data, щоб розробляти без токена (?local).
const localData: Plugin = {
  name: 'local-data',
  apply: 'serve',
  configureServer(server) {
    const root = path.resolve(__dirname, '../fluent-data')
    server.middlewares.use('/__data', (req, res) => {
      const url = decodeURIComponent((req.url ?? '').split('?')[0])
      if (url === '/tree') {
        const out: { path: string; sha: string; size: number }[] = []
        const walk = (dir: string) => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (['.git', 'inbox', '__pycache__'].includes(e.name)) continue
            const full = path.join(dir, e.name)
            if (e.isDirectory()) walk(full)
            else {
              const st = fs.statSync(full)
              const rel = path.relative(root, full).split(path.sep).join('/')
              out.push({ path: rel, sha: `${rel}:${st.size}:${st.mtimeMs}`, size: st.size })
            }
          }
        }
        walk(root)
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(out))
        return
      }
      const file = path.resolve(root, '.' + url)
      if (!file.startsWith(root) || !fs.existsSync(file)) {
        res.statusCode = 404
        res.end()
        return
      }
      res.end(fs.readFileSync(file))
    })
  },
}

export default defineConfig({
  base: '/fluent-viewer/',
  plugins: [react(), csp, localData],
})
