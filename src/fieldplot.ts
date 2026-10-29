// Контури поля на тензорній сітці у стилі Fluent: плавна інтерполяція між центрами комірок (як Node Values),
// вертикальна шкала з підписами 1.23e+02, заголовок. Один код для екрана й PNG.
import type { Grid } from './types'
import type { FieldKey } from './data'
import type { Theme } from './plot'
import { expo, fmtTick, niceTicks } from './plot'

export interface FieldParams {
  grid: Grid
  values: Float32Array
  field: FieldKey
  xmax: number // мм від стінки; Infinity — уся область
  lo: number
  hi: number
  lut: Uint8ClampedArray
  smooth: boolean // false — показати комірки як є
  levels: number // 0 — плавна шкала; N — N смуг (Banded у Fluent)
  Tw: number
  pickYs: number[]
  title: string
  unit: string
}

export interface FieldLayout {
  x: number
  y: number
  w: number
  h: number
  X1: number
}

function upper(a: ArrayLike<number>, x: number): number {
  let lo = 0
  let hi = a.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (a[m] <= x) lo = m
    else hi = m
  }
  return lo
}

const font = (px: number, bold = false) => `${bold ? 'bold ' : ''}${px}px "DejaVu Sans", "Segoe UI", system-ui, sans-serif`

/** Розміри: для «усієї області» — фізичні пропорції; для пристінної смуги — уся доступна ширина. */
export function fieldLayout(W: number, H: number, p: FieldParams, f: number): FieldLayout {
  const g = p.grid
  const X1 = Math.min(p.xmax, g.xe[g.nx])
  const L = 56 * f, T = (p.title ? 34 : 12) * f, B = 44 * f, R = 104 * f
  const h = Math.max(50, H - T - B)
  const full = !Number.isFinite(p.xmax)
  const avail = Math.max(50, W - L - R)
  const w = full ? Math.min(avail, (h * X1) / (g.ye[g.ny] - g.ye[0])) : avail
  return { x: L, y: T, w, h, X1 }
}

/** Ширина полотна, щоб «уся область» мала фізичні пропорції без порожнього місця (для PNG). */
export function fieldNaturalWidth(H: number, p: FieldParams, f: number): number {
  const g = p.grid
  const X1 = Math.min(p.xmax, g.xe[g.nx])
  const T = (p.title ? 34 : 12) * f, B = 44 * f
  return 56 * f + ((H - T - B) * X1) / (g.ye[g.ny] - g.ye[0]) + 104 * f
}

/** S — фізичних пікселів на логічний (devicePixelRatio або масштаб експорту). */
export function drawField(g2: CanvasRenderingContext2D, W: number, H: number, p: FieldParams, th: Theme, f: number, S: number): FieldLayout {
  const G = p.grid
  const Lt = fieldLayout(W, H, p, f)
  const { X1 } = Lt
  const y0 = G.ye[0], y1 = G.ye[G.ny]
  g2.save()
  g2.fillStyle = th.bg
  g2.fillRect(0, 0, W, H)

  // --- пікселі поля
  const pw = Math.max(1, Math.round(Lt.w * S)), ph = Math.max(1, Math.round(Lt.h * S))
  const img = g2.createImageData(pw, ph)
  const D = img.data
  const nx = G.nx
  const v = p.values
  const span = p.hi - p.lo || 1
  // вузли по x: віртуальний вузол на стінці (x = 0) + центри комірок
  const nodesX = [0, ...G.xc]
  const wallVal = (j: number): number => {
    if (p.field === 'T') return G.yc[j] >= G.hot_wall_y_mm[0] && G.yc[j] <= G.hot_wall_y_mm[1] ? p.Tw : v[j * nx]
    if (p.field === 'U' || p.field === 'V') return 0
    return v[j * nx]
  }
  const at = (j: number, k: number) => (k === 0 ? wallVal(j) : v[j * nx + k - 1])
  const colK = new Int32Array(pw), colW = new Float32Array(pw), cellI = new Int32Array(pw)
  for (let px = 0; px < pw; px++) {
    const x = ((px + 0.5) / pw) * X1
    const k = Math.min(upper(nodesX, x), nodesX.length - 2)
    colK[px] = k
    colW[px] = Math.min(1, Math.max(0, (x - nodesX[k]) / (nodesX[k + 1] - nodesX[k])))
    cellI[px] = Math.min(upper(G.xe, x), nx - 1)
  }
  const ny = G.ny
  for (let py = 0; py < ph; py++) {
    const y = y1 - ((py + 0.5) / ph) * (y1 - y0)
    let j0: number, j1: number, wy: number
    if (y <= G.yc[0]) { j0 = j1 = 0; wy = 0 }
    else if (y >= G.yc[ny - 1]) { j0 = j1 = ny - 1; wy = 0 }
    else { j0 = upper(G.yc, y); j1 = j0 + 1; wy = (y - G.yc[j0]) / (G.yc[j1] - G.yc[j0]) }
    const jc = Math.min(upper(G.ye, y), ny - 1)
    for (let px = 0; px < pw; px++) {
      let val: number
      if (p.smooth) {
        const k = colK[px], wx = colW[px]
        const a = at(j0, k) * (1 - wx) + at(j0, k + 1) * wx
        const b = at(j1, k) * (1 - wx) + at(j1, k + 1) * wx
        val = a * (1 - wy) + b * wy
        if (!Number.isFinite(val)) val = v[jc * nx + cellI[px]]
      } else val = v[jc * nx + cellI[px]]
      const o = (py * pw + px) * 4
      if (!Number.isFinite(val)) { D[o + 3] = 0; continue }
      let t = (val - p.lo) / span
      t = t < 0 ? 0 : t > 1 ? 1 : t
      if (p.levels > 0) t = Math.min(1, (Math.min(Math.floor(t * p.levels), p.levels - 1) + 0.5) / p.levels)
      const c = Math.round(t * 255) * 3
      D[o] = p.lut[c]
      D[o + 1] = p.lut[c + 1]
      D[o + 2] = p.lut[c + 2]
      D[o + 3] = 255
    }
  }
  const tr = g2.getTransform()
  g2.putImageData(img, Math.round(Lt.x * S + tr.e), Math.round(Lt.y * S + tr.f))

  const sx = (x: number) => Lt.x + (x / X1) * Lt.w
  const sy = (y: number) => Lt.y + (1 - (y - y0) / (y1 - y0)) * Lt.h

  // гаряча стінка, вибрані висоти
  g2.strokeStyle = '#d00000'
  g2.lineWidth = 3 * f
  g2.beginPath()
  g2.moveTo(Lt.x - 1.5 * f, sy(G.hot_wall_y_mm[0]))
  g2.lineTo(Lt.x - 1.5 * f, sy(G.hot_wall_y_mm[1]))
  g2.stroke()
  g2.strokeStyle = '#000'
  g2.lineWidth = 1 * f
  g2.setLineDash([5 * f, 3 * f])
  for (const y of p.pickYs) {
    g2.beginPath()
    g2.moveTo(Lt.x, sy(y))
    g2.lineTo(Lt.x + Lt.w, sy(y))
    g2.stroke()
  }
  g2.setLineDash([])

  // рамка й осі
  g2.strokeStyle = th.fg
  g2.fillStyle = th.fg
  g2.lineWidth = 1 * f
  g2.strokeRect(Lt.x, Lt.y, Lt.w, Lt.h)
  g2.font = font(11 * f)
  g2.textAlign = 'right'
  g2.textBaseline = 'middle'
  const { ticks: yt, step: ys } = niceTicks(y0, y1, Math.max(4, Math.round(Lt.h / (60 * f))))
  g2.beginPath()
  for (const t of yt) {
    g2.moveTo(Lt.x - 4 * f, sy(t))
    g2.lineTo(Lt.x, sy(t))
    g2.fillText(fmtTick(t, ys), Lt.x - 6 * f, sy(t))
  }
  const { ticks: xt, step: xs } = niceTicks(0, X1, Math.max(2, Math.round(Lt.w / (70 * f))))
  g2.textAlign = 'center'
  g2.textBaseline = 'top'
  for (const t of xt) {
    g2.moveTo(sx(t), Lt.y + Lt.h)
    g2.lineTo(sx(t), Lt.y + Lt.h + 4 * f)
    g2.fillText(fmtTick(t, xs), sx(t), Lt.y + Lt.h + 6 * f)
  }
  g2.stroke()
  g2.font = font(12 * f, true)
  g2.textBaseline = 'bottom'
  g2.fillText('Відстань від гарячої стінки, мм', Lt.x + Lt.w / 2, H - 3 * f, Math.max(Lt.w + 80 * f, 160 * f))
  g2.save()
  g2.translate(13 * f, Lt.y + Lt.h / 2)
  g2.rotate(-Math.PI / 2)
  g2.textBaseline = 'middle'
  g2.fillText('Висота y, мм', 0, 0)
  g2.restore()

  // шкала кольорів (вертикальна, як у Fluent)
  const bx = Lt.x + Lt.w + 16 * f, bw = 16 * f
  const barPx = Math.max(1, Math.round(Lt.h * S))
  const bimg = g2.createImageData(Math.max(1, Math.round(bw * S)), barPx)
  for (let py = 0; py < barPx; py++) {
    let t = 1 - (py + 0.5) / barPx
    if (p.levels > 0) t = Math.min(1, (Math.min(Math.floor(t * p.levels), p.levels - 1) + 0.5) / p.levels)
    const c = Math.round(t * 255) * 3
    for (let px = 0; px < bimg.width; px++) {
      const o = (py * bimg.width + px) * 4
      bimg.data[o] = p.lut[c]
      bimg.data[o + 1] = p.lut[c + 1]
      bimg.data[o + 2] = p.lut[c + 2]
      bimg.data[o + 3] = 255
    }
  }
  g2.putImageData(bimg, Math.round(bx * S + tr.e), Math.round(Lt.y * S + tr.f))
  g2.strokeRect(bx, Lt.y, bw, Lt.h)
  const nLab = p.levels > 0 && p.levels <= 20 ? p.levels : 10
  g2.font = font(10.5 * f)
  g2.textAlign = 'left'
  g2.textBaseline = 'middle'
  const fmtV = (x: number) => (p.field === 'vf' ? x.toFixed(2) : expo(x, 2))
  for (let i = 0; i <= nLab; i++) {
    const val = p.lo + ((p.hi - p.lo) * i) / nLab
    const y = Lt.y + Lt.h * (1 - i / nLab)
    g2.beginPath()
    g2.moveTo(bx + bw, y)
    g2.lineTo(bx + bw + 3 * f, y)
    g2.stroke()
    g2.fillText(fmtV(val), bx + bw + 5 * f, y)
  }
  if (p.unit) {
    g2.textAlign = 'center'
    g2.textBaseline = 'bottom'
    g2.fillText(`[${p.unit}]`, bx + bw / 2, Lt.y - 4 * f)
  }

  if (p.title) {
    g2.font = font(13 * f, true)
    g2.textAlign = 'left'
    g2.textBaseline = 'middle'
    g2.fillText(p.title, 8 * f, 15 * f, W - 16 * f)
  }
  g2.restore()
  return Lt
}
