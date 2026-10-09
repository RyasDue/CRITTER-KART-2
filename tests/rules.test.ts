import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { advance, catchUp, createProgress, currentLap, formatTime, itemWeights, rollItem, standings } from '../src/game/rules'
import { TrackSpline } from '../src/engine/spline'

describe('lap progress', () => {
  const L = 800
  it('counts a lap only when the line is crossed moving forward', () => {
    let p = createProgress(L - 20, L) // grid sits just before the line
    expect(p.u).toBeLessThan(0)
    // Drive forward across the line and around the loop in 10 m steps.
    let laps = 0
    for (let s = L - 10, t = 0; t < 90; s = (s + 10) % L, t += 1) {
      const r = advance(p, s, L, t, 3)
      p = r.state
      laps += r.events.filter(e => e.type === 'lap').length
    }
    expect(p.lapsDone).toBe(1)
    expect(laps).toBe(1)
    expect(currentLap(p, 3)).toBe(2)
  })
  it('does not count wiggling back and forth across the line', () => {
    let p = createProgress(L - 5, L)
    for (let i = 0; i < 10; i += 1) {
      p = advance(p, 3, L, i).state
      p = advance(p, L - 3, L, i).state
    }
    expect(p.lapsDone).toBe(0)
  })
  it('finishes after the configured number of laps', () => {
    let p = createProgress(0, L)
    let finished = false
    for (let t = 0; t < 3 * 80 + 2; t += 1) {
      const r = advance(p, (t * 10 + 10) % L, L, t, 3)
      p = r.state
      if (r.events.some(e => e.type === 'finish')) finished = true
    }
    expect(finished).toBe(true)
    expect(p.finished).toBe(true)
    expect(p.lapTimes.length).toBe(3)
  })
  it('ignores teleport-sized jumps', () => {
    const p = advance(createProgress(100, L), 400, L, 1).state
    expect(p.u).toBe(100)
  })
})

describe('standings', () => {
  it('orders finishers by time, then the field by distance', () => {
    const order = standings([
      { id: 0, u: 900, finished: false, finishTime: 0 },
      { id: 1, u: 2400, finished: true, finishTime: 95 },
      { id: 2, u: 1200, finished: false, finishTime: 0 },
      { id: 3, u: 2400, finished: true, finishTime: 91 },
    ])
    expect(order).toEqual([3, 1, 2, 0])
  })
})

describe('items', () => {
  it('never gives the leader a bee and favours speed at the back', () => {
    expect(itemWeights(0, 6).bee).toBe(0)
    const back = itemWeights(5, 6)
    const front = itemWeights(0, 6)
    expect(back.pepper).toBeGreaterThan(front.pepper)
    expect(front.shield).toBeGreaterThan(back.shield)
  })
  it('rolls every item kind somewhere in the pack', () => {
    const seen = new Set<string>()
    let seed = 1
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 400; i += 1) seen.add(rollItem(i % 6, 6, rnd))
    expect([...seen].sort()).toEqual(['bee', 'pepper', 'shield', 'taffy'])
  })
  it('catch-up is mild and symmetric in sign', () => {
    expect(catchUp(0)).toBe(1)
    expect(catchUp(1000)).toBeGreaterThan(1)
    expect(catchUp(1000)).toBeLessThan(1.2)
    expect(catchUp(-1000)).toBeLessThan(1)
  })
})

describe('formatting', () => {
  it('formats race times', () => {
    expect(formatTime(83.456)).toBe('1:23.45')
    expect(formatTime(5.02)).toBe('0:05.02')
  })
})

describe('TrackSpline', () => {
  // Circle of radius 50 → length ≈ 314 m.
  const pts = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2
    return { x: Math.cos(a) * 50, y: 0, z: Math.sin(a) * 50 }
  })
  const sp = new TrackSpline(pts, { closed: true, step: 1, halfWidth: 8 })
  it('is arc-length parameterised', () => {
    expect(sp.length).toBeGreaterThan(300)
    expect(sp.length).toBeLessThan(320)
    const a = sp.pointAt(10)
    const b = sp.pointAt(20)
    expect(a.distanceTo(b)).toBeCloseTo(10, 0)
  })
  it('wraps distances on a closed loop', () => {
    expect(sp.wrap(sp.length + 5)).toBeCloseTo(5, 5)
    expect(sp.delta(sp.length - 5, 5)).toBeCloseTo(10, 5)
  })
  it('projects points to lateral offsets', () => {
    const s = 40
    const p = sp.pointAt(s, 3)
    const c = sp.closest(p)
    expect(c.s).toBeCloseTo(s, 0)
    expect(Math.abs(c.lateral)).toBeCloseTo(3, 0)
    expect(c.distance).toBeCloseTo(3, 0)
  })
  it('reports curvature close to 1 / radius', () => {
    expect(sp.maxCurvature(0, 40)).toBeGreaterThan(0.015)
    expect(sp.maxCurvature(0, 40)).toBeLessThan(0.025)
    expect(Math.abs(sp.headingChange(0, 50))).toBeCloseTo(1, 1)
  })
  it('gives unit tangents', () => {
    const smp = sp.at(77)
    expect(smp.tan.length()).toBeCloseTo(1, 5)
    expect(smp.right.dot(new THREE.Vector3(0, 1, 0))).toBeCloseTo(0, 5)
  })
})
