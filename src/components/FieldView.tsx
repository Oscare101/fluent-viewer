import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import type { Grid } from '../types'
import { FIELD_INFO, type FieldKey } from '../data'
import { isSigned, lut, type Palette } from '../colormap'
import { drawField, fieldNaturalWidth, type FieldLayout, type FieldParams } from '../fieldplot'
import { PRINT, canvasBlob, copyBlob, fileSafe, saveBlob, screenTheme } from '../plot'
import { num } from '../format'

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
  xmax: number
  robust: boolean
  smooth: boolean
  levels: number
  palette: Palette
  Tw: number
  title: string
  pickYs: number[]
  onPick?: (y: number) => void
}

export default function FieldView(p: FieldViewProps) {
  const { grid, values, field, xmax } = p
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const layout = useRef<FieldLayout | null>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<{ x: number; y: number; v: number } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const { nx, ny, xe, ye } = grid
  const X1 = Math.min(xmax, xe[nx])
  const ncol = Math.min(nx, upper(xe, X1 - 1e-9) + 1)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // діапазон шкали й статистика по видимій області (середнє — зважене за площею)
  const st = useMemo(() => {
    let mn = Infinity, mx = -Infinity, s = 0, w = 0
    const vis: number[] = []
    for (let j = 0; j < ny; j++) {
      const dy = ye[j + 1] - ye[j]
      for (let i = 0; i < ncol; i++) {
        const v = values[j * nx + i]
        if (!Number.isFinite(v)) continue
        const dx = Math.min(xe[i + 1], X1) - xe[i]
        mn = Math.min(mn, v); mx = Math.max(mx, v)
        s += v * dx * dy; w += dx * dy
        vis.push(v)
      }
    }
    let lo = mn, hi = mx
    if (field === 'T') { lo = Math.min(lo, p.Tw); hi = Math.max(hi, p.Tw) }
    if (p.robust && vis.length > 20) {
      vis.sort((a, b) => a - b)
      lo = vis[Math.floor(vis.length * 0.01)]
      hi = vis[Math.ceil(vis.length * 0.99) - 1]
    }
    if (field === 'vf') [lo, hi] = [0, 1]
    else if (isSigned(field)) {
      const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1
      ;[lo, hi] = [-m, m]
    }
    if (hi <= lo) hi = lo + 1
    return { mn, mx, mean: s / w, lo, hi }
  }, [values, field, p.robust, p.Tw, ncol, X1, nx, ny, xe, ye])

  const info = FIELD_INFO[field]
  const params = useMemo<FieldParams>(
    () => ({ grid, values, field, xmax, lo: st.lo, hi: st.hi, lut: lut(field, p.palette), smooth: p.smooth, levels: p.levels, Tw: p.Tw, pickYs: p.pickYs, title: p.title, unit: info.unit }),
    [grid, values, field, xmax, st, p.palette, p.smooth, p.levels, p.Tw, p.pickYs, p.title, info.unit],
  )
  const H = Math.round(Math.min(680, Math.max(420, window.innerHeight * 0.68)))
  const W = Number.isFinite(xmax) ? width : Math.min(width, Math.max(260, fieldNaturalWidth(H, params, 1)))

  useEffect(() => {
    const c = cv.current
    if (!c || !W) return
    const dpr = devicePixelRatio || 1
    c.width = Math.round(W * dpr)
    c.height = Math.round(H * dpr)
    c.style.width = `${W}px`
    c.style.height = `${H}px`
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    layout.current = drawField(g, W, H, params, screenTheme(), 1, dpr)
  }, [params, W, H])

  function locate(e: PointerEvent<HTMLCanvasElement>) {
    const L = layout.current
    if (!L) return null
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left - L.x) / L.w) * L.X1
    const y = ye[0] + (1 - (e.clientY - r.top - L.y) / L.h) * (ye[ny] - ye[0])
    if (x < 0 || x > L.X1 || y < ye[0] || y > ye[ny]) return null
    const i = Math.min(upper(xe, x), ncol - 1)
    const j = upper(ye, y)
    return { x: grid.xc[i], y: grid.yc[j], v: values[j * nx + i] }
  }

  async function png(): Promise<Blob> {
    const Hx = 1100
    const fx = 2.3
    const Wx = Number.isFinite(xmax) ? 1100 : Math.round(fieldNaturalWidth(Hx, params, fx))
    const s = 2
    const c = document.createElement('canvas')
    c.width = Wx * s
    c.height = Hx * s
    const g = c.getContext('2d')!
    g.scale(s, s)
    drawField(g, Wx, Hx, params, PRINT, fx, s)
    return canvasBlob(c)
  }

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
          if (h && p.onPick) p.onPick(h.y)
        }}
      />
      <div className="chart-bar">
        <span className="chart-readout">
          {hover ? (
            <>
              x = {num(hover.x, hover.x < 1 ? 4 : 2)} мм, y = {num(hover.y, 2)} мм: <b>{fmt(hover.v)}</b> {info.unit} (значення в комірці)
            </>
          ) : (
            msg ?? 'Наведи на поле — значення в комірці; клік — профіль поперек плівки на цій висоті'
          )}
        </span>
        <span className="chart-tools">
          <button className="mini" onClick={async () => saveBlob(await png(), `${fileSafe(p.title)}.png`)}>
            PNG
          </button>
          <button
            className="mini"
            onClick={async () => {
              setMsg((await copyBlob(await png())) ? 'Скопійовано — встав у презентацію (Ctrl+V)' : 'Браузер не дозволив копіювати — збережи PNG')
              setTimeout(() => setMsg(null), 2500)
            }}
          >
            Копіювати
          </button>
        </span>
      </div>
      <p className="small muted">
        Видима область: min {fmt(st.mn)}, max {fmt(st.mx)}, середнє (за площею) {fmt(st.mean)} {info.unit}
      </p>
    </div>
  )
}
