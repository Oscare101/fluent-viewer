import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import {
  PRINT, canvasBlob, computeView, copyBlob, drawPlot, fileSafe, nearestIndex, saveBlob, screenTheme,
  type ChartData, type ChartSeries, type Layout, type Marker, type PlotSpec,
} from '../plot'

export { PALETTE } from '../plot'
export type { ChartData, ChartSeries, Marker } from '../plot'

export interface ChartProps {
  data: ChartData
  series: ChartSeries[]
  title?: string
  xLabel?: string
  yLabel?: string
  height?: number
  logY?: boolean
  yRange?: [number | null, number | null]
  xRange?: [number, number]
  markers?: Marker[]
  bands?: [number, number][]
  robustY?: boolean
  syncKey?: string
}

// Синхронізація курсора й зуму між графіками з однаковим syncKey.
interface Peer {
  setXr: (r: [number, number] | null) => void
  setHover: (x: number | null) => void
}
const groups = new Map<string, Set<Peer>>()

// Розмір PNG для презентації (логічні пікселі; файл — удвічі більший).
const EXPORT_W = 1000
const EXPORT_H = 680

function valueText(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  return a !== 0 && (a < 1e-3 || a >= 1e6) ? v.toExponential(3) : v.toPrecision(5).replace(/\.?0+$/, '')
}

export default function Chart(p: ChartProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const base = useRef<HTMLCanvasElement>(null)
  const over = useRef<HTMLCanvasElement>(null)
  const layout = useRef<Layout | null>(null)
  const [width, setWidth] = useState(0)
  const [xr, setXr] = useState<[number, number] | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [drag, setDrag] = useState<[number, number] | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const H = p.height ?? 300

  const spec = useMemo<PlotSpec>(
    () => ({ data: p.data, series: p.series, title: p.title, xLabel: p.xLabel, yLabel: p.yLabel, logY: p.logY, yRange: p.yRange, xRange: p.xRange, markers: p.markers, bands: p.bands, robustY: p.robustY }),
    [p.data, p.series, p.title, p.xLabel, p.yLabel, p.logY, p.yRange, p.xRange, p.markers, p.bands, p.robustY],
  )
  const view = useMemo(() => computeView(spec, xr), [spec, xr])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!p.syncKey) return
    const peer: Peer = { setXr, setHover }
    if (!groups.has(p.syncKey)) groups.set(p.syncKey, new Set())
    groups.get(p.syncKey)!.add(peer)
    return () => void groups.get(p.syncKey!)?.delete(peer)
  }, [p.syncKey])

  const broadcast = (fn: (peer: Peer) => void) => p.syncKey && groups.get(p.syncKey)?.forEach(fn)
  const zoom = (r: [number, number] | null) => (p.syncKey ? broadcast((o) => o.setXr(r)) : setXr(r))
  const hoverAll = (x: number | null) => (p.syncKey ? broadcast((o) => o.setHover(x)) : setHover(x))

  // основний шар
  useEffect(() => {
    const c = base.current
    if (!c || !width) return
    const dpr = devicePixelRatio || 1
    c.width = Math.round(width * dpr)
    c.height = Math.round(H * dpr)
    c.style.width = `${width}px`
    c.style.height = `${H}px`
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    layout.current = drawPlot(g, width, H, spec, view, screenTheme())
  }, [spec, view, width, H])

  // шар курсора й виділення
  useEffect(() => {
    const c = over.current
    const L = layout.current
    if (!c || !width || !L) return
    const dpr = devicePixelRatio || 1
    c.width = Math.round(width * dpr)
    c.height = Math.round(H * dpr)
    c.style.width = `${width}px`
    c.style.height = `${H}px`
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, H)
    const X = (x: number) => L.x + ((x - L.view.x0) / (L.view.x1 - L.view.x0)) * L.w
    if (drag) {
      g.fillStyle = 'rgba(31,119,180,0.15)'
      g.fillRect(Math.min(drag[0], drag[1]), L.y, Math.abs(drag[1] - drag[0]), L.h)
    }
    if (hover !== null && hover >= L.view.x0 && hover <= L.view.x1) {
      g.strokeStyle = 'rgba(128,128,128,0.8)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(Math.round(X(hover)) + 0.5, L.y)
      g.lineTo(Math.round(X(hover)) + 0.5, L.y + L.h)
      g.stroke()
    }
  }, [hover, drag, width, H, view, spec])

  const readout = useMemo(() => {
    if (hover === null) return null
    const xs = spec.data[0]
    const i = nearestIndex(xs, hover)
    if (i < 0) return null
    const vals = spec.series.map((se, k) => {
      const ys = spec.data[k + 1]
      // для об'єднаної осі x кількох розрахунків — найближче непорожнє значення
      for (let d = 0; d < 60; d++) {
        for (const j of [i - d, i + d]) if (j >= 0 && j < xs.length && ys[j] !== null && Number.isFinite(ys[j] as number)) return [se.label, ys[j]] as const
      }
      return [se.label, null] as const
    })
    return { x: xs[i], vals }
  }, [hover, spec])

  function toX(e: PointerEvent<HTMLCanvasElement>): { px: number; x: number } | null {
    const L = layout.current
    if (!L) return null
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left
    if (px < L.x || px > L.x + L.w) return null
    return { px, x: L.view.x0 + ((px - L.x) / L.w) * (L.view.x1 - L.view.x0) }
  }

  async function exportPng(): Promise<Blob> {
    const c = document.createElement('canvas')
    const s = 2
    c.width = EXPORT_W * s
    c.height = EXPORT_H * s
    const g = c.getContext('2d')!
    g.scale(s, s)
    drawPlot(g, EXPORT_W, EXPORT_H, spec, view, PRINT, 1.35)
    return canvasBlob(c)
  }

  function exportCsv() {
    const xs = spec.data[0]
    const head = [p.xLabel ?? 'x', ...spec.series.map((s) => s.label)].map((h) => `"${h.replace(/"/g, '""')}"`).join(';')
    const rows = [head]
    for (let i = 0; i < xs.length; i++) {
      if (xs[i] < view.x0 || xs[i] > view.x1) continue
      const r = [xs[i], ...spec.series.map((_, k) => spec.data[k + 1][i])]
      if (r.slice(1).every((v) => v === null)) continue
      rows.push(r.map((v) => (v === null || v === undefined ? '' : String(v).replace('.', ','))).join(';'))
    }
    saveBlob(new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv' }), `${fileSafe(p.title ?? 'data')}.csv`)
  }

  function flash(t: string) {
    setMsg(t)
    setTimeout(() => setMsg(null), 2500)
  }

  return (
    <div className="chart" ref={wrap}>
      <div className="chart-stage">
        <canvas ref={base} />
        <canvas
          ref={over}
          className="chart-over"
          onPointerMove={(e) => {
            const h = toX(e)
            if (drag && h) setDrag([drag[0], h.px])
            hoverAll(h ? h.x : null)
          }}
          onPointerLeave={() => {
            hoverAll(null)
            setDrag(null)
          }}
          onPointerDown={(e) => {
            const h = toX(e)
            if (h && e.pointerType === 'mouse' && e.button === 0) setDrag([h.px, h.px])
            else if (h) hoverAll(h.x)
          }}
          onPointerUp={() => {
            const L = layout.current
            if (drag && L && Math.abs(drag[1] - drag[0]) > 6) {
              const a = Math.min(drag[0], drag[1]), b = Math.max(drag[0], drag[1])
              const fx = (px: number) => L.view.x0 + ((px - L.x) / L.w) * (L.view.x1 - L.view.x0)
              zoom([fx(a), fx(b)])
            }
            setDrag(null)
          }}
          onDoubleClick={() => zoom(null)}
        />
      </div>
      <div className="chart-bar">
        <span className="chart-readout">
          {readout ? (
            <>
              <b>{valueText(readout.x)}</b>
              {readout.vals.map(([l, v], k) => (
                <span key={k}>
                  {' '}
                  · {l}: {valueText(v)}
                </span>
              ))}
            </>
          ) : (
            msg ?? (xr ? 'збільшено — подвійний клік, щоб скинути' : '')
          )}
        </span>
        <span className="chart-tools">
          <button className="mini" title="Зберегти PNG (для презентації)" onClick={async () => saveBlob(await exportPng(), `${fileSafe(p.title ?? 'figure')}.png`)}>
            PNG
          </button>
          <button className="mini" title="Скопіювати зображення в буфер обміну" onClick={async () => flash((await copyBlob(await exportPng())) ? 'Скопійовано — встав у презентацію (Ctrl+V)' : 'Браузер не дозволив копіювати — збережи PNG')}>
            Копіювати
          </button>
          <button className="mini" title="Дані видимої ділянки в CSV (Excel)" onClick={exportCsv}>
            CSV
          </button>
        </span>
      </div>
    </div>
  )
}
