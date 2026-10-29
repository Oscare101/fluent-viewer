import { useEffect, useRef } from 'react'
import uPlot, { type AlignedData, type Options } from 'uplot'
import 'uplot/dist/uPlot.min.css'

export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#c98a00', '#6250d6', '#d63a6b']

export interface ChartSeries {
  label: string
  color?: string
  dash?: number[]
  width?: number
  points?: boolean // лише точки, без лінії
  scale?: string
  stepped?: boolean
  spanGaps?: boolean // з'єднувати лінію через null (для об'єднаної осі x кількох розрахунків)
}

export interface Marker {
  x: number
  color: string
  dash?: number[]
  title?: string
}

export interface ChartProps {
  data: AlignedData
  series: ChartSeries[]
  title?: string
  xLabel?: string
  yLabel?: string
  y2Label?: string
  height?: number
  logY?: boolean
  yRange?: [number | null, number | null]
  xRange?: [number, number]
  markers?: Marker[]
  bands?: [number, number][]
  syncKey?: string
}

// Синхронізація зуму по x між графіками з однаковим syncKey.
const groups = new Map<string, Set<uPlot>>()

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export default function Chart(p: ChartProps) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const text = cssVar('--muted', '#666')
    const grid = cssVar('--line', '#ddd')
    const accent = cssVar('--accent', '#2a6fc4')
    const axis = (label?: string, side?: number, scale?: string) => ({
      label,
      side,
      scale,
      stroke: text,
      grid: { stroke: grid, width: 1, show: side !== 1 },
      ticks: { stroke: grid, width: 1 },
      font: '11px system-ui, sans-serif',
      labelFont: '12px system-ui, sans-serif',
      size: 52,
    })
    const hasY2 = p.series.some((s) => s.scale === 'y2')
    const opts: Options = {
      width: el.clientWidth || 300,
      height: p.height ?? 220,
      title: p.title,
      scales: {
        x: p.xRange ? { time: false, min: p.xRange[0], max: p.xRange[1] } : { time: false },
        y: {
          distr: p.logY ? 3 : 1,
          ...(p.yRange ? { range: (_u, lo, hi) => [p.yRange![0] ?? lo, p.yRange![1] ?? hi] } : {}),
        },
        ...(hasY2 ? { y2: {} } : {}),
      },
      axes: [axis(p.xLabel), axis(p.yLabel), ...(hasY2 ? [axis(p.y2Label, 1, 'y2')] : [])],
      series: [
        { label: p.xLabel ?? 'x', value: (_u, v) => (v === null || v === undefined ? '—' : v.toPrecision(5)) },
        ...p.series.map((s, i) => ({
          label: s.label,
          scale: s.scale ?? 'y',
          stroke: s.color ?? PALETTE[i % PALETTE.length],
          width: s.points ? 0 : (s.width ?? 1.4),
          dash: s.dash,
          paths: s.points ? () => null : s.stepped ? uPlot.paths.stepped!({ align: 1 }) : undefined,
          points: s.points ? { show: true, size: 4, fill: s.color ?? PALETTE[i % PALETTE.length] } : { show: false },
          spanGaps: s.spanGaps ?? false,
          value: (_u: uPlot, v: number | null) => (v === null || v === undefined ? '—' : Math.abs(v) < 1e-3 && v !== 0 ? v.toExponential(2) : v.toPrecision(4)),
        })),
      ],
      cursor: { sync: p.syncKey ? { key: p.syncKey } : undefined, drag: { x: true, y: false } },
      legend: { live: true },
      hooks: {
        drawAxes: [
          (u) => {
            if (!p.bands?.length) return
            const c = u.ctx
            c.save()
            c.fillStyle = accent
            c.globalAlpha = 0.09
            for (const [a, b] of p.bands) {
              const x0 = u.valToPos(a, 'x', true)
              const x1 = u.valToPos(b, 'x', true)
              c.fillRect(x0, u.bbox.top, x1 - x0, u.bbox.height)
            }
            c.restore()
          },
        ],
        draw: [
          (u) => {
            if (!p.markers?.length) return
            const c = u.ctx
            const [lo, hi] = [u.scales.x.min ?? -Infinity, u.scales.x.max ?? Infinity]
            c.save()
            c.lineWidth = Math.max(1, devicePixelRatio)
            for (const m of p.markers) {
              if (m.x < lo || m.x > hi) continue
              const x = Math.round(u.valToPos(m.x, 'x', true)) + 0.5
              c.strokeStyle = m.color
              c.setLineDash((m.dash ?? [3, 3]).map((d) => d * devicePixelRatio))
              c.beginPath()
              c.moveTo(x, u.bbox.top)
              c.lineTo(x, u.bbox.top + u.bbox.height)
              c.stroke()
            }
            c.restore()
          },
        ],
        setScale: [
          (u, key) => {
            if (key !== 'x' || !p.syncKey) return
            const { min, max } = u.scales.x
            for (const o of groups.get(p.syncKey) ?? []) {
              if (o !== u && (o.scales.x.min !== min || o.scales.x.max !== max)) o.setScale('x', { min: min!, max: max! })
            }
          },
        ],
      },
    }
    const u = new uPlot(opts, p.data, el)
    if (p.syncKey) {
      if (!groups.has(p.syncKey)) groups.set(p.syncKey, new Set())
      groups.get(p.syncKey)!.add(u)
    }
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      if (w && Math.abs(w - u.width) > 2) u.setSize({ width: w, height: u.height })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (p.syncKey) groups.get(p.syncKey)?.delete(u)
      u.destroy()
    }
    // масиви (data, series, markers, bands, діапазони) викликач передає мемоізованими
  }, [p.data, p.series, p.markers, p.bands, p.title, p.height, p.logY, p.yRange, p.xRange, p.syncKey, p.xLabel, p.yLabel, p.y2Label])

  return <div className="chart" ref={box} />
}
