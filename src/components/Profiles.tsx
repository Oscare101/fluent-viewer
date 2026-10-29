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
const Y_AXIS = 'Висота y, мм (гаряча ділянка 5…35 мм)'
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

    const dS: ChartSeries[] = items.map((it, i) => ({ label: one ? '' : it.label, color: color(i) }))
    const qS: ChartSeries[] = []
    const qD: (number | null)[][] = []
    items.forEach((it, i) => {
      qS.push({ label: one ? (detail ? 'сумарний' : '') : it.label, color: color(i) })
      qD.push(at(it, 'q', 1e-3))
      if (detail && one) {
        qS.push({ label: 'теплопровідністю', color: color(1), dash: [6, 3], width: 1.6 }, { label: 'випромінюванням', color: color(3), dash: [2, 3], width: 1.6 })
        qD.push(at(it, 'qc', 1e-3), at(it, 'qr', 1e-3))
      }
    })
    const aS: ChartSeries[] = items.map((it, i) => ({ label: one ? '' : it.label, color: color(i) }))
    return {
      delta: { data: [ys, ...items.map((it) => at(it, 'delta'))] as ChartData, series: dS },
      q: { data: [ys, ...qD] as ChartData, series: qS, yRange: [0, qmax] as [number, number | null] },
      a: { data: [ys, ...items.map((it) => at(it, 'q', 1 / (it.Tw - it.Tsat)))] as ChartData, series: aS, yRange: [0, amax] as [number, number | null] },
    }
  }, [items, zone, detail])
  const bands = useMemo(() => [zone], [zone])

  return (
    <div className="chart-grid">
      <Chart {...charts.delta} title="Товщина парової плівки вздовж стінки" xLabel={Y_AXIS} yLabel="Товщина плівки δ, мм" yRange={D_RANGE} xRange={Y_RANGE} bands={bands} />
      <Chart {...charts.q} title="Густина теплового потоку на гарячій стінці" xLabel={Y_AXIS} yLabel="Тепловий потік q, кВт/м²" xRange={Y_RANGE} bands={bands} />
      <Chart {...charts.a} title="Коефіцієнт тепловіддачі вздовж стінки" xLabel={Y_AXIS} yLabel="Коеф. тепловіддачі α, Вт/(м²·K)" xRange={Y_RANGE} bands={bands} />
    </div>
  )
}

/** Значення поля в стовпці i на висоті y: лінійна інтерполяція між центрами сусідніх рядків комірок
 *  (як лінія-розріз у Fluent; центри лежать на …9.75, 10.25… мм, тож 10 мм — посередині). */
function atHeight(g: Grid, a: Float32Array, i: number, y: number): number {
  const yc = g.yc
  if (y <= yc[0]) return a[i]
  if (y >= yc[g.ny - 1]) return a[(g.ny - 1) * g.nx + i]
  let j = 0
  while (yc[j + 1] < y) j++
  const w = (y - yc[j]) / (yc[j + 1] - yc[j])
  return a[j * g.nx + i] * (1 - w) + a[(j + 1) * g.nx + i] * w
}

const fmtY = (y: number) => String(Math.round(y * 100) / 100).replace('.', ',')

/** Профілі поперек плівки на висотах heights (вісь x — відстань від стінки); average — одна усереднена крива. */
export function CrossProfiles({ items, heights, average, xmax }: { items: ProfileItem[]; heights: number[]; average: boolean; xmax: number }) {
  const charts = useMemo(() => {
    const g = items[0].grid
    const cols = Array.from(g.xc).flatMap((x, i) => (x <= xmax ? [i] : []))
    const xs = [0, ...cols.map((i) => g.xc[i])]
    const hs = [...new Set(heights.length ? heights : [20])]
    const one = items.length === 1
    const curve = (it: ProfileItem, f: 'vf' | 'T' | 'V', wall: number | null, ys: number[]) => [
      wall,
      ...cols.map((i) => {
        let s = 0, n = 0
        for (const y of ys) {
          const v = atHeight(g, it.sd.fields[f], i, y)
          if (Number.isFinite(v)) { s += v; n++ }
        }
        return n ? s / n : null
      }),
    ]
    const yTxt = hs.map(fmtY).join('; ')
    const build = (f: 'vf' | 'T' | 'V', wall: (it: ProfileItem) => number | null) => {
      const series: ChartSeries[] = []
      const cols_: (number | null)[][] = []
      items.forEach((it, i) => {
        if (average || hs.length === 1) {
          series.push({
            label: one ? (hs.length > 1 ? `середнє по y = ${yTxt} мм` : `y = ${yTxt} мм`) : it.label,
            color: PALETTE[i % PALETTE.length],
          })
          cols_.push(curve(it, f, wall(it), hs))
        } else {
          hs.forEach((y, r) => {
            series.push({
              label: one ? `y = ${fmtY(y)} мм` : `${it.label}, y = ${fmtY(y)} мм`,
              color: PALETTE[(one ? r : i) % PALETTE.length],
              dash: one ? undefined : [[], [7, 3], [2, 3], [8, 2, 2, 2]][r % 4],
            })
            cols_.push(curve(it, f, wall(it), [y]))
          })
        }
      })
      return { data: [xs, ...cols_] as ChartData, series }
    }
    return {
      note: average && hs.length > 1 ? `Середнє по висотах y = ${yTxt} мм` : `Висоти y = ${yTxt} мм`,
      vf: build('vf', () => null),
      T: build('T', (it) => it.Tw),
      V: build('V', () => 0),
    }
  }, [items, heights, average, xmax])

  return (
    <>
      <p className="small muted">
        {charts.note} (значення інтерпольовано між центрами комірок); x = 0 — гаряча стінка (T = T_w, v = 0).
      </p>
      <div className="chart-grid">
        <Chart {...charts.T} title="Профіль температури поперек плівки" xLabel={X_AXIS} yLabel="Температура T, K" />
        <Chart {...charts.vf} title="Профіль частки пари поперек плівки" xLabel={X_AXIS} yLabel="Об’ємна частка пари" yRange={VF_RANGE} />
        <Chart {...charts.V} title="Профіль вертикальної швидкості" xLabel={X_AXIS} yLabel="Вертикальна швидкість v, м/с" />
      </div>
    </>
  )
}
