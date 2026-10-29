export function num(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toLocaleString('uk-UA', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function ms(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return num(v, v < 1 ? 3 : 2) + ' мс'
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} Б`
  if (n < 1024 ** 2) return `${num(n / 1024, 0)} КБ`
  return `${num(n / 1024 ** 2, 1)} МБ`
}

export function mediumLabel(m: string): string {
  if (m === 'water') return 'вода'
  const p = m.match(/^nf_([^_]+)_(.+)$/)
  return p ? `нанорідина ${p[1]} ${p[2].replace('p', '.')} %` : m
}

export function statusLabel(s: string): string {
  return { running: 'рахується', done: 'завершено' }[s] ?? s
}
