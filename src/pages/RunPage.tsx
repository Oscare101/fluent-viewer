import { useEffect, useState } from 'react'
import type { AuthError, Repo } from '../github'
import type { FileInfo, IndexFile, Run, State, Table } from '../types'
import { useLoad } from '../hooks'
import { bytes, mediumLabel, ms, num, statusLabel } from '../format'

async function load(repo: Repo, id: string) {
  const run = await repo.json<Run>(`${id}/preview/run.json`)
  const index = await repo.json<IndexFile>('index.json').catch(() => null)
  const entry = index?.runs.find((r) => r.id === id)
  return { run, title: entry?.title ?? run.meta.title ?? id }
}

function tableRange(t: Table, digits: number, unit = ''): string {
  if (t === null) return '—'
  if (typeof t === 'number') return `${num(t, digits)}${unit} (const)`
  return `${num(t[0][1], digits)}…${num(t[t.length - 1][1], digits)}${unit} при ${num(t[0][0])}…${num(t[t.length - 1][0])} K`
}

function domeCell(s: State) {
  if (!s.dome_on_wall_mm.length) return <span className="muted">—</span>
  const y = `${num(Math.min(...s.dome_on_wall_mm), 1)}…${num(Math.max(...s.dome_on_wall_mm), 1)}`
  return s.dome_in_zone ? <span className="bad">у зоні, y {y}</span> : <span className="muted">край, y {y}</span>
}

function StatesTable({ run }: { run: Run }) {
  const [z0, z1] = run.zone_mm
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>t</th>
            <th>стан</th>
            <th title={`зона плівки y = ${z0}…${z1} мм`}>α</th>
            <th>α_cond</th>
            <th>α_rad</th>
            <th>частка рад.</th>
            <th>δ мед.</th>
            <th>q, кВт/м²</th>
            <th>Q_wall, Вт/м</th>
            <th>Q_rad, Вт/м</th>
            <th title="Σq·Δy проти total-heat з report">баланс</th>
            <th title="δ > 1 мм на hot_wall">купол</th>
          </tr>
        </thead>
        <tbody>
          {run.states.map((s) => (
            <tr key={s.file} className={s.label ? 'pinned' : undefined}>
              <td className="nowrap">{ms(s.t_ms)}</td>
              <td>
                <span className="nowrap">{{ start: 'старт', named: 'збережений', autosave: 'autosave' }[s.kind]}</span>
                {s.label && <div className="label">{s.label}</div>}
              </td>
              <td>{num(s.film.alpha, 1)}</td>
              <td>{num(s.film.alpha_cond, 1)}</td>
              <td>{num(s.film.alpha_rad, 1)}</td>
              <td>{s.film.rad_share === null ? '—' : `${num(s.film.rad_share * 100, 1)} %`}</td>
              <td>{num(s.film.delta_median_mm, 3)}</td>
              <td>{num(s.film.q_kW, 1)}</td>
              <td>{num(s.Q_wall)}</td>
              <td>{num(s.Q_rad, 1)}</td>
              <td className={s.balance_err_pct !== null && Math.abs(s.balance_err_pct) > 0.5 ? 'bad' : undefined}>
                {s.balance_err_pct === null ? '—' : `${num(s.balance_err_pct, 2)} %`}
              </td>
              <td>{domeCell(s)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        α, δ, q — зона плівки y = {z0}…{z1} мм (без країв гарячої ділянки); δ — медіана на y = 8…32 мм. α = q/(T_w − T_sat).
      </p>
    </div>
  )
}

async function download(repo: Repo, path: string, name: string) {
  const buf = await repo.buffer(path)
  const url = URL.createObjectURL(new Blob([buf]))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function Files({ repo, run }: { repo: Repo; run: Run }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const groups: [string, string, FileInfo[]][] = [
    ['case', '', run.files.cas],
    ['data (стани)', '', run.files.dat],
    ['reports', '', run.files.out],
    ['транскрипти', '', run.files.trn],
    ['документи', 'docs/', run.files.docs],
  ]
  async function get(sub: string, f: FileInfo) {
    setBusy(f.name)
    setErr(null)
    try {
      await download(repo, `${run.id}/${sub}${f.name}`, f.name)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      {err && <p className="error">{err}</p>}
      {groups
        .filter(([, , list]) => list.length)
        .map(([title, sub, list]) => (
          <div key={title} className="files">
            <h3>{title}</h3>
            <ul>
              {list.map((f) => (
                <li key={f.name}>
                  <button className="link" disabled={busy !== null} onClick={() => get(sub, f)}>
                    {f.name}
                  </button>
                  <span className="muted">{busy === f.name ? 'завантажую…' : bytes(f.size)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </>
  )
}

function Screenshots({ repo, run }: { repo: Repo; run: Run }) {
  const [urls, setUrls] = useState<{ name: string; url: string }[] | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => () => urls?.forEach((u) => URL.revokeObjectURL(u.url)), [urls])
  const list = run.files.screenshots
  if (!list.length) return null
  async function show() {
    setBusy(true)
    try {
      const out = []
      for (const f of list) {
        const buf = await repo.buffer(`${run.id}/screenshots/${f.name}`)
        out.push({ name: f.name, url: URL.createObjectURL(new Blob([buf])) })
      }
      setUrls(out)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section>
      <h2>Скріншоти ({list.length})</h2>
      {urls ? (
        <div className="gallery">
          {urls.map((u) => (
            <figure key={u.name}>
              <img src={u.url} alt={u.name} loading="lazy" />
              <figcaption>{u.name}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <button onClick={show} disabled={busy}>
          {busy ? 'Завантажую…' : 'Показати'}
        </button>
      )}
    </section>
  )
}

export default function RunPage({ repo, id, version, onAuth }: { repo: Repo; id: string; version: number; onAuth: (e: AuthError) => void }) {
  const { data, error, loading } = useLoad(() => load(repo, id), [repo, id, version], onAuth)
  if (loading && !data) return <p className="muted">Завантажую розрахунок…</p>
  if (error) return <p className="error">{error}</p>
  if (!data) return null
  const { run, title } = data
  const ph = run.physics
  const liq = ph.materials.liquid
  const vap = ph.materials.vapor
  const meta = run.meta

  return (
    <>
      <p>
        <a href="#/">← усі розрахунки</a>
      </p>
      <h1>{title}</h1>
      <p className="muted">
        <code>{run.id}</code>
        {meta.status && <span className={`badge ${meta.status}`}>{statusLabel(meta.status)}</span>}
        {meta.baseline && (
          <>
            {' '}
            · база для порівняння: <a href={`#/run/${meta.baseline}`}>{meta.baseline}</a>
          </>
        )}
      </p>
      {meta.notes && <p className="notes">{meta.notes}</p>}
      {meta.tags && meta.tags.length > 0 && <p className="run-tags">{meta.tags.map((t) => `#${t}`).join(' ')}</p>}

      {run.warnings.length > 0 && (
        <section>
          <h2>Попередження</h2>
          <ul className="warnings">
            {run.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Постановка</h2>
        <dl className="grid">
          <dt>T стінки</dt>
          <dd>{num(run.T_w)} K</dd>
          <dt>Рідина</dt>
          <dd>
            {mediumLabel(run.medium)} <span className="muted">({run.liquid})</span>
          </dd>
          <dt>Таблиці пари λ, μ</dt>
          <dd className={ph.vapor_table_Tmax !== null && ph.vapor_table_Tmax < run.T_w ? 'bad' : undefined}>
            до {num(ph.vapor_table_Tmax)} K{ph.vapor_table_Tmax !== null && ph.vapor_table_Tmax >= 2000 ? ' (IAPWS)' : ''}
          </dd>
          <dt>Lee</dt>
          <dd>{ph.lee ? `evaporation ${num(ph.lee.evaporation)}, condensation ${num(ph.lee.condensation)} 1/s` : '—'}</dd>
          <dt>T_sat</dt>
          <dd>{num(ph.T_sat, 2)} K</dd>
          <dt>σ</dt>
          <dd>{num(ph.sigma, 4)} Н/м</dd>
          <dt>Радіація</dt>
          <dd>{ph.radiation ?? '—'}</dd>
          <dt>Operating density</dt>
          <dd>{num(ph.operating_density, 1)} кг/м³</dd>
          <dt>Max iterations / step</dt>
          <dd>{num(ph.max_iter)}</dd>
          {liq && (
            <>
              <dt>λ рідини</dt>
              <dd>{tableRange(liq.k, 3, ' Вт/(м·K)')}</dd>
              <dt>μ рідини</dt>
              <dd>{tableRange(liq.mu, 6, ' Па·с')}</dd>
            </>
          )}
          {vap && (
            <>
              <dt>λ пари</dt>
              <dd>{tableRange(vap.k, 4, ' Вт/(м·K)')}</dd>
            </>
          )}
          {meta.patch && (
            <>
              <dt>Patch</dt>
              <dd>{meta.patch}</dd>
            </>
          )}
          <dt>Case</dt>
          <dd>
            <code>{run.case}</code>
          </dd>
        </dl>
      </section>

      <section>
        <h2>Стани ({run.states.length})</h2>
        <StatesTable run={run} />
      </section>

      <section>
        <h2>Reports і крок часу</h2>
        <ul className="plain">
          {run.reports.map((r) => (
            <li key={r.group}>
              <b>{r.group}</b> ({r.columns.join(', ')}): {ms(r.t_ms[0])} … {ms(r.t_ms[1])}, {num(r.n_raw)} кроків
              <span className="muted"> · сегменти: {r.segments.join(', ')}</span>
            </li>
          ))}
          {run.dt_summary && (
            <li>
              Транскрипт: змін dt — {run.dt_summary.changes}, відкатів — {run.dt_summary.rollbacks}, кроків без збіжності —{' '}
              {run.dt_summary.not_converged}
            </li>
          )}
        </ul>
        <p className="muted small">Графіки reports, контури полів і профілі — наступний етап.</p>
      </section>

      <Screenshots repo={repo} run={run} />

      <section>
        <h2>Файли</h2>
        <Files repo={repo} run={run} />
      </section>

      <p className="muted small">Превʼю згенеровано {new Date(run.generated).toLocaleString('uk-UA')}.</p>
    </>
  )
}
