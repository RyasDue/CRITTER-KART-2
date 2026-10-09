/**
 * Web Audio mixer with music and SFX buses. Browsers only allow audio after a user gesture, so
 * call `unlock()` from the first click/key press (the title screen does this).
 *
 * - `register()` / `play()`: named synthesized one-shot recipes (content lives in the game).
 * - `loop()`: continuous voices (engine hum, tyre squeal, buzzing) with live pitch/gain.
 * - `Sequencer`: a look-ahead step sequencer for generative/pattern music on the music bus.
 * - `load()` / `playBuffer()`: recorded files, if a game ships any.
 */
export type PlayOptions = { gain?: number; pan?: number; rate?: number }
export type Recipe = (s: SynthKit, opts: Required<PlayOptions>) => void

/** Small toolkit handed to recipes: schedule tones and noise bursts on the SFX bus. */
export type SynthKit = {
  ctx: AudioContext
  t: number
  tone(freq: number, end: number, dur: number, type: OscillatorType, vol: number, delay?: number): void
  noise(dur: number, vol: number, filter: BiquadFilterType, freq: number, endFreq?: number, delay?: number, q?: number): void
}

export class Audio {
  readonly ctx: AudioContext
  private master: GainNode
  private music: GainNode
  private sfx: GainNode
  private buffers = new Map<string, AudioBuffer>()
  private recipes = new Map<string, Recipe>()
  private noiseBuffer: AudioBuffer
  private lastPlayed = new Map<string, number>()

  constructor() {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.music = this.ctx.createGain()
    this.sfx = this.ctx.createGain()
    const comp = this.ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 4
    this.music.connect(this.master)
    this.sfx.connect(this.master)
    this.master.connect(comp).connect(this.ctx.destination)
    const len = this.ctx.sampleRate * 1.5
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = this.noiseBuffer.getChannelData(0)
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1
  }

  get musicBus(): GainNode {
    return this.music
  }

  get sfxBus(): GainNode {
    return this.sfx
  }

  get running(): boolean {
    return this.ctx.state === 'running'
  }

  unlock(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  /** Volumes in 0..1. */
  setVolumes(music: number, sfx: number, muted = false): void {
    const t = this.ctx.currentTime
    this.music.gain.setTargetAtTime(muted ? 0 : music * 0.5, t, 0.05)
    this.sfx.gain.setTargetAtTime(muted ? 0 : sfx * 0.85, t, 0.05)
  }

  /** Duck the music (e.g. pause menu). */
  duck(amount: number): void {
    this.master.gain.setTargetAtTime(1 - amount, this.ctx.currentTime, 0.08)
  }

  register(name: string, recipe: Recipe): void {
    this.recipes.set(name, recipe)
  }

  /** Play a registered recipe. `minGap` throttles rapid repeats of the same sound. */
  play(name: string, opts: PlayOptions = {}, minGap = 0.03): void {
    if (this.ctx.state !== 'running') return
    const recipe = this.recipes.get(name)
    if (!recipe) return
    const now = this.ctx.currentTime
    if (now - (this.lastPlayed.get(name) ?? -1) < minGap) return
    this.lastPlayed.set(name, now)
    const o = { gain: opts.gain ?? 1, pan: opts.pan ?? 0, rate: opts.rate ?? 1 }
    const out = this.ctx.createGain()
    out.gain.value = o.gain
    let node: AudioNode = out
    if (o.pan !== 0 && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner()
      p.pan.value = Math.max(-1, Math.min(1, o.pan))
      out.connect(p)
      node = p
    }
    node.connect(this.sfx)
    const ctx = this.ctx
    const t = now + 0.005
    const kit: SynthKit = {
      ctx,
      t,
      tone: (freq, end, dur, type, vol, delay = 0) => {
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = type
        osc.frequency.setValueAtTime(freq * o.rate, t + delay)
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, end * o.rate), t + delay + dur)
        g.gain.setValueAtTime(0.0001, t + delay)
        g.gain.exponentialRampToValueAtTime(vol, t + delay + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur)
        osc.connect(g).connect(out)
        osc.start(t + delay)
        osc.stop(t + delay + dur + 0.05)
      },
      noise: (dur, vol, filter, freq, endFreq = freq, delay = 0, q = 1) => {
        const src = ctx.createBufferSource()
        src.buffer = this.noiseBuffer
        src.playbackRate.value = o.rate
        const f = ctx.createBiquadFilter()
        f.type = filter
        f.Q.value = q
        f.frequency.setValueAtTime(freq, t + delay)
        f.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + delay + dur)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t + delay)
        g.gain.exponentialRampToValueAtTime(vol, t + delay + 0.008)
        g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur)
        src.connect(f).connect(g).connect(out)
        src.start(t + delay, Math.random() * 0.5)
        src.stop(t + delay + dur + 0.05)
      },
    }
    recipe(kit, o)
  }

  /** Continuous voice. `kind: 'tone'` is a detuned oscillator pair; `'noise'` is filtered noise. */
  loop(kind: 'tone' | 'noise', type: OscillatorType = 'sawtooth', filter: BiquadFilterType = 'lowpass'): LoopVoice {
    return new LoopVoice(this.ctx, this.sfx, kind, type, filter, this.noiseBuffer)
  }

  async load(url: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(url)
    if (cached) return cached
    const data = await (await fetch(url)).arrayBuffer()
    const buffer = await this.ctx.decodeAudioData(data)
    this.buffers.set(url, buffer)
    return buffer
  }

  playBuffer(buffer: AudioBuffer, bus: 'music' | 'sfx' = 'sfx', loop = false): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.loop = loop
    src.connect(bus === 'music' ? this.music : this.sfx)
    src.start()
    return src
  }

  /** Scheduled noise hit on an arbitrary destination (used by the music sequencer for drums). */
  noiseAt(dest: AudioNode, when: number, dur: number, vol: number, filter: BiquadFilterType, freq: number): void {
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    const f = this.ctx.createBiquadFilter()
    f.type = filter
    f.frequency.value = freq
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(vol, when)
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur)
    src.connect(f).connect(g).connect(dest)
    src.start(when, Math.random() * 0.5)
    src.stop(when + dur + 0.02)
  }
}

export class LoopVoice {
  private readonly out: GainNode
  private readonly filter: BiquadFilterNode
  private readonly panner?: StereoPannerNode
  private readonly oscs: OscillatorNode[] = []
  private readonly src?: AudioBufferSourceNode
  private stopped = false

  constructor(private readonly ctx: AudioContext, dest: AudioNode, kind: 'tone' | 'noise', type: OscillatorType, filterType: BiquadFilterType, noise: AudioBuffer) {
    this.out = ctx.createGain()
    this.out.gain.value = 0
    this.filter = ctx.createBiquadFilter()
    this.filter.type = filterType
    this.filter.frequency.value = 800
    if (ctx.createStereoPanner) {
      this.panner = ctx.createStereoPanner()
      this.filter.connect(this.out).connect(this.panner).connect(dest)
    } else this.filter.connect(this.out).connect(dest)
    if (kind === 'tone') {
      for (const detune of [-7, 7]) {
        const o = ctx.createOscillator()
        o.type = type
        o.detune.value = detune
        o.frequency.value = 80
        o.connect(this.filter)
        o.start()
        this.oscs.push(o)
      }
      const sub = ctx.createOscillator()
      sub.type = 'square'
      sub.frequency.value = 40
      const sg = ctx.createGain()
      sg.gain.value = 0.35
      sub.connect(sg).connect(this.filter)
      sub.start()
      this.oscs.push(sub)
    } else {
      this.src = ctx.createBufferSource()
      this.src.buffer = noise
      this.src.loop = true
      this.src.connect(this.filter)
      this.src.start()
    }
  }

  /** Update pitch (Hz, tone voices), gain, filter cutoff and pan smoothly. */
  set(freq: number, gain: number, cutoff: number, pan = 0, q = 1): void {
    if (this.stopped) return
    const t = this.ctx.currentTime
    const tc = 0.05
    this.oscs.forEach((o, i) => o.frequency.setTargetAtTime(i === 2 ? freq / 2 : freq, t, tc))
    this.out.gain.setTargetAtTime(Math.max(0, gain), t, tc)
    this.filter.frequency.setTargetAtTime(Math.max(40, cutoff), t, tc)
    this.filter.Q.setTargetAtTime(q, t, tc)
    this.panner?.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, tc)
  }

  silence(): void {
    if (!this.stopped) this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.06)
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    const t = this.ctx.currentTime
    this.out.gain.setTargetAtTime(0, t, 0.05)
    for (const o of this.oscs) o.stop(t + 0.3)
    this.src?.stop(t + 0.3)
  }
}

/** One song: patterns are arrays of steps (16th notes); `null` = rest. */
export type Song = {
  bpm: number
  /** Called for every 16th step with the scheduled time; the song decides what to play. */
  step(index: number, when: number, voice: Voices): void
}

export type Voices = {
  note(midi: number, when: number, dur: number, type: OscillatorType, vol: number, cutoff?: number): void
  kick(when: number, vol?: number): void
  snare(when: number, vol?: number): void
  hat(when: number, vol?: number, open?: boolean): void
}

export class Sequencer {
  private timer = 0
  private stepIndex = 0
  private nextTime = 0
  private song?: Song
  private readonly bus: GainNode
  tempoScale = 1

  constructor(private readonly audio: Audio) {
    this.bus = audio.ctx.createGain()
    this.bus.gain.value = 1
    this.bus.connect(audio.musicBus)
  }

  get playing(): Song | undefined {
    return this.song
  }

  start(song: Song): void {
    if (this.song === song) return
    this.stop()
    this.song = song
    this.stepIndex = 0
    const ctx = this.audio.ctx
    this.nextTime = ctx.currentTime + 0.08
    this.bus.gain.cancelScheduledValues(ctx.currentTime)
    this.bus.gain.setValueAtTime(0.0001, ctx.currentTime)
    this.bus.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.6)
    const voices = this.voices()
    const tick = () => {
      if (this.song !== song) return
      const now = this.audio.ctx.currentTime
      if (this.nextTime < now - 0.2) this.nextTime = now + 0.02
      while (this.nextTime < now + 0.14) {
        song.step(this.stepIndex, this.nextTime, voices)
        this.stepIndex += 1
        this.nextTime += 60 / (song.bpm * this.tempoScale) / 4
      }
      this.timer = window.setTimeout(tick, 30)
    }
    tick()
  }

  stop(): void {
    this.song = undefined
    clearTimeout(this.timer)
    const ctx = this.audio.ctx
    this.bus.gain.cancelScheduledValues(ctx.currentTime)
    this.bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.1)
  }

  private voices(): Voices {
    const ctx = this.audio.ctx
    const bus = this.bus
    const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
    return {
      note: (midi, when, dur, type, vol, cutoff = 3000) => {
        const o = ctx.createOscillator()
        const f = ctx.createBiquadFilter()
        const g = ctx.createGain()
        o.type = type
        o.frequency.value = hz(midi)
        f.type = 'lowpass'
        f.frequency.value = cutoff
        g.gain.setValueAtTime(0.0001, when)
        g.gain.exponentialRampToValueAtTime(vol, when + 0.01)
        g.gain.exponentialRampToValueAtTime(vol * 0.6, when + dur * 0.5)
        g.gain.exponentialRampToValueAtTime(0.0001, when + dur)
        o.connect(f).connect(g).connect(bus)
        o.start(when)
        o.stop(when + dur + 0.05)
      },
      kick: (when, vol = 0.7) => {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.frequency.setValueAtTime(150, when)
        o.frequency.exponentialRampToValueAtTime(42, when + 0.14)
        g.gain.setValueAtTime(vol, when)
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.2)
        o.connect(g).connect(bus)
        o.start(when)
        o.stop(when + 0.25)
      },
      snare: (when, vol = 0.35) => {
        this.audio.noiseAt(bus, when, 0.16, vol, 'bandpass', 1800)
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.type = 'triangle'
        o.frequency.setValueAtTime(240, when)
        o.frequency.exponentialRampToValueAtTime(140, when + 0.08)
        g.gain.setValueAtTime(vol * 0.6, when)
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.1)
        o.connect(g).connect(bus)
        o.start(when)
        o.stop(when + 0.12)
      },
      hat: (when, vol = 0.12, open = false) => this.audio.noiseAt(bus, when, open ? 0.14 : 0.04, vol, 'highpass', 7000),
    }
  }
}
