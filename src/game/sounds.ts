import type { Audio } from '../engine/audio'

/** Every sound effect in the game, synthesized from oscillators and filtered noise. */
export function registerSounds(a: Audio): void {
  a.register('uiMove', s => s.tone(880, 1100, 0.05, 'triangle', 0.12))
  a.register('uiSelect', s => {
    s.tone(660, 990, 0.08, 'square', 0.1)
    s.tone(990, 1320, 0.1, 'triangle', 0.12, 0.06)
  })
  a.register('uiBack', s => s.tone(600, 380, 0.1, 'triangle', 0.13))
  a.register('count', s => {
    s.tone(660, 660, 0.22, 'square', 0.13)
    s.tone(1320, 1320, 0.18, 'sine', 0.08)
  })
  a.register('go', s => {
    s.tone(990, 990, 0.5, 'square', 0.14)
    s.tone(1485, 1485, 0.5, 'sine', 0.1)
    s.tone(495, 495, 0.5, 'sawtooth', 0.06)
  })
  a.register('crate', s => {
    s.noise(0.18, 0.35, 'bandpass', 2600, 900, 0, 1.2)
    s.tone(1200, 2400, 0.12, 'triangle', 0.14)
    s.tone(1800, 3000, 0.1, 'sine', 0.08, 0.05)
  })
  a.register('tick', s => s.tone(1500, 1500, 0.03, 'square', 0.05))
  a.register('itemReady', s => {
    s.tone(784, 784, 0.08, 'triangle', 0.14)
    s.tone(1175, 1175, 0.14, 'triangle', 0.14, 0.07)
  })
  a.register('shieldUp', s => {
    s.tone(300, 1200, 0.35, 'sine', 0.18)
    s.tone(450, 1800, 0.35, 'triangle', 0.06, 0.03)
  })
  a.register('shieldPop', s => {
    s.noise(0.12, 0.3, 'highpass', 3000, 6000)
    s.tone(1400, 300, 0.18, 'sine', 0.2)
  })
  a.register('pepper', s => {
    s.noise(0.7, 0.4, 'lowpass', 900, 4000, 0, 0.8)
    s.tone(120, 60, 0.5, 'sawtooth', 0.12)
  })
  a.register('taffyDrop', s => {
    s.tone(300, 120, 0.2, 'sine', 0.25)
    s.noise(0.12, 0.12, 'lowpass', 600, 200)
  })
  a.register('taffyHit', s => {
    s.tone(180, 60, 0.35, 'sine', 0.35)
    s.tone(420, 140, 0.25, 'triangle', 0.15, 0.03)
    s.noise(0.25, 0.2, 'lowpass', 1200, 200)
  })
  a.register('beeLaunch', s => {
    s.tone(220, 330, 0.3, 'sawtooth', 0.08)
    s.tone(660, 990, 0.18, 'square', 0.06, 0.02)
  })
  a.register('beeHit', s => {
    s.noise(0.3, 0.4, 'bandpass', 1500, 400, 0, 2)
    s.tone(700, 120, 0.4, 'square', 0.12)
    s.tone(90, 45, 0.3, 'sine', 0.35)
  })
  a.register('hitMe', s => {
    s.tone(90, 40, 0.35, 'sine', 0.45)
    s.noise(0.25, 0.3, 'lowpass', 2000, 300)
  })
  a.register('bump', (s, o) => {
    s.tone(140 * o.rate, 70, 0.14, 'sine', 0.3)
    s.noise(0.08, 0.2, 'lowpass', 1500, 400)
  })
  a.register('wall', s => {
    s.tone(110, 55, 0.16, 'square', 0.12)
    s.noise(0.12, 0.25, 'bandpass', 800, 300)
  })
  a.register('hop', s => s.tone(380, 620, 0.09, 'sine', 0.14))
  a.register('land', s => {
    s.tone(120, 60, 0.14, 'sine', 0.3)
    s.noise(0.1, 0.15, 'lowpass', 900, 200)
  })
  a.register('tier', (s, o) => {
    const f = 900 * o.rate
    s.tone(f, f * 1.5, 0.1, 'triangle', 0.14)
    s.tone(f * 1.5, f * 2, 0.12, 'sine', 0.08, 0.05)
  })
  a.register('boost', (s, o) => {
    s.noise(0.45 * o.rate, 0.35, 'bandpass', 700, 3000, 0, 0.9)
    s.tone(200, 600, 0.3, 'sawtooth', 0.07)
  })
  a.register('pad', s => {
    s.noise(0.4, 0.3, 'bandpass', 900, 3500, 0, 1)
    s.tone(500, 1000, 0.2, 'triangle', 0.1)
  })
  a.register('lap', s => {
    ;[784, 988, 1175].forEach((f, i) => s.tone(f, f, 0.12, 'square', 0.1, i * 0.08))
  })
  a.register('finalLap', s => {
    ;[659, 784, 988, 1319].forEach((f, i) => s.tone(f, f, 0.16, 'square', 0.11, i * 0.09))
    s.tone(1319, 1319, 0.5, 'triangle', 0.1, 0.36)
  })
  a.register('finish', s => {
    ;[523, 659, 784, 1047, 784, 1047].forEach((f, i) => s.tone(f, f, 0.2, 'square', 0.1, i * 0.1))
    s.tone(1047, 1047, 0.9, 'triangle', 0.14, 0.6)
    s.tone(523, 523, 0.9, 'triangle', 0.1, 0.6)
    s.noise(0.6, 0.12, 'highpass', 5000, 9000, 0.6)
  })
  a.register('lose', s => {
    ;[523, 494, 440, 392].forEach((f, i) => s.tone(f, f * 0.98, 0.22, 'triangle', 0.12, i * 0.16))
  })
  a.register('overtake', s => s.tone(880, 1320, 0.12, 'triangle', 0.08))
  a.register('respawn', s => {
    s.tone(400, 1200, 0.4, 'sine', 0.14)
    s.noise(0.3, 0.1, 'highpass', 4000, 8000)
  })
  a.register('splash', s => s.noise(0.5, 0.4, 'lowpass', 2500, 300))
  a.register('warn', s => {
    s.tone(1200, 1200, 0.07, 'square', 0.07)
    s.tone(1200, 1200, 0.07, 'square', 0.07, 0.12)
  })
  a.register('stall', s => s.tone(160, 50, 0.5, 'sawtooth', 0.12))
}
