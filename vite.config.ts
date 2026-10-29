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

export default defineConfig({
  base: '/fluent-viewer/',
  plugins: [react(), csp],
})
