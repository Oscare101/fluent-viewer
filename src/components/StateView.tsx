import { useMemo, useState } from 'react'
import type { AuthError, Repo } from '../github'
import type { Grid, Run } from '../types'
import { FIELD_INFO, defaultState, loadState, zoneStats, type FieldKey } from '../data'
import { useLoad } from '../hooks'
import { ms, num } from '../format'
import type { Palette } from '../colormap'
import FieldView from './FieldView'
import { CrossProfiles, WallProfiles, type ProfileItem } from './Profiles'

const WIDTHS: [number, string][] = [
  [0.3, 'біля стінки 0.3 мм'],
  [1, 'біля стінки 1 мм'],
  [3, '3 мм'],
  [Infinity, 'уся область'],
]

export function parseHeights(s: string): number[] {
  return s
    .split(/[\s,;]+/)
    .map((x) => Number(x.replace(',', '.')))
    .filter((x) => Number.isFinite(x) && x >= 0 && x <= 1000)
}

export default function StateView({ repo, run, grid, title, onAuth }: { repo: Repo; run: Run; grid: Grid; title: string; onAuth: (e: AuthError) => void }) {
  const [file, setFile] = useState(() => defaultState(run).file)
  const [field, setField] = useState<FieldKey>('T')
  const [xmax, setXmax] = useState(1)
  const [robust, setRobust] = useState(false)
  const [smooth, setSmooth] = useState(true)
  const [banded, setBanded] = useState(false)
  const [palette, setPalette] = useState<Palette>('fluent')
  const [hText, setHText] = useState('10, 20, 30')
  const [average, setAverage] = useState(true)
  const heights = useMemo(() => parseHeights(hText), [hText])
  const state = run.states.find((s) => s.file === file) ?? defaultState(run)
  const { data: sd, error, loading } = useLoad(() => loadState(repo, run, state), [repo, run, state], onAuth)

  const items = useMemo<ProfileItem[] | null>(
    () => (sd ? [{ label: `${title}, ${ms(state.t_ms)}`, sd, grid, Tw: run.T_w, Tsat: run.physics.T_sat }] : null),
    [sd, state, grid, run, title],
  )
  const zs = useMemo(() => (sd ? zoneStats(sd, grid, run.zone_mm, run.T_w, run.physics.T_sat) : null), [sd, grid, run])
  const info = FIELD_INFO[field]
  const figTitle = `${info.label}${info.unit ? `, ${info.unit}` : ''} — ${title}, t = ${ms(state.t_ms)}`

  return (
    <>
      <div className="controls">
        <label>
          Момент{' '}
          <select value={state.file} onChange={(e) => setFile(e.target.value)}>
            {run.states.map((s) => (
              <option key={s.file} value={s.file}>
                {ms(s.t_ms)}
                {s.label ? ` — ${s.label}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Поле{' '}
          <select value={field} onChange={(e) => setField(e.target.value as FieldKey)}>
            {(Object.keys(FIELD_INFO) as FieldKey[]).map((k) => (
              <option key={k} value={k}>
                {FIELD_INFO[k].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Область{' '}
          <select value={String(xmax)} onChange={(e) => setXmax(Number(e.target.value))}>
            {WIDTHS.map(([w, l]) => (
              <option key={l} value={String(w)}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Палітра{' '}
          <select value={palette} onChange={(e) => setPalette(e.target.value as Palette)}>
            <option value="fluent">Fluent (rainbow)</option>
            <option value="science">наукова</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} /> плавно (як Node Values)
        </label>
        <label className="check">
          <input type="checkbox" checked={banded} onChange={(e) => setBanded(e.target.checked)} /> смуги (Banded)
        </label>
        <label className="check">
          <input type="checkbox" checked={robust} onChange={(e) => setRobust(e.target.checked)} /> шкала 1…99 %
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {loading && !sd && <p className="muted">Завантажую стан…</p>}
      {sd && items && (
        <>
          {zs && (
            <p className="small">
              Зона y = {run.zone_mm[0]}…{run.zone_mm[1]} мм: α = <b>{num(zs.alpha, 1)}</b> Вт/(м²·K), δ = <b>{num(zs.delta_med, 3)}</b> мм,
              q = {num(zs.q_kW, 1)} кВт/м², частка радіації {num(zs.rad_share * 100, 1)} %
              {zs.dome_y.length > 0 && <span className="bad"> · купол на стінці в зоні</span>}
            </p>
          )}
          <FieldView
            grid={grid}
            values={sd.fields[field]}
            field={field}
            xmax={xmax}
            robust={robust}
            smooth={smooth}
            levels={banded ? 20 : 0}
            palette={palette}
            Tw={run.T_w}
            title={figTitle}
            pickYs={heights}
            onPick={(y) => setHText(num(y, 2).replace(',', '.'))}
          />
          {!smooth && <p className="small muted">Комірки показано як є: у плівці 0.06–0.3 мм лише 3–10 стовпців (перша комірка 0.0194 мм).</p>}

          <h3>Поперек плівки</h3>
          <div className="controls">
            <label>
              Висоти y, мм{' '}
              <input className="heights" value={hText} onChange={(e) => setHText(e.target.value)} placeholder="10, 20, 30" />
            </label>
            <label className="check">
              <input type="checkbox" checked={average} onChange={(e) => setAverage(e.target.checked)} /> усереднити
            </label>
          </div>
          <CrossProfiles items={items} heights={heights} average={average} xmax={Number.isFinite(xmax) ? xmax : 3} />

          <h3>Уздовж гарячої стінки</h3>
          <WallProfiles items={items} zone={run.zone_mm} detail />
        </>
      )}
    </>
  )
}
