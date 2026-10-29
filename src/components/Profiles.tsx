import { useMemo } from 'react'
import Chart, { PALETTE, type ChartData, type ChartSeries } from './Chart'
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
const D_RANGE: [number, number | null] = [0, 1]
const VF_RANGE: [number, number] = [-0.02, 1.02]
const Y_AXIS = 'Висота y, мм (гаряча стінка 5…35 мм)'
const X_AXIS = 'Відстань від гарячої стінки, мм'

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
    const inZone = (it: ProfileItem) => ys.flatMap((y, j) => (y > zone[0] && y < zone[1] ? [it.sd.prof.q[j] / 1e3] : []))
    const qmax = Math.max(...items.map((it) => percentile(inZone(it), 0.98))) * 1.3 || null
    const amax = qmax ? (qmax * 1e3) / Math.min(...items.map((it) => it.Tw - it.Tsat)) : null
    const color = (i: number) => PALETTE[i % PALETTE.length]
    const one = items.length === 1

    const dS: ChartSeries[] = items.map((it, i) => ({ label: one ? 'δ' : it.label, color: color(i) }))
    const qS: ChartSeries[] = []
    const qD: (number | null)[][] = []
    items.forEach((it, i) => {
      qS.push({ label: one ? 'q = q_cond + q_rad' : it.label, color: color(i) })
      qD.push(at(it, 'q', 1e-3))
      if (detail && one) {
        qS.push({ label: 'q_cond', color: color(1), dash: [6, 3], width: 1.6 }, { label: 'q_rad', color: color(3), dash: [2, 3], width: 1.6 })
        qD.push(at(it, 'qc', 1e-3), at(it, 'qr', 1e-3))
      }
    })
    const aS: ChartSeries[] = items.map((it, i) => ({ label: one ? 'α' : it.label, color: color(i) }))
    return {
      delta: { data: [ys, ...items.map((it) => at(it, 'delta'))] as ChartData, series: dS },
      q: { data: [ys, ...qD] as ChartData, series: qS, yRange: [0, qmax] as [number, number | null] },
      a: { data: [ys, ...items.map((it) => at(it, 'q', 1 / (it.Tw - it.Tsat)))] as ChartData, series: aS, yRange: [0, amax] as [number, number | null] },
    }
  }, [items, zone, detail])
  const bands = useMemo(() => [zone], [zone])

  return (
    <div className="chart-grid">
      <Chart {...charts.delta} title="Товщина парової плівки δ(y)" xLabel={Y_AXIS} yLabel="δ, мм (до 1 мм)" yRange={D_RANGE} xRange={Y_RANGE} bands={bands} />
      <Chart {...charts.q} title="Тепловий потік на гарячій стінці q(y)" xLabel={Y_AXIS} yLabel="q, кВт/м²" xRange={Y_RANGE} bands={bands} />
      <Chart {...charts.a} title="Коефіцієнт тепловіддачі α(y)" xLabel={Y_AXIS} yLabel="α, Вт/(м²·K)" xRange={Y_RANGE} bands={bands} />
    </div>
  )
}

/** Номери рядків комірок, найближчих до заданих висот (без повторів). */
function rowsFor(g: Grid, heights: number[]): number[] {
  const rows = heights.map((y) => g.yc.reduce((b, v, k) => (Math.abs(v - y) < Math.abs(g.yc[b] - y) ? k : b), 0))
  return [...new Set(rows)]
}

/** Профілі поперек плівки на висотах heights (вісь x — відстань від стінки); average — одна усереднена крива. */
export function CrossProfiles({ items, heights, average, xmax }: { items: ProfileItem[]; heights: number[]; average: boolean; xmax: number }) {
  const charts = useMemo(() => {
    const g = items[0].grid
    const cols = Array.from(g.xc).flatMap((x, i) => (x <= xmax ? [i] : []))
    const xs = [0, ...cols.map((i) => g.xc[i])]
    const rows = rowsFor(g, heights.length ? heights : [20])
    const one = items.length === 1
    const curve = (it: ProfileItem, f: 'vf' | 'T' | 'V', wall: number | null, rs: number[]) => [
      wall,
      ...cols.map((i) => {
        let s = 0, n = 0
        for (const j of rs) {
          const v = it.sd.fields[f][j * g.nx + i]
          if (Number.isFinite(v)) { s += v; n++ }
        }
        return n ? s / n : null
      }),
    ]
    const yTxt = (rs: number[]) => rs.map((j) => g.yc[j].toFixed(2)).join(', ')
    const build = (f: 'vf' | 'T' | 'V', wall: (it: ProfileItem) => number | null) => {
      const series: ChartSeries[] = []
      const cols_: (number | null)[][] = []
      items.forEach((it, i) => {
        if (average || rows.length === 1) {
          series.push({ label: one ? (rows.length > 1 ? `усереднено по y = ${yTxt(rows)} мм` : `y = ${yTxt(rows)} мм`) : it.label + (rows.length > 1 ? ` (усередн. з ${rows.length})` : ''), color: PALETTE[i % PALETTE.length] })
          cols_.push(curve(it, f, wall(it), rows))
        } else {
          rows.forEach((j, r) => {
            series.push({ label: one ? `y = ${g.yc[j].toFixed(2)} мм` : `${it.label}, y = ${g.yc[j].toFixed(1)}`, color: PALETTE[(one ? r : i) % PALETTE.length], dash: one ? undefined : [[], [6, 3], [2, 3], [8, 2, 2, 2]][r % 4] })
            cols_.push(curve(it, f, wall(it), [j]))
          })
        }
      })
      return { data: [xs, ...cols_] as ChartData, series }
    }
    return {
      rowsText: yTxt(rows),
      vf: build('vf', () => null),
      T: build('T', (it) => it.Tw),
      V: build('V', () => 0),
    }
  }, [items, heights, average, xmax])

  return (
    <>
      <p className="small muted">
        Рядки комірок y = {charts.rowsText} мм; x = 0 — гаряча стінка (T = T_w, v = 0).
      </p>
      <div className="chart-grid">
        <Chart {...charts.T} title="Профіль температури поперек плівки" xLabel={X_AXIS} yLabel="Температура, K" />
        <Chart {...charts.vf} title="Профіль частки пари поперек плівки" xLabel={X_AXIS} yLabel="Volume Fraction пари" yRange={VF_RANGE} />
        <Chart {...charts.V} title="Профіль вертикальної швидкості" xLabel={X_AXIS} yLabel="v, м/с" />
      </div>
    </>
  )
}
