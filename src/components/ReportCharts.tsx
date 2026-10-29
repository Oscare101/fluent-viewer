import { useMemo } from 'react'
import type { AlignedData } from 'uplot'
import Chart, { PALETTE, type ChartSeries, type Marker } from './Chart'
import { dtSteps, type Series } from '../data'
import type { DtHistory, State } from '../types'

export interface ReportItem {
  label: string
  series: Series[]
  dt: DtHistory | null
  states?: State[]
}

const KINDS: [string, string, number][] = [
  ['Q_total', 'Q_total, Вт/м (уся гаряча стінка)', 1],
  ['Q_rad', 'Q_rad, Вт/м', 1],
  ['vapor', 'Частка пари в області, %', 100],
]

/** Спільна вісь x для кількох кривих: об'єднання точок, null там, де в кривої точки немає. */
export function align(curves: { x: ArrayLike<number>; y: ArrayLike<number | null> }[]): AlignedData {
  if (curves.length === 1) return [Array.from(curves[0].x), Array.from(curves[0].y)] as AlignedData
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
  return [xs, ...out] as AlignedData
}

export function ReportCharts({ items, bands, syncKey }: { items: ReportItem[]; bands?: [number, number][]; syncKey: string }) {
  const multi = items.length > 1
  const markers = useMemo(() => {
    const m: Marker[] = []
    items.forEach((it, i) => {
      const c = multi ? PALETTE[i % PALETTE.length] : '#8a877f'
      for (const [, t] of it.dt?.changes ?? []) m.push({ x: t, color: c, dash: [2, 4] })
      for (const [, t] of it.dt?.rollbacks ?? []) m.push({ x: t, color: '#e0302a', dash: [6, 3] })
      if (!multi) for (const s of it.states ?? []) m.push({ x: s.t_ms, color: '#1baf7a', dash: [1, 0] })
    })
    return m
  }, [items, multi])

  const charts = useMemo(
    () =>
      KINDS.flatMap(([kind, title, scale]) => {
        const curves = items.flatMap((it) => {
          const s = it.series.find((x) => x.kind === kind)
          return s ? [{ x: s.t, y: Array.from(s.cols[0], (v) => v * scale) }] : []
        })
        if (!curves.length) return []
        const series: ChartSeries[] = items
          .filter((it) => it.series.some((x) => x.kind === kind))
          .map((it, i) => ({ label: it.label, color: PALETTE[i % PALETTE.length], spanGaps: true }))
        return [{ kind, title, data: align(curves), series }]
      }),
    [items],
  )

  return (
    <>
      {charts.map((c) => (
        <Chart key={c.kind} title={c.title} data={c.data} series={c.series} xLabel="flow-time, мс" markers={markers} bands={bands} syncKey={syncKey} height={210} />
      ))}
      <p className="small muted">
        Пунктир — зміни dt{multi ? ' (колір розрахунку)' : ''}, червоний штрих — відкати
        {multi ? '' : ', зелені лінії — збережені стани'}. Виділи мишею ділянку, щоб збільшити; подвійний клік — скинути.
      </p>
    </>
  )
}

export function DtCharts({ items, syncKey }: { items: ReportItem[]; syncKey: string }) {
  const tEnd = (it: ReportItem) => Math.max(it.series[0]?.t[it.series[0].t.length - 1] ?? 0, it.dt?.changes.at(-1)?.[1] ?? 0)
  const dt = useMemo(() => {
    const with_ = items.filter((it) => it.dt?.changes.length)
    const curves = with_.map((it) => {
      const [x, y] = dtSteps(it.dt!, tEnd(it))
      return { x, y }
    })
    const series: ChartSeries[] = with_.map((it, i) => ({ label: it.label, color: PALETTE[i % PALETTE.length], spanGaps: true, stepped: true }))
    return curves.length ? { data: align(curves), series } : null
  }, [items])

  const iters = useMemo(() => {
    if (items.length !== 1) return null
    const h = items[0].dt
    const b = h?.iters_buckets
    if (!h || !b) return null
    const nc = h.not_converged ?? []
    const data = align([
      { x: b.t_ms, y: b.mean },
      { x: b.t_ms, y: b.max },
      { x: nc.map((r) => r[1]), y: nc.map((r) => r[2]) },
    ])
    const series: ChartSeries[] = [
      { label: 'середнє', color: PALETTE[0] },
      { label: 'максимум', color: PALETTE[3], width: 1 },
      { label: 'не зійшовся', color: '#e0302a', points: true },
    ]
    return { data, series }
  }, [items])

  if (!dt) return <p className="muted">Немає транскрипту — історія кроку часу невідома.</p>
  return (
    <>
      <Chart title="Крок часу dt, с" data={dt.data} series={dt.series} xLabel="flow-time, мс" logY syncKey={syncKey} height={200} />
      {iters && <Chart title="Ітерацій на крок (по кошиках)" data={iters.data} series={iters.series} xLabel="flow-time, мс" syncKey={syncKey} height={200} />}
    </>
  )
}
