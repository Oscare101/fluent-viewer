import { useMemo, useState } from 'react'
import type { AuthError, Repo } from '../github'
import type { IndexFile, IndexRun } from '../types'
import { compareHref, useLoad } from '../hooks'
import { mediumLabel, ms, statusLabel } from '../format'

const RUN_CASE = /^([^/]+\/T\d+\/[^/]+)\/[^/]+\.cas\.h5$/

async function load(repo: Repo) {
  const tree = await repo.files()
  const index = tree.has('index.json') ? await repo.json<IndexFile>('index.json') : { version: 1, runs: [] }
  const known = new Set(index.runs.map((r) => r.id))
  // Папки з .cas, яких ще немає в index.json (файли запушено без py hub.py).
  const pending = new Set<string>()
  for (const p of tree.keys()) {
    const m = p.match(RUN_CASE)
    if (m && !known.has(m[1])) pending.add(m[1])
  }
  return { runs: index.runs, pending: [...pending].sort() }
}

function matches(r: IndexRun, q: string): boolean {
  const hay = [r.title, r.id, r.medium, mediumLabel(r.medium), r.liquid, r.status, statusLabel(r.status), r.patch, r.notes, ...r.tags]
    .join(' ')
    .toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}

export default function RunList({ repo, version, onAuth }: { repo: Repo; version: number; onAuth: (e: AuthError) => void }) {
  const { data, error, loading } = useLoad(() => load(repo), [repo, version], onAuth)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const groups = useMemo(() => {
    const g = new Map<string, IndexRun[]>()
    for (const r of (data?.runs ?? []).filter((r) => matches(r, q))) {
      if (!g.has(r.geometry)) g.set(r.geometry, [])
      g.get(r.geometry)!.push(r)
    }
    for (const list of g.values()) list.sort((a, b) => a.T_w - b.T_w || a.medium.localeCompare(b.medium) || a.id.localeCompare(b.id))
    return [...g.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [data, q])

  if (loading && !data) return <p className="muted">Завантажую список розрахунків…</p>
  if (error) return <p className="error">{error}</p>
  if (!data) return null

  return (
    <>
      <div className="toolbar">
        <h1>Розрахунки</h1>
        <input
          type="search"
          placeholder="Пошук: назва, рідина, теги, нотатки…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {data.pending.length > 0 && (
        <p className="warn">
          Без превʼю (запусти <code>py hub.py</code>): {data.pending.join(', ')}
        </p>
      )}
      {groups.length === 0 && <p className="muted">{data.runs.length ? 'Нічого не знайдено.' : 'Розрахунків ще немає.'}</p>}
      {groups.map(([geom, runs]) => (
        <section key={geom}>
          <h2>{geom}</h2>
          <ul className="runs">
            {runs.map((r) => (
              <li key={r.id} className="run-row">
                <label className="pick" title="Вибрати для порівняння">
                  <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} />
                </label>
                <a className="run" href={`#/run/${r.id}`}>
                  <span className="run-title">{r.title}</span>
                  <span className="run-meta">
                    {r.status && <span className={`badge ${r.status}`}>{statusLabel(r.status)}</span>}
                    <span>станів: {r.n_states}</span>
                    <span>останній: {ms(r.states_t_ms[r.states_t_ms.length - 1])}</span>
                    {r.reports_t_ms && <span>reports до {ms(r.reports_t_ms[1])}</span>}
                    {r.warnings > 0 && <span className="badge warn-badge">попереджень: {r.warnings}</span>}
                  </span>
                  {r.tags.length > 0 && <span className="run-tags">{r.tags.map((t) => `#${t}`).join(' ')}</span>}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {picked.length > 0 && (
        <div className="compare-bar">
          <span>
            Вибрано: {picked.length}
            {picked.length === 1 && ' (вибери ще хоча б один)'}
          </span>
          <button className="ghost" onClick={() => setPicked([])}>
            Скинути
          </button>
          {picked.length > 1 && (
            <a className="button" href={compareHref(picked)}>
              Порівняти
            </a>
          )}
        </div>
      )}
      <p className="small muted">Познач галочками 2+ розрахунки, щоб порівняти. Перший вибраний — база.</p>
    </>
  )
}
