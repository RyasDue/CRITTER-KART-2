import { CONFIG, type ItemKind } from './config'

/**
 * Pure race rules: lap progress, standings, item odds, time formatting. No three.js, no Rapier,
 * no DOM — the scene reports track positions and reads the resulting state; tests cover it.
 */
export type Progress = {
  /** Unwrapped distance along the main loop (negative before the first line crossing). */
  u: number
  lastS: number
  /** Laps fully completed. */
  lapsDone: number
  lapStart: number
  lapTimes: number[]
  finished: boolean
  finishTime: number
}

export function createProgress(startS: number, length: number): Progress {
  const u = startS > length / 2 ? startS - length : startS
  return { u, lastS: startS, lapsDone: 0, lapStart: 0, lapTimes: [], finished: false, finishTime: 0 }
}

export type ProgressEvent = { type: 'lap'; lap: number; time: number } | { type: 'finish'; time: number }

/**
 * Advance with a new track distance `s` in [0, length). Lap completions only count the first
 * time a new multiple of the loop length is reached, so wiggling across the line cannot cheat.
 */
export function advance(p: Progress, s: number, length: number, raceTime: number, laps: number = CONFIG.race.laps): { state: Progress; events: ProgressEvent[] } {
  if (p.finished) return { state: p, events: [] }
  let d = s - p.lastS
  if (d > length / 2) d -= length
  if (d < -length / 2) d += length
  // Ignore implausible jumps (respawn teleports are applied through `setDistance`).
  if (Math.abs(d) > 60) d = 0
  const u = p.u + d
  const events: ProgressEvent[] = []
  let next: Progress = { ...p, u, lastS: s }
  const reached = Math.floor(u / length)
  if (reached > p.lapsDone && u >= 0) {
    const lapTime = raceTime - p.lapStart
    next = { ...next, lapsDone: reached, lapStart: raceTime, lapTimes: [...p.lapTimes, lapTime] }
    if (reached >= laps) {
      next = { ...next, finished: true, finishTime: raceTime }
      events.push({ type: 'finish', time: raceTime })
    } else events.push({ type: 'lap', lap: reached + 1, time: lapTime })
  }
  return { state: next, events }
}

/** The lap currently being driven (1-based, clamped to the race length). */
export function currentLap(p: Progress, laps: number = CONFIG.race.laps): number {
  return Math.min(laps, Math.max(1, p.lapsDone + 1))
}

export type StandingInput = { id: number; u: number; finished: boolean; finishTime: number }

/** Finished racers by finish time, then everyone else by distance covered. */
export function standings(list: readonly StandingInput[]): number[] {
  return [...list]
    .sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime
      if (a.finished) return -1
      if (b.finished) return 1
      return b.u - a.u
    })
    .map(r => r.id)
}

/**
 * Item odds by race position (0 = leader). Leaders mostly get defensive items; the back of the
 * pack gets speed and bees. There is no item that targets the leader specifically.
 */
export function itemWeights(place: number, count: number): Record<ItemKind, number> {
  const t = count <= 1 ? 0 : place / (count - 1) // 0 front .. 1 back
  return {
    shield: 0.42 - 0.3 * t,
    taffy: 0.42 - 0.3 * t,
    pepper: 0.1 + 0.32 * t,
    bee: place === 0 ? 0 : 0.14 + 0.26 * t,
  }
}

export function rollItem(place: number, count: number, random: () => number): ItemKind {
  const w = itemWeights(place, count)
  const entries = Object.entries(w) as [ItemKind, number][]
  const total = entries.reduce((n, [, v]) => n + Math.max(0, v), 0)
  let r = random() * total
  for (const [k, v] of entries) {
    r -= Math.max(0, v)
    if (r <= 0) return k
  }
  return entries[entries.length - 1][0]
}

/** Catch-up multiplier for an AI `gap` metres behind (+) or ahead (−) of the player. */
export function catchUp(gap: number, ai = CONFIG.ai): number {
  const k = Math.max(-1, Math.min(1, gap / ai.catchUpRange))
  return k >= 0 ? 1 + k * ai.catchUpMax : 1 + k * ai.slowDownMax
}

/** Estimated finish time for racers still on track when the results are shown. */
export function estimateFinish(raceTime: number, remaining: number, speed: number): number {
  return raceTime + Math.max(0, remaining) / Math.max(12, speed)
}

/** 83.456 → "1:23.45" */
export function formatTime(seconds: number): string {
  // Work in whole centiseconds so float noise (5.02 → 5.0199…) never drops a digit.
  const total = Math.floor(Math.max(0, seconds) * 100 + 1e-6)
  const m = Math.floor(total / 6000)
  const whole = Math.floor((total % 6000) / 100)
  const cs = total % 100
  return `${m}:${String(whole).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/** English ordinal suffix. */
export function ordinalSuffix(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'th'
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
}
