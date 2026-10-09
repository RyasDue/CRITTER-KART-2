import * as THREE from 'three'

/**
 * Arc-length parameterised track spline (closed loop or open branch).
 *
 * The curve is resampled at a fixed spacing so every query is O(window): racing code works in
 * "metres along the track" (`s`) and lateral offset, never in raw curve parameters. Used by the
 * vehicle AI, lap/progress tracking, track mesh generation and the minimap.
 */
export type SplinePoint = { x: number; y: number; z: number }

export type SplineSample = {
  s: number
  pos: THREE.Vector3
  /** Unit tangent (direction of travel). */
  tan: THREE.Vector3
  /** Unit horizontal right vector (tangent × up). */
  right: THREE.Vector3
  /** Signed yaw change per metre (positive = turning left / counter-clockwise from above). */
  curvature: number
  halfWidth: number
}

export type ClosestResult = {
  s: number
  index: number
  /** Signed lateral offset along `right` (positive = right of centre). */
  lateral: number
  /** Horizontal distance to the centre line. */
  distance: number
  /** Height of the centre line at the projected point. */
  height: number
}

export type SplineOptions = {
  closed: boolean
  /** Sample spacing in metres. */
  step?: number
  /** Half width of the drivable surface; may vary along the track. */
  halfWidth?: number | ((s: number, length: number) => number)
}

const UP = new THREE.Vector3(0, 1, 0)

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

export class TrackSpline {
  readonly samples: SplineSample[] = []
  readonly length: number
  readonly step: number
  readonly closed: boolean
  private readonly tmp = new THREE.Vector3()

  constructor(points: SplinePoint[], opts: SplineOptions) {
    this.closed = opts.closed
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p.x, p.y, p.z)), opts.closed, 'centripetal')
    curve.arcLengthDivisions = Math.max(400, points.length * 120)
    const total = curve.getLength()
    const n = Math.max(8, Math.round(total / (opts.step ?? 1)))
    this.step = total / n
    this.length = total
    const count = opts.closed ? n : n + 1
    const hw = opts.halfWidth ?? 6
    for (let i = 0; i < count; i += 1) {
      const u = i / n
      const pos = curve.getPointAt(Math.min(1, u))
      const tan = curve.getTangentAt(Math.min(1, u)).normalize()
      const right = new THREE.Vector3().crossVectors(tan, UP)
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
      right.y = 0
      right.normalize()
      const s = i * this.step
      this.samples.push({ s, pos, tan, right, curvature: 0, halfWidth: typeof hw === 'number' ? hw : hw(s, total) })
    }
    const m = this.samples.length
    for (let i = 0; i < m; i += 1) {
      const a = this.samples[this.closed ? (i - 1 + m) % m : Math.max(0, i - 1)]
      const b = this.samples[this.closed ? (i + 1) % m : Math.min(m - 1, i + 1)]
      const ya = Math.atan2(a.tan.x, a.tan.z)
      const yb = Math.atan2(b.tan.x, b.tan.z)
      const span = Math.max(this.step, (b.s - a.s + (this.closed && b.s < a.s ? this.length : 0)) || this.step * 2)
      this.samples[i].curvature = wrapAngle(yb - ya) / span
    }
  }

  /** Wrap (closed) or clamp (open) a distance into [0, length]. */
  wrap(s: number): number {
    if (this.closed) return ((s % this.length) + this.length) % this.length
    return Math.min(this.length, Math.max(0, s))
  }

  /** Shortest signed distance from `a` to `b` along the track. */
  delta(a: number, b: number): number {
    let d = b - a
    if (this.closed) {
      if (d > this.length / 2) d -= this.length
      if (d < -this.length / 2) d += this.length
    }
    return d
  }

  /** Interpolated sample at distance `s` (writes into `out` to avoid allocation in hot loops). */
  at(s: number, out?: SplineSample): SplineSample {
    const w = this.wrap(s)
    const f = w / this.step
    const m = this.samples.length
    let i = Math.floor(f)
    let t = f - i
    if (!this.closed && i >= m - 1) {
      i = m - 2
      t = 1
    }
    const a = this.samples[i % m]
    const b = this.samples[(i + 1) % m]
    const o = out ?? { s: 0, pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(), curvature: 0, halfWidth: 0 }
    o.s = w
    o.pos.lerpVectors(a.pos, b.pos, t)
    o.tan.lerpVectors(a.tan, b.tan, t).normalize()
    o.right.lerpVectors(a.right, b.right, t).normalize()
    o.curvature = a.curvature + (b.curvature - a.curvature) * t
    o.halfWidth = a.halfWidth + (b.halfWidth - a.halfWidth) * t
    return o
  }

  /** World point at distance `s` shifted `lateral` metres to the right. */
  pointAt(s: number, lateral = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const smp = this.at(s)
    return out.copy(smp.pos).addScaledVector(smp.right, lateral)
  }

  /** Yaw (three.js convention, 0 = +Z) of the tangent at `s`. */
  yawAt(s: number): number {
    const t = this.at(s).tan
    return Math.atan2(t.x, t.z)
  }

  /** Signed total heading change over the next `ahead` metres (positive = left). */
  headingChange(s: number, ahead: number): number {
    return wrapAngle(this.yawAt(s + ahead) - this.yawAt(s))
  }

  /** Largest absolute curvature within [s, s + ahead]. */
  maxCurvature(s: number, ahead: number, stride = 2): number {
    let best = 0
    for (let d = 0; d <= ahead; d += stride) best = Math.max(best, Math.abs(this.at(s + d).curvature))
    return best
  }

  /**
   * Closest point on the centre line. `hint` (a previous sample index) limits the search to a
   * local window; the full track is scanned when there is no hint or the local match is poor.
   */
  closest(p: THREE.Vector3, hint = -1, window = 36): ClosestResult {
    const m = this.samples.length
    let best = -1
    let bestD = Infinity
    const scan = (from: number, to: number) => {
      for (let k = from; k <= to; k += 1) {
        const i = this.closed ? ((k % m) + m) % m : k
        if (i < 0 || i >= m) continue
        const q = this.samples[i].pos
        const dx = p.x - q.x
        const dz = p.z - q.z
        const dy = (p.y - q.y) * 0.5
        const d = dx * dx + dz * dz + dy * dy
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
    }
    if (hint >= 0) scan(hint - window, hint + window)
    if (best < 0 || bestD > 30 * 30) {
      bestD = Infinity
      scan(0, m - 1)
    }
    // Refine between neighbours by projecting onto the adjoining segments.
    const a = this.samples[best]
    const prev = this.closed ? this.samples[(best - 1 + m) % m] : this.samples[Math.max(0, best - 1)]
    const next = this.closed ? this.samples[(best + 1) % m] : this.samples[Math.min(m - 1, best + 1)]
    const proj = (from: SplineSample, to: SplineSample) => {
      const seg = this.tmp.subVectors(to.pos, from.pos)
      seg.y = 0
      const len2 = seg.lengthSq()
      if (len2 < 1e-6) return 0
      return THREE.MathUtils.clamp(((p.x - from.pos.x) * seg.x + (p.z - from.pos.z) * seg.z) / len2, 0, 1)
    }
    let s = a.s
    const tn = proj(a, next)
    if (tn > 0 && next !== a) s = a.s + tn * this.step
    else {
      const tp = proj(prev, a)
      if (prev !== a) s = a.s - (1 - tp) * this.step
    }
    s = this.wrap(s)
    const smp = this.at(s)
    const dx = p.x - smp.pos.x
    const dz = p.z - smp.pos.z
    const lateral = dx * smp.right.x + dz * smp.right.z
    return { s, index: best, lateral, distance: Math.hypot(dx, dz), height: smp.pos.y }
  }
}
