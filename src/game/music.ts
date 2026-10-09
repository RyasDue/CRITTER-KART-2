import type { Song } from '../engine/audio'

/**
 * Two original chiptune-pop tracks written as step patterns for the engine Sequencer.
 * MIDI note numbers; 16 steps per bar.
 */
const F = 53 // F3
// Chord roots (semitones from F) and qualities for I–vi–IV–V.
const RACE_CHORDS = [
  [0, 4, 7],
  [9, 12, 16],
  [5, 9, 12],
  [7, 11, 14],
]
// Lead motif: [step, scale offset from chord root index, length in steps]
const HOOK_A: [number, number, number][] = [
  [0, 12, 2], [2, 16, 2], [4, 19, 3], [8, 16, 2], [10, 19, 2], [12, 21, 4],
]
const HOOK_B: [number, number, number][] = [
  [0, 19, 2], [2, 17, 2], [4, 16, 2], [6, 14, 2], [8, 12, 4], [12, 14, 2], [14, 16, 2],
]

export const RACE_SONG: Song = {
  bpm: 146,
  step(i, t, v) {
    const bar = Math.floor(i / 16) % 8
    const st = i % 16
    const chord = RACE_CHORDS[bar % 4]
    const root = F + chord[0]
    const sixteenth = 60 / 146 / 4
    // Drums.
    if (st % 4 === 0) v.kick(t, st === 0 ? 0.75 : 0.6)
    if (st === 4 || st === 12) v.snare(t, 0.32)
    if (st % 2 === 1) v.hat(t, 0.07)
    if (st === 14) v.hat(t, 0.09, true)
    // Bass: octave bounce.
    if (st % 2 === 0) v.note(root - 12 + (st % 4 === 2 ? 12 : 0), t, sixteenth * 1.8, 'square', 0.1, 900)
    // Arp.
    const arp = chord[(st >> 1) % 3] + 12
    if (st % 2 === 0) v.note(F + arp + 12, t, sixteenth * 1.5, 'triangle', 0.045, 5000)
    // Lead hook on alternate halves.
    const hook = bar < 4 ? HOOK_A : HOOK_B
    if (bar % 2 === 0 || bar >= 4) {
      for (const [s, off, len] of hook) if (s === st) v.note(F + chord[0] + off, t, sixteenth * len * 0.95, 'square', 0.06, 3200)
    }
    // Pad stab on the downbeat.
    if (st === 0) for (const n of chord) v.note(F + n + 12, t, sixteenth * 12, 'sawtooth', 0.018, 1600)
  },
}

const TITLE_CHORDS = [
  [0, 4, 7, 11],
  [9, 12, 16, 19],
  [5, 9, 12, 16],
  [7, 11, 14, 17],
]

export const TITLE_SONG: Song = {
  bpm: 98,
  step(i, t, v) {
    const bar = Math.floor(i / 16) % 4
    const st = i % 16
    const chord = TITLE_CHORDS[bar]
    const base = 58 // Bb3
    const sixteenth = 60 / 98 / 4
    if (st === 0 || st === 10) v.kick(t, 0.45)
    if (st === 8) v.snare(t, 0.18)
    if (st % 4 === 2) v.hat(t, 0.05)
    if (st % 2 === 0) v.note(base + chord[(st >> 1) % 4] + 12, t, sixteenth * 2.8, 'triangle', 0.055, 4200)
    if (st === 0) v.note(base + chord[0] - 12, t, sixteenth * 14, 'sine', 0.16, 600)
    if (st === 8) v.note(base + chord[2] - 12, t, sixteenth * 6, 'sine', 0.1, 600)
    const bell = [[0, 24], [6, 23], [12, 19]]
    if (bar % 2 === 1) for (const [s, n] of bell) if (s === st) v.note(base + chord[0] + n, t, sixteenth * 5, 'sine', 0.05, 6000)
  },
}

export const RESULTS_SONG: Song = {
  bpm: 110,
  step(i, t, v) {
    const bar = Math.floor(i / 16) % 2
    const st = i % 16
    const chord = bar === 0 ? [0, 4, 7] : [5, 9, 12]
    const base = 60
    const sixteenth = 60 / 110 / 4
    if (st % 8 === 0) v.kick(t, 0.4)
    if (st === 4 || st === 12) v.hat(t, 0.06, true)
    if (st % 4 === 0) v.note(base + chord[(st >> 2) % 3] + 12, t, sixteenth * 3.5, 'triangle', 0.06, 5000)
    if (st === 0) v.note(base + chord[0] - 12, t, sixteenth * 15, 'sine', 0.14, 700)
  },
}
