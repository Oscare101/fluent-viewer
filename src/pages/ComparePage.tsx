import { useMemo, useState, type ReactNode } from 'react'
import type { AuthError, Repo } from '../github'
import type { DtHistory, Grid, IndexFile, Run, State } from '../types'
import { compareHref, useLoad } from '../hooks'
import { ms, num } from '../format'
import {
  defaultState, dtRatioMax, loadCum, loadDt, loadGrid, loadReports, loadRun, loadState, nearestState, windowMean, zoneStats,
  type Cum, type Series, type StateData, type ZoneStats,
} from '../data'
import { PALETTE } from '../components/Chart'
import { CrossProfiles, WallProfiles, type ProfileItem } from '../components/Profiles'
import { DtCharts, ReportCharts, type ReportItem } from '../components/ReportCharts'

interface Loaded {
  id: string
  title: string
  run: Run
  grid: Grid
  dt: DtHistory | null
  series: Series[]
  cum: Record<'Q_total' | 'Q_rad' | 'vapor', Cum | null>
}

async function loadAll(repo: Repo, ids: string[]) {
  const runs = await Promise.all(
    ids.map(async (id): Promise<Loaded> => {
      const { run, title } = await loadRun(repo, id)
      const [grid, dt, series, qt, qr, vp] = await Promise.all([
        loadGrid(repo, run), loadDt(repo, run), loadReports(repo, run),
        loadCum(repo, run, 'Q_total'), loadCum(repo, run, 'Q_rad'), loadCum(repo, run, 'vapor'),
      ])
      return { id, title, run, grid, dt, series, cum: { Q_total: qt, Q_rad: qr, vapor: vp } }
    }),
  )
  const index = await repo.json<IndexFile>('index.json').catch(() => null)
  return { runs, all: index?.runs ?? [] }
}

type Level = 'ok' | 'warn' | 'bad' | 'na'
const MARK: Record<Level, string> = { ok: '✓', warn: '!', bad: '✗', na: '?' }

function Rule({ level, children }: { level: Level; children: ReactNode }) {
  return (
    <li className={`rule ${level}`}>
      <span className="rule-mark">{MARK[level]}</span> {children}
    </li>
  )
}

function pct(v: number | null, base: number | null): string {
  if (v === null || base === null || !base) return ''
  const d = (100 * (v - base)) / Math.abs(base)
  return `${d >= 0 ? '+' : ''}${num(d, 1)} %`
}

function ZoneInput({ zone, setZone }: { zone: [number, number]; setZone: (z: [number, number]) => void }) {
  return (
    <label>
      Зона плівки y ={' '}
      <input className="num" type="number" step={0.5} value={zone[0]} onChange={(e) => setZone([Number(e.target.value), zone[1]])} /> …{' '}
      <input className="num" type="number" step={0.5} value={zone[1]} onChange={(e) => setZone([zone[0], Number(e.target.value)])} /> мм
    </label>
  )
}

export default function ComparePage({ repo, ids, version, onAuth }: { repo: Repo; ids: string[]; version: number; onAuth: (e: AuthError) => void }) {
  const { data, error, loading } = useLoad(() => loadAll(repo, ids), [repo, ids.join(','), version], onAuth)
  if (loading && !data) return <p className="muted">Завантажую розрахунки…</p>
  if (error) return <p className="error">{error}</p>
  if (!data) return null
  return <Compare key={ids.join(',')} repo={repo} runs={data.runs} all={data.all} onAuth={onAuth} />
}

function Compare({ repo, runs, all, onAuth }: { repo: Repo; runs: Loaded[]; all: IndexFile['runs']; onAuth: (e: AuthError) => void }) {
  const ids = runs.map((r) => r.id)
  const base = runs[0]
  const [zone, setZone] = useState<[number, number]>(base.run.zone_mm)
  const [sel, setSel] = useState<string[]>(() => {
    const t = defaultState(base.run).t_ms
    return runs.map((r, i) => (i === 0 ? defaultState(r.run) : nearestState(r.run, t)).file)
  })
  const [windows, setWindows] = useState<[number, number][]>([[5, 15]])
  const [pickY, setPickY] = useState(20)
  const [dtWin, setDtWin] = useState(5)
  const states: State[] = runs.map((r, i) => r.run.states.find((s) => s.file === sel[i]) ?? defaultState(r.run))
  const selKey = sel.join('|')

  const { data: sds, error } = useLoad(
    () => Promise.all(runs.map((r, i) => loadState(repo, r.run, states[i]))),
    [repo, selKey],
    onAuth,
  )
  const zs = useMemo<ZoneStats[] | null>(
    () => (sds ? sds.map((sd, i) => zoneStats(sd, runs[i].grid, zone, runs[i].run.T_w, runs[i].run.physics.T_sat)) : null),
    [sds, zone, runs],
  )
  const items = useMemo<ProfileItem[] | null>(
    () =>
      sds
        ? sds.map((sd: StateData, i) => ({
            label: `${runs[i].title} · ${ms(states[i].t_ms)}`,
            sd, grid: runs[i].grid, Tw: runs[i].run.T_w, Tsat: runs[i].run.physics.T_sat,
          }))
        : null,
    // states залежать від selKey
    [sds, runs, selKey],
  )
  const reportItems = useMemo<ReportItem[]>(() => runs.map((r) => ({ label: r.title, series: r.series, dt: r.dt })), [runs])
  const bands = useMemo(() => windows.filter(([a, b]) => b > a), [windows])

  function setAllNear(t: number) {
    setSel(runs.map((r) => nearestState(r.run, t).file))
  }

  const zoneOk = zone[0] >= 6 && zone[1] <= 33
  const patch0 = base.run.meta.patch ?? ''
  const others = all.filter((r) => !ids.includes(r.id))

  return (
    <>
      <p>
        <a href="#/">← усі розрахунки</a>
      </p>
      <h1>Порівняння</h1>
      <ul className="cmp-runs">
        {runs.map((r, i) => (
          <li key={r.id}>
            <span className="swatch" data-c={i % PALETTE.length} />
            <a href={`#/run/${r.id}`}>{r.title}</a> {i === 0 && <span className="badge">база</span>}
            <span className="cmp-actions">
              {i > 0 && (
                <a href={compareHref([r.id, ...ids.filter((x) => x !== r.id)])} title="Зробити базою">
                  зробити базою
                </a>
              )}
              {ids.length > 1 && (
                <a href={compareHref(ids.filter((x) => x !== r.id))} title="Прибрати">
                  прибрати
                </a>
              )}
            </span>
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <p>
          <select value="" onChange={(e) => e.target.value && (location.hash = compareHref([...ids, e.target.value]))}>
            <option value="">+ додати розрахунок…</option>
            {others.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </p>
      )}

      <section>
        <h2>Стани в один момент</h2>
        <div className="controls">
          <ZoneInput zone={zone} setZone={setZone} />
          <label>
            Усім — найближчий до{' '}
            <select value="" onChange={(e) => e.target.value && setAllNear(Number(e.target.value))}>
              <option value="">моменту бази…</option>
              {base.run.states.map((s) => (
                <option key={s.file} value={s.t_ms}>
                  {ms(s.t_ms)}
                  {s.label ? ` — ${s.label}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="scroll">
          <table className="cmp">
            <thead>
              <tr>
                <th />
                {runs.map((r, i) => (
                  <th key={r.id}>
                    <span className="swatch" data-c={i % PALETTE.length} /> {r.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Момент</td>
                {runs.map((r, i) => (
                  <td key={r.id}>
                    <select value={sel[i]} onChange={(e) => setSel(sel.map((f, k) => (k === i ? e.target.value : f)))}>
                      {r.run.states.map((s) => (
                        <option key={s.file} value={s.file}>
                          {ms(s.t_ms)}
                          {s.label ? ` — ${s.label}` : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
              </tr>
              {zs &&
                ([
                  ['α, Вт/(м²·K)', (z: ZoneStats) => z.alpha, 1],
                  ['α_cond', (z: ZoneStats) => z.alpha_cond, 1],
                  ['α_rad', (z: ZoneStats) => z.alpha_rad, 1],
                  ['частка радіації, %', (z: ZoneStats) => z.rad_share * 100, 2],
                  ['δ (медіана), мм', (z: ZoneStats) => z.delta_med, 3],
                  ['q, кВт/м²', (z: ZoneStats) => z.q_kW, 1],
                  ['q_rad, кВт/м²', (z: ZoneStats) => z.q_rad_kW, 2],
                  ['Q зони плівки, Вт/м', (z: ZoneStats) => z.Q_zone, 0],
                ] as [string, (z: ZoneStats) => number | null, number][]).map(([label, f, d]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    {zs.map((z, i) => (
                      <td key={i}>
                        {num(f(z), d)} {i > 0 && <span className="muted small">{pct(f(z), f(zs[0]))}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              <tr>
                <td>Q усієї стінки, Вт/м</td>
                {states.map((s, i) => (
                  <td key={i}>
                    {num(s.Q_wall)} {i > 0 && <span className="muted small">{pct(s.Q_wall, states[0].Q_wall)}</span>}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        {error && <p className="error">{error}</p>}
        <h3>Правила порівняння (стани)</h3>
        <label className="small">
          Перевіряти dt за останні{' '}
          <input className="num" type="number" min={0.1} step={1} value={dtWin} onChange={(e) => setDtWin(Math.max(0.1, Number(e.target.value)))} /> мс
          до моменту
        </label>
        <ul className="rules">
          <Rule level={zoneOk ? 'ok' : 'bad'}>
            4. Зона плівки {zone[0]}…{zone[1]} мм {zoneOk ? 'без країв гарячої ділянки' : '— захоплює краї (5…6 або 33…35 мм)'}
          </Rule>
          {zs?.map((z, i) =>
            z.dome_y.length ? (
              <Rule key={`d${i}`} level="bad">
                5. {runs[i].title}: купол пари лежить на стінці в зоні (y = {num(Math.min(...z.dome_y), 1)}…{num(Math.max(...z.dome_y), 1)} мм)
              </Rule>
            ) : null,
          )}
          {zs && zs.every((z) => !z.dome_y.length) && <Rule level="ok">5. Купол пари не лежить на стінці в зоні плівки</Rule>}
          {runs.slice(1).map((r, k) => {
            const i = k + 1
            const patch = r.run.meta.patch ?? ''
            const dtT = Math.abs(states[i].t_ms - states[0].t_ms)
            const t1 = Math.min(states[i].t_ms, states[0].t_ms)
            const ratio = dtRatioMax(r.dt, base.dt, Math.max(0, t1 - dtWin), t1)
            return (
              <li key={r.id} className="rule-group">
                <b>{r.title}</b> проти бази:
                <ul>
                  <Rule level={!patch || !patch0 ? 'na' : patch === patch0 ? 'ok' : 'bad'}>
                    1. Patch: {patch || '—'} / база {patch0 || '—'}
                    {(!patch || !patch0) && ' (заповни «patch» у meta.json)'}
                  </Rule>
                  <Rule level={ratio === null ? 'na' : ratio <= 1.0001 ? 'ok' : 'bad'}>
                    2. Крок часу за {num(dtWin, 1)} мс до моменту:{' '}
                    {ratio === null ? 'немає історії dt' : ratio <= 1.0001 ? 'не більший за базовий' : `місцями у ${num(ratio, 1)} раза більший за базовий`}
                  </Rule>
                  <Rule level={dtT <= 0.1 ? 'ok' : 'warn'}>
                    3. Момент: {ms(states[i].t_ms)} проти {ms(states[0].t_ms)} (Δt = {num(dtT, 2)} мс)
                  </Rule>
                </ul>
              </li>
            )
          })}
        </ul>
        {items && (
          <>
            <h3>Профілі вздовж гарячої стінки</h3>
            <WallProfiles items={items} zone={zone} />
            <h3>Поперек плівки</h3>
            <label className="small">
              y = {num(pickY, 2)} мм{' '}
              <input type="range" min={0} max={60} step={0.5} value={pickY} onChange={(e) => setPickY(Number(e.target.value))} />
            </label>
            <CrossProfiles items={items} y={pickY} xmax={1} />
          </>
        )}
      </section>

      <section>
        <h2>Reports за часовими вікнами</h2>
        <div className="windows">
          {windows.map(([a, b], w) => (
            <span key={w} className="window">
              <input className="num" type="number" step={0.1} value={a} onChange={(e) => setWindows(windows.map((x, k) => (k === w ? [Number(e.target.value), x[1]] : x)))} />
              …
              <input className="num" type="number" step={0.1} value={b} onChange={(e) => setWindows(windows.map((x, k) => (k === w ? [x[0], Number(e.target.value)] : x)))} />{' '}
              мс
              {windows.length > 1 && (
                <button className="ghost" onClick={() => setWindows(windows.filter((_, k) => k !== w))} title="Прибрати вікно">
                  ×
                </button>
              )}
            </span>
          ))}
          <button className="ghost" onClick={() => setWindows([...windows, [windows.at(-1)![1], windows.at(-1)![1] + 10]])}>
            + вікно
          </button>
        </div>
        {bands.map(([a, b]) => {
          const rows = runs.map((r) => ({
            Q: windowMean(r.cum.Q_total, a, b),
            R: windowMean(r.cum.Q_rad, a, b),
            V: windowMean(r.cum.vapor, a, b),
          }))
          return (
            <div key={`${a}-${b}`} className="scroll">
              <h3>
                Вікно {num(a, 2)}…{num(b, 2)} мс
              </h3>
              <table className="cmp">
                <thead>
                  <tr>
                    <th />
                    <th>Q_total, Вт/м</th>
                    <th>Q_rad, Вт/м</th>
                    <th>частка рад.</th>
                    <th>пара, %</th>
                    <th title="Правило 2: dt у вікні не більший за базовий">dt</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r, i) => {
                    const v = rows[i]
                    const ratio = i ? dtRatioMax(r.dt, base.dt, a, b) : null
                    return (
                      <tr key={r.id}>
                        <td>
                          <span className="swatch" data-c={i % PALETTE.length} /> {r.title}
                        </td>
                        <td>
                          {num(v.Q)} {i > 0 && <span className="muted small">{pct(v.Q, rows[0].Q)}</span>}
                        </td>
                        <td>
                          {num(v.R, 1)} {i > 0 && <span className="muted small">{pct(v.R, rows[0].R)}</span>}
                        </td>
                        <td>{v.Q && v.R !== null ? `${num((100 * v.R) / v.Q, 2)} %` : '—'}</td>
                        <td>{v.V === null ? '—' : num(v.V * 100, 3)}</td>
                        <td className={ratio !== null && ratio > 1.0001 ? 'bad' : undefined}>
                          {i === 0 ? 'база' : ratio === null ? '?' : ratio <= 1.0001 ? '✓' : `×${num(ratio, 1)}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {rows.some((x) => x.Q === null) && <p className="small warn">Вікно виходить за межі reports одного з розрахунків («—»).</p>}
            </div>
          )
        })}
        <p className="small muted">
          Середні за часом з повної роздільності reports. Q_total включає краї гарячої ділянки (~50 %); для α і δ дивись
          таблицю станів вище.
        </p>
        <ReportCharts items={reportItems} bands={bands} syncKey="compare" />
        <h3>Крок часу</h3>
        <DtCharts items={reportItems} syncKey="compare" />
      </section>
    </>
  )
}
