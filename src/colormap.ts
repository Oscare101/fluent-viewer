// Кольорові шкали для контурів (лінійна інтерполяція між опорними кольорами → таблиця 256 RGB).
import type { FieldKey } from './data'

const ANCHORS: Record<string, string[]> = {
  fluent: ['#0000ff', '#00ffff', '#00ff00', '#ffff00', '#ff0000'], // типова rainbow-шкала Fluent
  heat: ['#000004', '#420a68', '#932667', '#dd513a', '#fca50a', '#fcffa4'],
  vapor: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'],
  diverging: ['#2166ac', '#67a9cf', '#f2f2f2', '#ef8a62', '#b2182b'],
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
}

export type Palette = 'fluent' | 'science'

const SCIENCE: Record<FieldKey, string> = { T: 'heat', vf: 'vapor', U: 'diverging', V: 'diverging', P: 'viridis', mt: 'viridis' }

const cache = new Map<string, Uint8ClampedArray>()

function hex(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function lut(field: FieldKey, palette: Palette): Uint8ClampedArray {
  const name = palette === 'fluent' ? 'fluent' : SCIENCE[field]
  let t = cache.get(name)
  if (!t) {
    const a = ANCHORS[name].map(hex)
    t = new Uint8ClampedArray(256 * 3)
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * (a.length - 1)
      const k = Math.min(Math.floor(x), a.length - 2)
      const f = x - k
      for (let c = 0; c < 3; c++) t[i * 3 + c] = a[k][c] + f * (a[k + 1][c] - a[k][c])
    }
    cache.set(name, t)
  }
  return t
}

/** Швидкості — симетрична шкала відносно нуля. */
export function isSigned(field: FieldKey): boolean {
  return field === 'U' || field === 'V'
}
