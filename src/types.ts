// Формати index.json і preview/run.json — їх генерує fluent-data/hub.py (extract/preview.py).

export interface Meta {
  title?: string
  status?: string
  patch?: string
  baseline?: string
  tags?: string[]
  notes?: string
  pinned?: Record<string, string>
}

export interface IndexRun {
  id: string
  geometry: string
  T_w: number
  medium: string
  liquid: string
  variant: string | null
  auto_title: string
  title: string
  status: string
  patch: string
  baseline: string
  tags: string[]
  notes: string
  n_states: number
  states_t_ms: number[]
  reports_t_ms: [number, number] | null
  vapor_table_Tmax: number | null
  lee: { evaporation: number; condensation: number } | null
  warnings: number
  generated: string
}

export interface IndexFile {
  version: number
  runs: IndexRun[]
}

export interface FilmStats {
  zone_mm: [number, number]
  q_kW: number | null
  q_cond_kW: number | null
  q_rad_kW: number | null
  alpha: number | null
  alpha_cond: number | null
  alpha_rad: number | null
  rad_share: number | null
  delta_median_mm: number | null
  delta_mean_mm: number | null
  delta_min_mm: number | null
  delta_max_mm: number | null
  v_vapor_film: number | null
  Q_zone: number | null
}

export interface State {
  file: string
  bin: string
  t_ms: number
  step: number
  Q_wall: number
  Q_rad: number
  Q_edge_bottom: number
  Q_edge_top: number
  film: FilmStats
  dome_on_wall_mm: number[]
  dome_in_zone: boolean
  ranges: Record<string, [number, number]>
  kind: 'start' | 'named' | 'autosave'
  label: string | null
  Q_report: number | null
  balance_err_pct: number | null
}

export interface ReportMeta {
  group: string
  kind: 'Q_total' | 'Q_rad' | 'vapor' | 'other'
  columns: string[]
  file: string
  n: number
  n_raw: number
  t_ms: [number, number]
  segments: string[]
}

export type Table = [number, number][] | number | null

export interface Material {
  name: string
  density: string | null
  k: Table
  mu: Table
  cp: Table
}

export interface Physics {
  lee: { evaporation: number; condensation: number } | null
  T_sat: number
  sigma: number | null
  radiation: string | null
  operating_density: number | null
  max_iter: number | null
  phases: Record<string, string>
  materials: { liquid?: Material; vapor?: Material }
  vapor_table_Tmax: number | null
}

export interface FileInfo {
  name: string
  size: number
}

export interface Run {
  id: string
  geometry: string
  T_w: number
  medium: string
  liquid: string
  variant: string | null
  case: string
  physics: Physics
  zone_mm: [number, number]
  states: State[]
  reports: ReportMeta[]
  dt_history: string | null
  dt_summary: { changes: number; rollbacks: number; not_converged: number } | null
  files: Record<'cas' | 'dat' | 'out' | 'trn' | 'screenshots' | 'docs', FileInfo[]>
  warnings: string[]
  meta: Meta
  generated: string
}
