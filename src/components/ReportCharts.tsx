import { useMemo } from 'react'
import Chart, { PALETTE, type ChartData, type ChartSeries, type Marker } from './Chart'
import { dtSteps, type Series } from '../data'
import type { DtHistory, State } from '../types'

export interface ReportItem {
  label: string
  series: Series[]
  dt: DtHistory | null
  states?: State[]
}

const KINDS: [string, string, string, number][] = [
  ['Q_total', 'Сумарний тепловий потік з гарячої стінки', 'Q_total, Вт/м', 1],
  ['Q_rad', 'Радіаційний тепловий потік', 'Q_rad, Вт/м', 1],
  ['vapor', 'Частка пари в області', 'Пара, %', 100],
]
const T_AXIS = 'Flow time, мс'

/** Спільна вісь x для кількох кривих: об'єднання точок, null там, де в кривої точки немає. */
export function align(curves: { x: ArrayLike<number>; y: ArrayLike<number | null> }[]): ChartData {
  if (curves.length === 1) return [Array.from(curves[0].x), Array.from(curves[0].y)]
  const all = new Set<number>()
  for (const c of curves) for (let i = 0; i < c.x.length; i++) all.add(c.x[i])
  const xs = [...all].sort((a, b) => a - b)
  const out = curves.map((c) => {
    const ys: (number | null)[] = new Array(xs.length).fill(null)
    let k = 0
    for (let i = 0; i < c.x.length; i++) {
      while (xs[k] < c.x[i]) k++
      ys[k] = c.y[i]
    }
    return ys
  })
  return [xs, ...out]
}

export function ReportCharts({ items, bands, syncKey }: { items: ReportItem[]; bands?: [number, number][]; syncKey: string }) {
  const multi = items.length > 1
  const markers = useMemo(() => {
    const m: Marker[] = []
    items.forEach((it, i) => {
      const c = multi ? PALETTE[i % PALETTE.length] : '#9a9a9a'
      for (const [, t] of it.dt?.changes ?? []) m.push({ x: t, color: c, dash: [2, 4] })
      for (const [, t] of it.dt?.rollbacks ?? []) m.push({ x: t, color: '#d62728', dash: [6, 3] })
      if (!multi) for (const s of it.states ?? []) m.push({ x: s.t_ms, color: '#2ca02c', dash: [] })
    })
    return m
  }, [items, multi])

  const charts = useMemo(
    () =>
      KINDS.flatMap(([kind, title, yLabel, scale]) => {
        const withKind = items.filter((it) => it.series.some((x) => x.kind === kind))
        if (!withKind.length) return []
        const curves = withKind.map((it) => {
          const s = it.series.find((x) => x.kind === kind)!
          return { x: s.t, y: Array.from(s.cols[0], (v) => v * scale) }
        })
        const series: ChartSeries[] = withKind.map((it) => ({ label: multi ? it.label : '', color: PALETTE[items.indexOf(it) % PALETTE.length], width: 1.4, spanGaps: true }))
        return [{ kind, title, yLabel, data: align(curves), series }]
      }),
    [items, multi],
  )

  return (
    <>
      <div className="chart-grid wide">
        {charts.map((c) => (
          <Chart key={c.kind} title={c.title} yLabel={c.yLabel} data={c.data} series={c.series} xLabel={T_AXIS} markers={markers} bands={bands} syncKey={syncKey} height={280} robustY />
        ))}
      </div>
      <p className="small muted">
        Сірий пунктир — зміни dt{multi ? ' (колір розрахунку)' : ''}, червоний — відкати{multi ? '' : ', зелені лінії — збережені стани'}.
        Виділи мишею ділянку, щоб збільшити (усі графіки разом); подвійний клік — скинути. PNG/Копіювати зберігають видиму ділянку.
      </p>
    </>
  )
}

export function DtCharts({ items, syncKey }: { items: ReportItem[]; syncKey: string }) {
  const multi = items.length > 1
  const dt = useMemo(() => {
    const withDt = items.filter((it) => it.dt?.changes.length)
    const curves = withDt.map((it) => {
      const tEnd = Math.max(it.series[0]?.t[it.series[0].t.length - 1] ?? 0, it.dt!.changes.at(-1)![1])
      const [x, y] = dtSteps(it.dt!, tEnd)
      return { x, y }
    })
    const series: ChartSeries[] = withDt.map((it) => ({ label: multi ? it.label : '', color: PALETTE[items.indexOf(it) % PALETTE.length], spanGaps: true, stepped: true, width: 1.8 }))
    return curves.length ? { data: align(curves), series } : null
  }, [items, multi])

  const iters = useMemo(() => {
    if (multi) return null
    const h = items[0].dt
    const b = h?.iters_buckets
    if (!h || !b) return null
    const nc = h.not_converged ?? []
    const data = align([
      { x: b.t_ms, y: b.mean },
      { x: nc.map((r) => r[1]), y: nc.map((r) => r[2]) },
    ])
    const series: ChartSeries[] = [
      { label: 'середнє за інтервал', color: PALETTE[0], width: 1.6, spanGaps: true },
      { label: 'крок не зійшовся', color: '#d62728', points: true },
    ]
    return { data, series }
  }, [items, multi])

  if (!dt) return <p className="muted">Немає транскрипту — історія кроку часу невідома.</p>
  return (
    <div className="chart-grid wide">
      <Chart title="Крок часу" yLabel="dt, с" data={dt.data} series={dt.series} xLabel={T_AXIS} logY syncKey={syncKey} height={260} />
      {iters && <Chart title="Ітерацій на крок" yLabel="ітерацій" data={iters.data} series={iters.series} xLabel={T_AXIS} syncKey={syncKey} height={260} />}
    </div>
  )
}
