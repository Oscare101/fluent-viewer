// Завантаження й обробка preview/ розрахунку (формати — fluent-data/extract/preview.py).
import type { Repo } from './github'
import type { DtHistory, Grid, IndexFile, Run, State } from './types'

export type FieldKey = 'T' | 'vf' | 'U' | 'V' | 'P' | 'mt'
export type ProfKey = 'qc' | 'qr' | 'q' | 'delta' | 'T1' | 'vf1'

export const FIELD_INFO: Record<FieldKey, { label: string; unit: string }> = {
  T: { label: 'Температура', unit: 'K' },
  vf: { label: 'Об’ємна частка пари', unit: '' },
  V: { label: 'Вертикальна швидкість v', unit: 'м/с' },
  U: { label: 'Горизонтальна швидкість u', unit: 'м/с' },
  P: { label: 'Тиск (надлишковий)', unit: 'Па' },
  mt: { label: 'Інтенсивність масообміну (Lee)', unit: 'кг/(м³·с)' },
}

export interface StateData {
  fields: Record<FieldKey, Float32Array>
  prof: Record<ProfKey, Float32Array>
}

export interface Series {
  kind: string
  group: string
  columns: string[]
  t: Float32Array
  cols: Float32Array[]
}

export interface Cum {
  t: Float64Array
  cols: Float64Array[]
}

const pre = (run: Run, f: string) => `${run.id}/preview/${f}`

export async function loadRun(repo: Repo, id: string): Promise<{ run: Run; title: string }> {
  const run = await repo.json<Run>(`${id}/preview/run.json`)
  const index = await repo.json<IndexFile>('index.json').catch(() => null)
  const entry = index?.runs.find((r) => r.id === id)
  return { run, title: entry?.title || run.meta.title || id }
}

export function loadGrid(repo: Repo, run: Run): Promise<Grid> {
  return repo.json<Grid>(pre(run, 'grid.json'))
}

export async function loadState(repo: Repo, run: Run, s: State): Promise<StateData> {
  const a = new Float32Array(await repo.buffer(pre(run, s.bin)))
  const { nx, ny, fields, profiles } = run.state_layout
  const n = nx * ny
  const f = {} as Record<FieldKey, Float32Array>
  fields.forEach((k, i) => (f[k as FieldKey] = a.subarray(i * n, (i + 1) * n)))
  const p = {} as Record<ProfKey, Float32Array>
  const off = fields.length * n
  profiles.forEach((k, i) => (p[k as ProfKey] = a.subarray(off + i * ny, off + (i + 1) * ny)))
  return { fields: f, prof: p }
}

export async function loadReports(repo: Repo, run: Run): Promise<Series[]> {
  return Promise.all(
    run.reports.map(async (r) => {
      const a = new Float32Array(await repo.buffer(pre(run, r.file)))
      const n = r.n
      return {
        kind: r.kind,
        group: r.group,
        columns: r.columns,
        t: a.subarray(0, n),
        cols: r.columns.map((_, i) => a.subarray((i + 1) * n, (i + 2) * n)),
      }
    }),
  )
}

export async function loadCum(repo: Repo, run: Run, kind: string): Promise<Cum | null> {
  const r = run.reports.find((x) => x.kind === kind)
  if (!r?.cum_file || !r.cum_n) return null
  const a = new Float64Array(await repo.buffer(pre(run, r.cum_file)))
  const n = r.cum_n
  return { t: a.subarray(0, n), cols: r.columns.map((_, i) => a.subarray((i + 1) * n, (i + 2) * n)) }
}

export async function loadDt(repo: Repo, run: Run): Promise<DtHistory | null> {
  return run.dt_history ? repo.json<DtHistory>(pre(run, run.dt_history)) : null
}

function interp(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  let lo = 0
  let hi = xs.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (xs[m] <= x) lo = m
    else hi = m
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo] || 1)
  return ys[lo] + t * (ys[hi] - ys[lo])
}

/** Середнє за часом на [a, b] мс з кумулятивного інтеграла; null, якщо вікно виходить за дані. */
export function windowMean(c: Cum | null, a: number, b: number, col = 0): number | null {
  if (!c || !(b > a) || a < c.t[0] - 1e-9 || b > c.t[c.t.length - 1] + 1e-9) return null
  return (interp(c.t, c.cols[col], b) - interp(c.t, c.cols[col], a)) / (b - a)
}

/** dt (с), що діяв у момент t (мс). */
export function dtAt(dt: DtHistory | null, t: number): number | null {
  if (!dt || !dt.changes.length) return null
  let v: number | null = null
  for (const [, tc, d] of dt.changes) {
    if (tc <= t + 1e-9) v = d
    else break
  }
  return v
}

/** Максимальне відношення dt_run / dt_base на [a, b] мс (> 1 — крок більший за базовий, правило 2). */
export function dtRatioMax(run: DtHistory | null, base: DtHistory | null, a: number, b: number): number | null {
  if (!run || !base) return null
  const pts = new Set<number>([a])
  for (const h of [run, base]) for (const [, t] of h.changes) if (t > a && t < b) pts.add(t)
  let worst: number | null = null
  for (const t of pts) {
    const x = dtAt(run, t)
    const y = dtAt(base, t)
    if (x === null || y === null) continue // до першого запису «Flow time» dt ще невідомий
    worst = Math.max(worst ?? 0, x / y)
  }
  return worst
}

/** Точки для ступінчастого графіка dt(t): моменти змін + кінець (малювати з stepped). */
export function dtSteps(dt: DtHistory, tEnd: number): [number[], number[]] {
  const xs = dt.changes.map((c) => c[1])
  const ys = dt.changes.map((c) => c[2])
  if (tEnd > xs[xs.length - 1]) {
    xs.push(tEnd)
    ys.push(ys[ys.length - 1])
  }
  return [xs, ys]
}

export interface ZoneStats {
  alpha: number
  alpha_cond: number
  alpha_rad: number
  rad_share: number
  q_kW: number
  q_cond_kW: number
  q_rad_kW: number
  delta_med: number | null
  Q_zone: number
  dome_y: number[]
}

function median(a: number[]): number | null {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m])
}

/** Скаляри зони плівки — як kit/tools/film_metrics.zone_stats (δ — медіана на перетині зони з 8…32 мм). */
export function zoneStats(sd: StateData, grid: Grid, zone: [number, number], Tw: number, Tsat: number): ZoneStats {
  const [y0, y1] = zone
  const DT = Tw - Tsat
  let q = 0, qc = 0, qr = 0, n = 0, Q = 0
  const d: number[] = []
  const dome: number[] = []
  for (let j = 0; j < grid.ny; j++) {
    const y = grid.yc[j]
    if (!(y > y0 && y < y1)) continue
    q += sd.prof.q[j]
    qc += sd.prof.qc[j]
    qr += sd.prof.qr[j]
    n++
    Q += sd.prof.q[j] * (grid.ye[j + 1] - grid.ye[j]) * 1e-3
    const dl = sd.prof.delta[j]
    if (y > Math.max(y0, 8) && y < Math.min(y1, 32) && Number.isFinite(dl)) d.push(dl)
    if (dl > 1) dome.push(y)
  }
  q /= n
  qc /= n
  qr /= n
  return {
    alpha: q / DT, alpha_cond: qc / DT, alpha_rad: qr / DT, rad_share: qr / q,
    q_kW: q / 1e3, q_cond_kW: qc / 1e3, q_rad_kW: qr / 1e3,
    delta_med: median(d), Q_zone: Q, dome_y: dome,
  }
}

/** Стан за замовчуванням: закріплений (не старт), інакше останній. */
export function defaultState(run: Run): State {
  return run.states.find((s) => s.label && s.kind !== 'start') ?? run.states[run.states.length - 1]
}

export function nearestState(run: Run, t: number): State {
  return run.states.reduce((a, b) => (Math.abs(b.t_ms - t) < Math.abs(a.t_ms - t) ? b : a))
}
