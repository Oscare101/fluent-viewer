import { useMemo, useState } from 'react'
import type { AuthError, Repo } from '../github'
import type { Grid, Run } from '../types'
import { FIELD_INFO, defaultState, loadState, zoneStats, type FieldKey } from '../data'
import { useLoad } from '../hooks'
import { ms, num } from '../format'
import FieldView from './FieldView'
import { CrossProfiles, WallProfiles, type ProfileItem } from './Profiles'

const WIDTHS: [number, string][] = [
  [0.3, 'біля стінки 0.3 мм'],
  [1, 'біля стінки 1 мм'],
  [3, '3 мм'],
  [Infinity, 'уся область'],
]

export default function StateView({ repo, run, grid, onAuth }: { repo: Repo; run: Run; grid: Grid; onAuth: (e: AuthError) => void }) {
  const [file, setFile] = useState(() => defaultState(run).file)
  const [field, setField] = useState<FieldKey>('vf')
  const [xmax, setXmax] = useState(1)
  const [robust, setRobust] = useState(false)
  const [pickY, setPickY] = useState(20)
  const state = run.states.find((s) => s.file === file) ?? defaultState(run)
  const { data: sd, error, loading } = useLoad(() => loadState(repo, run, state), [repo, run, state], onAuth)

  const items = useMemo<ProfileItem[] | null>(
    () => (sd ? [{ label: ms(state.t_ms), sd, grid, Tw: run.T_w, Tsat: run.physics.T_sat }] : null),
    [sd, state, grid, run],
  )
  const zs = useMemo(() => (sd ? zoneStats(sd, grid, run.zone_mm, run.T_w, run.physics.T_sat) : null), [sd, grid, run])

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
          <div className="state-layout">
            <FieldView grid={grid} values={sd.fields[field]} field={field} xmax={xmax} robust={robust} pickY={pickY} onPick={setPickY} />
            <div className="state-side">
              <h3>Поперек плівки</h3>
              <label className="small">
                y = {num(pickY, 2)} мм{' '}
                <input
                  type="range"
                  min={grid.ye[0]}
                  max={grid.ye[grid.ny]}
                  step={0.5}
                  value={pickY}
                  onChange={(e) => setPickY(Number(e.target.value))}
                />
              </label>
              <CrossProfiles items={items} y={pickY} xmax={Number.isFinite(xmax) ? xmax : 3} />
            </div>
          </div>
          <h3>Уздовж гарячої стінки</h3>
          <WallProfiles items={items} zone={run.zone_mm} detail />
        </>
      )}
    </>
  )
}
