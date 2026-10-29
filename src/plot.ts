// Рендер графіків у стилі matplotlib на Canvas: один і той самий код малює на екрані й у PNG для презентацій.

export type Col = ArrayLike<number | null>
export type ChartData = [ArrayLike<number>, ...Col[]]

// matplotlib tab10 — ті самі кольори, що в графіках з Python
export const PALETTE = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f']

export interface ChartSeries {
  label: string
  color?: string
  dash?: number[]
  width?: number
  points?: boolean
  stepped?: boolean
  spanGaps?: boolean
}

export interface Marker {
  x: number
  color: string
  dash?: number[]
}

export interface PlotSpec {
  data: ChartData
  series: ChartSeries[]
  title?: string
  xLabel?: string
  yLabel?: string
  logY?: boolean
  yRange?: [number | null, number | null]
  xRange?: [number, number]
  markers?: Marker[]
  bands?: [number, number][]
  robustY?: boolean // вісь y за 0.5…99.5 % видимих точок (поодинокі сплески не стискають графік)
}

export interface Theme {
  bg: string
  fg: string
  grid: string
  legendBg: string
  legendLine: string
  band: string
}

export const PRINT: Theme = {
  bg: '#ffffff', fg: '#000000', grid: 'rgba(128,128,128,0.55)', legendBg: 'rgba(255,255,255,0.92)', legendLine: '#cccccc',
  band: 'rgba(44,160,44,0.10)',
}

export function screenTheme(): Theme {
  const css = getComputedStyle(document.documentElement)
  const v = (n: string, f: string) => css.getPropertyValue(n).trim() || f
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
  return dark
    ? { bg: v('--surface', '#1f1f1d'), fg: v('--text', '#eee'), grid: 'rgba(160,160,160,0.35)', legendBg: 'rgba(31,31,29,0.92)', legendLine: '#555', band: 'rgba(120,200,120,0.12)' }
    : PRINT
}

export interface View {
  x0: number
  x1: number
  y0: number
  y1: number
}

export interface Layout {
  x: number
  y: number
  w: number
  h: number
  view: View
  log: boolean
}

function finite(v: number | null | undefined): v is number {
  return v !== null && v !== undefined && Number.isFinite(v)
}

export function computeView(s: PlotSpec, xr?: [number, number] | null): View {
  const xs = s.data[0]
  let x0 = Infinity, x1 = -Infinity
  for (let i = 0; i < xs.length; i++) if (finite(xs[i])) { x0 = Math.min(x0, xs[i]); x1 = Math.max(x1, xs[i]) }
  if (s.xRange) [x0, x1] = s.xRange
  if (xr) [x0, x1] = xr
  if (!(x1 > x0)) { x0 -= 1; x1 += 1 }
  let y0 = Infinity, y1 = -Infinity
  const vis: number[] = []
  for (let k = 1; k < s.data.length; k++) {
    const ys = s.data[k]
    for (let i = 0; i < xs.length; i++) {
      const v = ys[i]
      if (!finite(v) || xs[i] < x0 || xs[i] > x1 || (s.logY && v <= 0)) continue
      y0 = Math.min(y0, v)
      y1 = Math.max(y1, v)
      if (s.robustY) vis.push(v)
    }
  }
  if (s.robustY && vis.length > 50) {
    vis.sort((a, b) => a - b)
    y0 = vis[Math.floor(vis.length * 0.005)]
    y1 = vis[Math.ceil(vis.length * 0.995) - 1]
  }
  if (!Number.isFinite(y0)) { y0 = s.logY ? 1e-12 : 0; y1 = s.logY ? 1 : 1 }
  if (s.logY) {
    y0 = 10 ** Math.floor(Math.log10(y0) - 0.05)
    y1 = 10 ** Math.ceil(Math.log10(y1) + 0.05)
  } else {
    const pad = (y1 - y0 || Math.abs(y1) || 1) * 0.05
    y0 -= pad
    y1 += pad
  }
  if (s.yRange) {
    if (finite(s.yRange[0])) y0 = s.yRange[0]
    if (finite(s.yRange[1])) y1 = s.yRange[1]
  }
  if (!(y1 > y0)) y1 = y0 + 1
  return { x0, x1, y0, y1 }
}

export function niceTicks(lo: number, hi: number, n: number): { ticks: number[]; step: number } {
  const raw = (hi - lo) / Math.max(1, n)
  const p = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((v) => v >= raw) ?? raw
  const ticks: number[] = []
  for (let t = Math.ceil(lo / step - 1e-9) * step; t <= hi + step * 1e-9; t += step) ticks.push(Math.abs(t) < step * 1e-9 ? 0 : t)
  return { ticks, step }
}

/** 1.5e+5 → 1.5e+05 (як у Fluent і matplotlib). */
export function expo(v: number, digits: number): string {
  return v.toExponential(digits).replace(/e([+-])(\d)$/, 'e$10$2')
}

export function fmtTick(v: number, step: number): string {
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1e5 || a < 1e-3) return expo(v, Math.max(0, Math.min(3, Math.ceil(Math.log10(a / step) - 1e-9))))
  const d = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)))
  return v.toFixed(d)
}

function font(px: number, bold = false): string {
  return `${bold ? 'bold ' : ''}${px}px "DejaVu Sans", "Segoe UI", system-ui, sans-serif`
}

/** Малює графік; повертає розкладку (для наведення курсору). f — масштаб шрифтів/ліній (для PNG). */
export function drawPlot(g: CanvasRenderingContext2D, W: number, H: number, s: PlotSpec, view: View, th: Theme, f = 1): Layout {
  const log = !!s.logY
  g.save()
  g.fillStyle = th.bg
  g.fillRect(0, 0, W, H)
  const tickF = font(11 * f), labF = font(12.5 * f, true), titF = font(13.5 * f, true)

  // y-тіки
  let yt: number[]
  let ystep = 1
  if (log) {
    yt = []
    for (let e = Math.ceil(Math.log10(view.y0) - 1e-9); e <= Math.floor(Math.log10(view.y1) + 1e-9); e++) yt.push(10 ** e)
  } else {
    const r = niceTicks(view.y0, view.y1, Math.max(3, Math.round(H / (55 * f))))
    yt = r.ticks
    ystep = r.step
  }
  const ylab = (v: number) => (log ? `1e${Math.round(Math.log10(v))}` : fmtTick(v, ystep))
  g.font = tickF
  const yw = Math.max(0, ...yt.map((v) => g.measureText(ylab(v)).width))
  const L = Math.round(8 * f + (s.yLabel ? 20 * f : 0) + yw + 8 * f)
  const T = Math.round(s.title ? 30 * f : 10 * f)
  const B = Math.round(10 * f + 14 * f + (s.xLabel ? 22 * f : 0))
  const R = Math.round(14 * f)
  const P = { x: L, y: T, w: Math.max(10, W - L - R), h: Math.max(10, H - T - B) }
  const X = (x: number) => P.x + ((x - view.x0) / (view.x1 - view.x0)) * P.w
  const Y = log
    ? (y: number) => P.y + P.h * (1 - (Math.log10(y) - Math.log10(view.y0)) / (Math.log10(view.y1) - Math.log10(view.y0)))
    : (y: number) => P.y + P.h * (1 - (y - view.y0) / (view.y1 - view.y0))

  // заголовок
  if (s.title) {
    g.fillStyle = th.fg
    g.font = titF
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(s.title, P.x + P.w / 2, T / 2 + 1, W - 8)
  }

  g.save()
  g.beginPath()
  g.rect(P.x, P.y, P.w, P.h)
  g.clip()
  // вікна
  for (const [a, b] of s.bands ?? []) {
    g.fillStyle = th.band
    g.fillRect(X(a), P.y, X(b) - X(a), P.h)
  }
  // сітка
  const { ticks: xt, step: xstep } = niceTicks(view.x0, view.x1, Math.max(3, Math.round(P.w / (85 * f))))
  g.strokeStyle = th.grid
  g.lineWidth = 0.8 * f
  g.setLineDash([1.5 * f, 2.5 * f])
  g.beginPath()
  for (const t of xt) { g.moveTo(Math.round(X(t)) + 0.5, P.y); g.lineTo(Math.round(X(t)) + 0.5, P.y + P.h) }
  for (const t of yt) { g.moveTo(P.x, Math.round(Y(t)) + 0.5); g.lineTo(P.x + P.w, Math.round(Y(t)) + 0.5) }
  g.stroke()
  // маркери
  for (const m of s.markers ?? []) {
    if (m.x < view.x0 || m.x > view.x1) continue
    g.strokeStyle = m.color
    g.lineWidth = 1 * f
    g.setLineDash((m.dash ?? [3, 3]).map((d) => d * f))
    g.beginPath()
    g.moveTo(Math.round(X(m.x)) + 0.5, P.y)
    g.lineTo(Math.round(X(m.x)) + 0.5, P.y + P.h)
    g.stroke()
  }
  // криві
  const xs = s.data[0]
  s.series.forEach((se, k) => {
    const ys = s.data[k + 1]
    const color = se.color ?? PALETTE[k % PALETTE.length]
    g.strokeStyle = color
    g.fillStyle = color
    g.lineWidth = (se.width ?? 2) * f
    g.setLineDash((se.dash ?? []).map((d) => d * f))
    g.lineJoin = 'round'
    if (se.points) {
      for (let i = 0; i < xs.length; i++) {
        const v = ys[i]
        if (!finite(v) || (log && v <= 0)) continue
        g.beginPath()
        g.arc(X(xs[i]), Y(v), 2.2 * f, 0, Math.PI * 2)
        g.fill()
      }
      return
    }
    g.beginPath()
    let pen = false
    let py = 0
    for (let i = 0; i < xs.length; i++) {
      const v = ys[i]
      if (!finite(v) || (log && v <= 0)) {
        if (!se.spanGaps) pen = false
        continue
      }
      const x = X(xs[i]), y = Y(v)
      if (!pen) g.moveTo(x, y)
      else if (se.stepped) { g.lineTo(x, py); g.lineTo(x, y) }
      else g.lineTo(x, y)
      pen = true
      py = y
    }
    g.stroke()
  })
  g.restore()

  // рамка, тіки, підписи
  g.setLineDash([])
  g.strokeStyle = th.fg
  g.fillStyle = th.fg
  g.lineWidth = 1 * f
  g.strokeRect(Math.round(P.x) + 0.5, Math.round(P.y) + 0.5, Math.round(P.w), Math.round(P.h))
  g.font = tickF
  g.textAlign = 'center'
  g.textBaseline = 'top'
  g.beginPath()
  for (const t of xt) {
    const x = Math.round(X(t)) + 0.5
    g.moveTo(x, P.y + P.h)
    g.lineTo(x, P.y + P.h + 4 * f)
    g.fillText(fmtTick(t, xstep), x, P.y + P.h + 6 * f)
  }
  g.textAlign = 'right'
  g.textBaseline = 'middle'
  for (const t of yt) {
    const y = Math.round(Y(t)) + 0.5
    g.moveTo(P.x - 4 * f, y)
    g.lineTo(P.x, y)
    g.fillText(ylab(t), P.x - 6 * f, y)
  }
  g.stroke()
  g.font = labF
  if (s.xLabel) {
    g.textAlign = 'center'
    g.textBaseline = 'bottom'
    g.fillText(s.xLabel, P.x + P.w / 2, H - 4 * f, W - 8)
  }
  if (s.yLabel) {
    g.save()
    g.translate(6 * f + 8 * f, P.y + P.h / 2)
    g.rotate(-Math.PI / 2)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(s.yLabel, 0, 0, P.h)
    g.restore()
  }

  // легенда («best»: кут, де найменше точок)
  const items = s.series.filter((se) => se.label)
  if (items.length) {
    g.font = font(11 * f)
    const rowH = 17 * f, sample = 26 * f, pad = 7 * f
    const lw = Math.min(P.w - 10 * f, pad * 2 + sample + 6 * f + Math.max(...items.map((se) => g.measureText(se.label).width)))
    const lh = pad * 2 + rowH * items.length - 3 * f
    const corners = [
      [P.x + P.w - lw - 8 * f, P.y + 8 * f],
      [P.x + 8 * f, P.y + 8 * f],
      [P.x + 8 * f, P.y + P.h - lh - 8 * f],
      [P.x + P.w - lw - 8 * f, P.y + P.h - lh - 8 * f],
    ]
    const score = (cx: number, cy: number) => {
      let n = 0
      for (let k = 1; k < s.data.length; k++) {
        const ys = s.data[k]
        const stepI = Math.max(1, Math.floor(xs.length / 400))
        for (let i = 0; i < xs.length; i += stepI) {
          const v = ys[i]
          if (!finite(v)) continue
          const px = X(xs[i]), py = Y(v)
          if (px >= cx && px <= cx + lw && py >= cy && py <= cy + lh) n++
        }
      }
      return n
    }
    let best = corners[0]
    let bs = Infinity
    for (const c of corners) {
      const sc = score(c[0], c[1])
      if (sc < bs) { bs = sc; best = c }
    }
    const [lx, ly] = best
    g.fillStyle = th.legendBg
    g.strokeStyle = th.legendLine
    g.lineWidth = 1 * f
    g.beginPath()
    g.roundRect(lx, ly, lw, lh, 3 * f)
    g.fill()
    g.stroke()
    g.textAlign = 'left'
    g.textBaseline = 'middle'
    items.forEach((se) => {
      const k = s.series.indexOf(se)
      const color = se.color ?? PALETTE[k % PALETTE.length]
      const cy = ly + pad + rowH * items.indexOf(se) + rowH / 2 - 1.5 * f
      g.strokeStyle = color
      g.fillStyle = color
      g.lineWidth = (se.width ?? 2) * f
      g.setLineDash((se.dash ?? []).map((d) => d * f))
      if (se.points) {
        g.beginPath()
        g.arc(lx + pad + sample / 2, cy, 2.5 * f, 0, Math.PI * 2)
        g.fill()
      } else {
        g.beginPath()
        g.moveTo(lx + pad, cy)
        g.lineTo(lx + pad + sample, cy)
        g.stroke()
      }
      g.setLineDash([])
      g.fillStyle = th.fg
      g.fillText(se.label, lx + pad + sample + 6 * f, cy, lw - sample - pad * 2 - 6 * f)
    })
  }
  g.restore()
  return { ...P, view, log }
}

/** Індекс найближчої за x точки (xs відсортований). */
export function nearestIndex(xs: ArrayLike<number>, x: number): number {
  let lo = 0
  let hi = xs.length - 1
  if (hi < 0) return -1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (xs[m] <= x) lo = m
    else hi = m
  }
  return Math.abs(xs[hi] - x) < Math.abs(xs[lo] - x) ? hi : lo
}

export function fileSafe(s: string): string {
  return (s || 'figure').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80)
}

export async function canvasBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG не створено'))), 'image/png'))
}

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Копіює PNG у буфер обміну (Ctrl+V у PowerPoint/Word). false — браузер не дозволив. */
export async function copyBlob(blob: Blob): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}
