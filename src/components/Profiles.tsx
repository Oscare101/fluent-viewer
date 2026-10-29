import { useMemo } from 'react'
import type { AlignedData } from 'uplot'
import Chart, { PALETTE, type ChartSeries } from './Chart'
import type { StateData } from '../data'
import type { Grid } from '../types'

export interface ProfileItem {
  label: string
  sd: StateData
  grid: Grid
  Tw: number
  Tsat: number
}

const Y_RANGE: [number, number] = [4.5, 35.5]
const D_RANGE: [number, number] = [0, 1]

function percentile(a: number[], p: number): number {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}

/** Профілі вздовж гарячої стінки (вісь x графіка — висота y). */
export function WallProfiles({ items, zone, detail }: { items: ProfileItem[]; zone: [number, number]; detail?: boolean }) {
  const charts = useMemo(() => {
    const g = items[0].grid
    const ys = Array.from(g.yc)
    const at = (it: ProfileItem, key: 'delta' | 'q' | 'qc' | 'qr', scale = 1) =>
      ys.map((y, j) => {
        const v = it.sd.prof[key][j]
        return y < g.hot_wall_y_mm[0] || y > g.hot_wall_y_mm[1] || !Number.isFinite(v) ? null : v * scale
      })
    const inZone = (it: ProfileItem) => ys.flatMap((y, j) => (y > zone[0] && y < zone[1] ? [it.sd.prof.qc[j] / 1e3] : []))
    const qmax = Math.max(...items.map((it) => percentile(inZone(it), 0.98))) * 1.3 || null
    const amax = qmax ? (qmax * 1e3) / Math.min(...items.map((it) => it.Tw - it.Tsat)) : null
    const color = (i: number) => PALETTE[i % PALETTE.length]

    const dS: ChartSeries[] = items.map((it, i) => ({ label: it.label, color: color(i) }))
    const delta: AlignedData = [ys, ...items.map((it) => at(it, 'delta'))]

    const qS: ChartSeries[] = []
    const qD: (number | null)[][] = []
    items.forEach((it, i) => {
      qS.push({ label: items.length > 1 ? it.label : 'q', color: color(i), width: 1.8 })
      qD.push(at(it, 'q', 1e-3))
      if (detail) {
        qS.push({ label: 'q_cond', color: color(i + 1), dash: [5, 3] }, { label: 'q_rad', color: color(i + 2), dash: [2, 3] })
        qD.push(at(it, 'qc', 1e-3), at(it, 'qr', 1e-3))
      }
    })
    const aS: ChartSeries[] = items.map((it, i) => ({ label: it.label, color: color(i) }))
    const aD: AlignedData = [ys, ...items.map((it) => at(it, 'q', 1 / (it.Tw - it.Tsat)))]
    return {
      delta: { data: delta, series: dS },
      q: { data: [ys, ...qD] as AlignedData, series: qS, yRange: [0, qmax] as [number, number | null] },
      a: { data: aD, series: aS, yRange: [0, amax] as [number, number | null] },
    }
  }, [items, zone, detail])
  const bands = useMemo(() => [zone], [zone])

  return (
    <div className="chart-grid">
      <Chart {...charts.delta} title="Товщина плівки δ, мм (до 1 мм)" xLabel="y, мм" yRange={D_RANGE} xRange={Y_RANGE} bands={bands} height={200} />
      <Chart {...charts.q} title="Тепловий потік q, кВт/м²" xLabel="y, мм" xRange={Y_RANGE} bands={bands} height={200} />
      <Chart {...charts.a} title="α, Вт/(м²·K)" xLabel="y, мм" xRange={Y_RANGE} bands={bands} height={200} />
    </div>
  )
}

/** Профілі поперек плівки на висоті y (вісь x — відстань від стінки). */
export function CrossProfiles({ items, y, xmax }: { items: ProfileItem[]; y: number; xmax: number }) {
  const charts = useMemo(() => {
    const g = items[0].grid
    const cols = Array.from(g.xc).flatMap((x, i) => (x <= xmax ? [i] : []))
    const xs = [0, ...cols.map((i) => g.xc[i])]
    const j = g.yc.reduce((b, v, k) => (Math.abs(v - y) < Math.abs(g.yc[b] - y) ? k : b), 0)
    const row = (it: ProfileItem, f: 'vf' | 'T' | 'V', wall: number | null) => [
      wall,
      ...cols.map((i) => {
        const v = it.sd.fields[f][j * g.nx + i]
        return Number.isFinite(v) ? v : null
      }),
    ]
    const series: ChartSeries[] = items.map((it, i) => ({ label: it.label, color: PALETTE[i % PALETTE.length] }))
    return {
      yRow: g.yc[j],
      vf: { data: [xs, ...items.map((it) => row(it, 'vf', null))] as AlignedData, series },
      T: { data: [xs, ...items.map((it) => row(it, 'T', it.Tw))] as AlignedData, series },
      V: { data: [xs, ...items.map((it) => row(it, 'V', 0))] as AlignedData, series },
    }
  }, [items, y, xmax])

  return (
    <>
      <p className="small muted">Рядок комірок y = {charts.yRow.toFixed(2)} мм; x = 0 — гаряча стінка (T = T_w, v = 0).</p>
      <div className="chart-grid">
        <Chart {...charts.vf} title="Volume Fraction пари" xLabel="від стінки, мм" yRange={D_RANGE} height={190} />
        <Chart {...charts.T} title="T, K" xLabel="від стінки, мм" height={190} />
        <Chart {...charts.V} title="v, м/с" xLabel="від стінки, мм" height={190} />
      </div>
    </>
  )
}
