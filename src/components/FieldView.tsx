import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import type { Grid } from '../types'
import { FIELD_INFO, type FieldKey } from '../data'
import { isDiverging, lut } from '../colormap'
import { num } from '../format'

const M = { l: 42, r: 8, t: 8, b: 26 }

function niceStep(span: number, target: number): number {
  const raw = span / target
  const p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? raw
}

function upper(a: ArrayLike<number>, x: number): number {
  let lo = 0
  let hi = a.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (a[m] <= x) lo = m
    else hi = m
  }
  return lo
}

export interface FieldViewProps {
  grid: Grid
  values: Float32Array
  field: FieldKey
  xmax: number // мм від стінки; Infinity — уся область
  robust: boolean // діапазон кольорів 1…99 % замість min…max
  pickY?: number | null
  onPick?: (y: number) => void
}

export default function FieldView({ grid, values, field, xmax, robust, pickY, onPick }: FieldViewProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const bar = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(320)
  const [hover, setHover] = useState<{ x: number; y: number; v: number } | null>(null)
  const { nx, ny, xe, ye } = grid
  const X1 = Math.min(xmax, xe[nx])
  const ncol = Math.min(nx, upper(xe, X1 - 1e-9) + 1)
  const full = !Number.isFinite(xmax)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // статистика й діапазон кольорів по видимій області (середнє — зважене за площею комірок)
  const st = useMemo(() => {
    let mn = Infinity, mx = -Infinity, s = 0, w = 0
    const vis: number[] = []
    for (let j = 0; j < ny; j++) {
      const dy = ye[j + 1] - ye[j]
      for (let i = 0; i < ncol; i++) {
        const v = values[j * nx + i]
        if (!Number.isFinite(v)) continue
        const dx = Math.min(xe[i + 1], X1) - xe[i]
        mn = Math.min(mn, v)
        mx = Math.max(mx, v)
        s += v * dx * dy
        w += dx * dy
        vis.push(v)
      }
    }
    let lo = mn, hi = mx
    if (robust && vis.length > 20) {
      vis.sort((a, b) => a - b)
      lo = vis[Math.floor(vis.length * 0.01)]
      hi = vis[Math.ceil(vis.length * 0.99) - 1]
    }
    if (field === 'vf') [lo, hi] = [0, 1]
    else if (isDiverging(field)) {
      const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1
      ;[lo, hi] = [-m, m]
    }
    if (hi <= lo) hi = lo + 1
    return { mn, mx, mean: s / w, lo, hi }
  }, [values, field, robust, ncol, X1, nx, ny, xe, ye])

  const H = Math.round(Math.min(620, Math.max(380, window.innerHeight * 0.62)))
  const ph = H - M.t - M.b
  const pwFull = full ? Math.min(width - M.l - M.r, (ph * X1) / (ye[ny] - ye[0])) : width - M.l - M.r
  const pw = Math.max(60, pwFull)
  const W = full ? Math.min(width, pw + M.l + M.r) : width
  const sx = (x: number) => M.l + (x / X1) * pw
  const sy = (y: number) => M.t + (1 - (y - ye[0]) / (ye[ny] - ye[0])) * ph

  useEffect(() => {
    const c = cv.current
    if (!c) return
    const dpr = devicePixelRatio || 1
    c.width = W * dpr
    c.height = H * dpr
    c.style.width = `${W}px`
    c.style.height = `${H}px`
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, H)
    const t = lut(field)
    for (let j = 0; j < ny; j++) {
      const y0 = Math.floor(sy(ye[j + 1]))
      const y1 = Math.ceil(sy(ye[j]))
      for (let i = 0; i < ncol; i++) {
        const v = values[j * nx + i]
        if (!Number.isFinite(v)) continue
        const k = Math.max(0, Math.min(255, Math.round(((v - st.lo) / (st.hi - st.lo)) * 255))) * 3
        g.fillStyle = `rgb(${t[k]},${t[k + 1]},${t[k + 2]})`
        const x0 = Math.floor(sx(xe[i]))
        const x1 = Math.ceil(sx(Math.min(xe[i + 1], X1)))
        g.fillRect(x0, y0, x1 - x0, y1 - y0)
      }
    }
    // гаряча стінка
    const css = getComputedStyle(document.documentElement)
    const text = css.getPropertyValue('--muted').trim() || '#666'
    g.strokeStyle = '#e0302a'
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(sx(0) - 1.5, sy(grid.hot_wall_y_mm[0]))
    g.lineTo(sx(0) - 1.5, sy(grid.hot_wall_y_mm[1]))
    g.stroke()
    // вибрана висота
    if (pickY !== null && pickY !== undefined) {
      g.strokeStyle = css.getPropertyValue('--text').trim() || '#000'
      g.lineWidth = 1
      g.setLineDash([4, 3])
      g.beginPath()
      g.moveTo(M.l, Math.round(sy(pickY)) + 0.5)
      g.lineTo(M.l + pw, Math.round(sy(pickY)) + 0.5)
      g.stroke()
      g.setLineDash([])
    }
    // осі
    g.fillStyle = text
    g.strokeStyle = text
    g.lineWidth = 1
    g.font = '11px system-ui, sans-serif'
    g.textAlign = 'right'
    g.textBaseline = 'middle'
    for (let y = 0; y <= ye[ny] + 1e-9; y += 10) {
      g.fillText(`${y}`, M.l - 6, sy(y))
      g.beginPath()
      g.moveTo(M.l - 3, Math.round(sy(y)) + 0.5)
      g.lineTo(M.l, Math.round(sy(y)) + 0.5)
      g.stroke()
    }
    const xs = niceStep(X1, Math.max(2, Math.floor(pw / 60)))
    g.textAlign = 'center'
    g.textBaseline = 'top'
    for (let x = 0; x <= X1 + 1e-9; x += xs) {
      g.fillText(num(x, xs < 0.1 ? 2 : xs < 1 ? 1 : 0), sx(x), H - M.b + 5)
      g.beginPath()
      g.moveTo(Math.round(sx(x)) + 0.5, H - M.b)
      g.lineTo(Math.round(sx(x)) + 0.5, H - M.b + 3)
      g.stroke()
    }
    g.save()
    g.translate(11, M.t + ph / 2)
    g.rotate(-Math.PI / 2)
    g.textBaseline = 'middle'
    g.fillText('y, мм', 0, 0)
    g.restore()
  }, [values, field, st, W, H, pw, ph, ncol, X1, pickY, grid, nx, ny, xe, ye])

  // шкала кольорів
  useEffect(() => {
    const c = bar.current
    if (!c) return
    const w = Math.max(120, Math.min(W, 420))
    const dpr = devicePixelRatio || 1
    c.width = w * dpr
    c.height = 12 * dpr
    c.style.width = `${w}px`
    c.style.height = '12px'
    const g = c.getContext('2d')!
    const t = lut(field)
    for (let i = 0; i < c.width; i++) {
      const k = Math.round((i / (c.width - 1)) * 255) * 3
      g.fillStyle = `rgb(${t[k]},${t[k + 1]},${t[k + 2]})`
      g.fillRect(i, 0, 1, c.height)
    }
  }, [field, W])

  function locate(e: PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    const py = e.clientY - r.top
    const x = ((px - M.l) / pw) * X1
    const y = ye[0] + (1 - (py - M.t) / ph) * (ye[ny] - ye[0])
    if (x < 0 || x > X1 || y < ye[0] || y > ye[ny]) return null
    const i = Math.min(upper(xe, x), ncol - 1)
    const j = upper(ye, y)
    return { x: grid.xc[i], y: grid.yc[j], v: values[j * nx + i] }
  }

  const info = FIELD_INFO[field]
  const fmt = (v: number) => (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-2 && v !== 0) ? v.toExponential(3) : num(v, field === 'vf' ? 3 : 2))
  return (
    <div className="field" ref={wrap}>
      <canvas
        ref={cv}
        className="field-canvas"
        onPointerMove={(e) => setHover(locate(e))}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => {
          const h = locate(e)
          setHover(h)
          if (h && onPick) onPick(h.y)
        }}
      />
      <div className="field-legend">
        <canvas ref={bar} />
        <div className="field-scale">
          <span>{fmt(st.lo)}</span>
          <span>
            {info.label}
            {info.unit && `, ${info.unit}`}
          </span>
          <span>{fmt(st.hi)}</span>
        </div>
      </div>
      <p className="small field-readout">
        {hover ? (
          <>
            x = {num(hover.x, hover.x < 1 ? 4 : 2)} мм від стінки, y = {num(hover.y, 2)} мм: <b>{fmt(hover.v)}</b> {info.unit}
          </>
        ) : (
          <span className="muted">Наведи (або торкнись) комірку, щоб побачити значення; клік — профіль поперек плівки на цій висоті.</span>
        )}
      </p>
      <p className="small muted">
        Видима область: min {fmt(st.mn)}, max {fmt(st.mx)}, середнє (за площею) {fmt(st.mean)} {info.unit}
      </p>
    </div>
  )
}
