import * as THREE from 'three'
import { Sequencer, type Audio, type LoopVoice } from '../engine/audio'
import type { Input } from '../engine/input'
import { Physics } from '../engine/physics'
import type { Renderer } from '../engine/renderer'
import type { Quality } from '../engine/save'
import { SplineDriver, type Obstacle } from '../engine/splineAi'
import { ChaseCamera } from './camera'
import { ROSTER, characterById, type Character } from './characters'
import { CONFIG, RACE_LEVELS, ROUTES, type ItemKind } from './config'
import { Fx } from './fx'
import { Items } from './items'
import { buildKart, type KartView } from './kartModel'
import { RACE_SONG, RESULTS_SONG, TITLE_SONG } from './music'
import { Racer } from './racer'
import { advance, catchUp, currentLap, estimateFinish, standings } from './rules'
import { buildScenery, type Scenery } from './scenery'
import { registerSounds } from './sounds'
import { Track, WALL } from './track'

export type Mode = 'title' | 'select' | 'playing' | 'paused' | 'ended'
export type Phase = 'intro' | 'countdown' | 'racing' | 'done'

export type HudState = {
  phase: Phase
  place: number
  total: number
  lap: number
  laps: number
  time: number
  lastLap: number
  item: ItemKind | null
  rolling: boolean
  shield: number
  driftTier: number
  driftCharge: number
  drifting: boolean
  speed: number
  boost: boolean
  wrongWay: boolean
  beeWarning: boolean
  map: { x: number; z: number; color: string; me: boolean; place: number }[]
  finished: boolean
  countdown: number
}

export type ResultRow = { place: number; character: string; time: number; bestLap: number; me: boolean; estimated: boolean }
export type RaceResult = { rows: ResultRow[]; place: number; time: number; bestLap: number; character: string }

export type Hint = 'drive' | 'drift' | 'driftRelease' | 'crate' | 'item' | 'shortcut' | 'none'

export type GameHooks = {
  banner(kind: 'lap' | 'final' | 'go' | 'finish' | 'wrong', vars?: Record<string, string | number>): void
  countdown(n: number): void
  hurt(kind: 'bee' | 'taffy' | 'blocked'): void
  hint(hint: Hint): void
  placeChange(up: boolean): void
  itemReady(kind: ItemKind): void
  toast(key: string, vars?: Record<string, string | number>): void
  finished(result: RaceResult): void
}

const SKILLS = [0.92, 0.84, 0.76, 0.68, 0.6]

export class Game {
  mode: Mode = 'title'
  phase: Phase = 'intro'
  reducedMotion = false
  sensitivity = 1
  readonly scene = new THREE.Scene()
  readonly cam = new ChaseCamera()
  readonly track: Track
  racers: Racer[] = []
  ordered: Racer[] = []
  player?: Racer
  private physics: Physics
  private scenery: Scenery
  private fx: Fx
  private items!: Items
  private readonly music: Sequencer
  private time = 0
  private raceTime = 0
  private phaseTime = 0
  private countdownShown = 4
  private throttleSince: number | null = null
  private hitstop = 0
  private attractTarget = 0
  /** Test/demo hook: the player's kart is driven by the spline AI. */
  autopilot = false
  private playerSteer = 0
  private attractSwitch = 0
  private tutorial = false
  private tutorialStep: Hint = 'none'
  private hintTimer = 0
  private wrongTimer = 0
  private resultTimer = -1
  private finishedResult?: RaceResult
  private lastPlace = 0
  private engine?: LoopVoice
  private squeal?: LoopVoice
  private wind?: LoopVoice
  private buzz?: LoopVoice
  private showroom?: { view: KartView; id: string }
  private selectSnap = false
  private readonly showroomAt: THREE.Vector3
  private trick = new Map<Racer, number>()
  private launched = new Set<Racer>()
  private resultsShown = false
  readonly raceLevels = RACE_LEVELS
  readonly routes = ROUTES
  activeLevel = 0
  activeRoute = 0
  private playerDriver = new SplineDriver({ skill: 0.8, lane: 0, bravery: 0.6, wobble: 0 })

  constructor(private readonly renderer: Renderer, private readonly input: Input, private readonly audio: Audio, private readonly hooks: GameHooks, quality: Quality) {
    this.physics = new Physics(-26)
    this.track = new Track(this.physics)
    this.scene.add(this.track.group)
    this.scenery = buildScenery(this.scene, this.track, renderer.shadowMapSize)
    this.fx = new Fx(this.scene)
    this.setQuality(quality)
    this.items = new Items(this.scene, this.physics, this.track, this.fx, {
      sfx: (name, at, gain) => this.sfxAt(name, at, gain),
      hit: (victim, by, kind) => this.onHit(victim, by, kind),
      blocked: victim => {
        this.sfxAt('shieldPop', victim.position)
        if (victim.isPlayer) this.hooks.hurt('blocked')
      },
      got: r => {
        if (r.isPlayer) {
          this.hooks.hint(this.tutorial && this.tutorialStep === 'crate' ? 'item' : 'none')
          if (this.tutorial && this.tutorialStep === 'crate') this.tutorialStep = 'item'
        }
      },
    })
    registerSounds(audio)
    this.music = new Sequencer(audio)
    // Showroom podium on the lawn beside the start straight.
    const smp = this.track.main.at(this.track.length - 60)
    this.showroomAt = smp.pos.clone().addScaledVector(smp.right, -(WALL + 16))
    this.showroomAt.y = smp.pos.y + 34
    const podium = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 0.6, 16), new THREE.MeshStandardMaterial({ color: '#ffe3f0', flatShading: true, roughness: 0.4 }))
    podium.position.copy(this.showroomAt).setY(this.showroomAt.y - 0.3)
    podium.receiveShadow = true
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.5, 0.18, 6, 32), new THREE.MeshStandardMaterial({ color: '#a93240', flatShading: true }))
    ring.rotation.x = Math.PI / 2
    ring.position.copy(this.showroomAt)
    this.scene.add(podium, ring)
    this.startAttract()
  }

  // ─── lifecycle ────────────────────────────────────────────────────

  private clearRace(): void {
    for (const r of this.racers) {
      this.scene.remove(r.view.root, r.view.shadow, ...r.trails.map(t => t.mesh))
      r.kart.dispose()
    }
    this.racers = []
    this.ordered = []
    this.player = undefined
    this.items.reset()
    this.fx.clear()
    this.trick.clear()
    this.launched.clear()
  }

  private spawn(playerChar: Character | null): void {
    this.clearRace()
    const others = ROSTER.filter(c => c !== playerChar)
    // Player starts 4th on the grid; AI skill decreases toward the back.
    const order: (Character | null)[] = []
    const playerSlot = 3
    let k = 0
    for (let i = 0; i < CONFIG.race.racers; i += 1) order.push(playerChar && i === playerSlot ? playerChar : others[k++ % others.length])
    order.forEach((c, i) => {
      const ch = c ?? ROSTER[i]
      const isPlayer = !!playerChar && i === playerSlot
      const aiIndex = isPlayer ? 0 : Math.min(SKILLS.length - 1, i > playerSlot ? i - 1 : i)
      const levelScale = RACE_LEVELS[this.activeLevel].ai
      const r = new Racer(i, ch, isPlayer, this.physics, this.track, this.track.gridSlot(i), Math.min(0.99, SKILLS[aiIndex] * levelScale))
      this.scene.add(r.view.root, r.view.shadow, ...r.trails.map(t => t.mesh))
      if (isPlayer) this.player = r
      r.aiUseShortcut = Math.random() < CONFIG.ai.shortcutChance[Math.min(4, aiIndex)]
      this.racers.push(r)
    })
    this.ordered = [...this.racers]
    this.updateStandings()
  }

  /** Title background: an AI-only race with a roaming camera. */
  startAttract(): void {
    this.mode = 'title'
    this.spawn(null)
    this.phase = 'racing'
    this.raceTime = 0
    for (const r of this.racers) r.kart.boost(0.5 + Math.random())
    this.cam.mode = 'orbit'
    this.cam.snap()
    this.removeShowroom()
    this.stopLoops()
    if (this.audio.running) this.music.start(TITLE_SONG)
  }

  playTitleMusic(): void {
    this.music.start(TITLE_SONG)
  }

  /** Character select: kart turntable on the podium. */
  showSelect(id: string): void {
    this.mode = 'select'
    this.selectSnap = true
    if (this.showroom?.id === id) return
    this.removeShowroom()
    const view = buildKart(characterById(id))
    view.root.position.copy(this.showroomAt)
    view.root.traverse(o => ((o as THREE.Mesh).castShadow = true))
    this.scene.add(view.root)
    this.showroom = { view, id }
    this.fx.confetti(this.showroomAt.clone().setY(this.showroomAt.y + 2.6), 10, 0.6)
  }

  private removeShowroom(): void {
    if (!this.showroom) return
    this.scene.remove(this.showroom.view.root)
    this.showroom = undefined
  }

  startRace(characterId: string, tutorial: boolean, route = 0, level = 0): void {
    this.activeRoute = Math.max(0, Math.min(ROUTES.length - 1, route))
    this.activeLevel = Math.max(0, Math.min(RACE_LEVELS.length - 1, level))
    this.removeShowroom()
    this.spawn(characterById(characterId))
    this.mode = 'playing'
    this.phase = 'intro'
    this.phaseTime = 0
    this.raceTime = 0
    this.countdownShown = 4
    this.throttleSince = null
    this.resultTimer = -1
    this.resultsShown = false
    this.finishedResult = undefined
    this.tutorial = tutorial
    this.tutorialStep = tutorial ? 'drive' : 'none'
    this.lastPlace = this.player!.place
    this.cam.mode = 'flyby'
    this.cam.resetTime()
    this.cam.snap()
    for (const l of this.scenery.startLights) (l.material as THREE.MeshBasicMaterial).color.set('#3a2440')
    this.music.stop()
    this.startLoops()
  }

  skipIntro(): void {
    if (this.mode === 'playing' && this.phase === 'intro' && this.phaseTime > 0.4) this.phaseTime = 99
  }

  pause(): void {
    if (this.mode !== 'playing' && this.mode !== 'ended') return
    this.mode = 'paused'
    this.audio.duck(0.6)
    this.engine?.silence()
    this.squeal?.silence()
    this.wind?.silence()
    this.buzz?.silence()
  }

  resume(): void {
    if (this.mode !== 'paused') return
    this.mode = this.resultsShown ? 'ended' : 'playing'
    this.audio.duck(0)
  }

  toTitle(): void {
    this.audio.duck(0)
    this.startAttract()
    this.music.start(TITLE_SONG)
  }

  setQuality(q: Quality): void {
    this.renderer.applyQuality(q)
    this.scenery.setShadowMap(this.renderer.shadowMapSize)
    this.fx.setDensity(q === 'low' ? 0.4 : q === 'medium' ? 0.7 : 1)
  }

  private startLoops(): void {
    this.stopLoops()
    if (!this.audio.running) return
    this.engine = this.audio.loop('tone', 'sawtooth', 'lowpass')
    this.squeal = this.audio.loop('noise', 'sine', 'bandpass')
    this.wind = this.audio.loop('noise', 'sine', 'lowpass')
    this.buzz = this.audio.loop('tone', 'square', 'bandpass')
  }

  private stopLoops(): void {
    for (const l of [this.engine, this.squeal, this.wind, this.buzz]) l?.stop()
    this.engine = this.squeal = this.wind = this.buzz = undefined
  }

  // ─── simulation ──────────────────────────────────────────────────

  step(dt: number): void {
    if (this.mode === 'paused') return
    this.time += dt
    if (this.hitstop > 0) {
      this.hitstop -= dt
      return
    }
    if (this.mode === 'select') {
      this.phaseTime += dt
      return
    }
    const racing = this.phase === 'racing' || this.phase === 'done'
    this.phaseTime += dt
    if (this.mode === 'playing' && this.phase === 'intro') {
      if (this.input.consume('confirm') || this.input.consume('item')) this.skipIntro()
      if (this.phaseTime > 3.2) {
        this.phase = 'countdown'
        this.phaseTime = 0
        this.cam.mode = 'chase'
        this.cam.snap()
        if (this.tutorial) this.hooks.hint('drive')
      }
    }
    if (this.mode === 'playing' && this.phase === 'countdown') this.stepCountdown()
    if (racing) this.raceTime += dt

    const obstacles = this.items.obstacles()
    for (const r of this.racers) {
      if (r.respawnTime > 0) {
        r.respawnTime -= dt
        const spot = this.track.respawn(r.tracker.loc)
        r.kart.teleport(spot.pos.setY(spot.pos.y + (r.respawnTime > 0.3 ? 1.2 : 0)), spot.yaw)
        r.input = { throttle: 0, brake: 0, steer: 0, drift: false }
        continue
      }
      if (!racing) {
        // Grid: rev in place.
        r.input = { throttle: 0, brake: 0, steer: 0, drift: false }
      } else if (this.input.consume('camera') && r.isPlayer) {
        this.cam.mode = this.cam.mode === 'cockpit' ? 'chase' : 'cockpit'
        this.cam.snap()
      } else if (r.isPlayer && !r.finished && !this.autopilot) {
        const a = this.input.axes
        const target = THREE.MathUtils.clamp(a.steer * (0.75 + this.sensitivity * 0.25), -1, 1)
        // Ramp toward the requested lock (digital keys feel smooth; analog sticks barely notice).
        // Returning to centre and reversing are faster than winding on.
        const rate = Math.abs(target) < Math.abs(this.playerSteer) || target * this.playerSteer < 0 ? 12 : 7.5
        this.playerSteer += THREE.MathUtils.clamp(target - this.playerSteer, -rate * dt, rate * dt)
        r.input = { throttle: a.throttle, brake: a.brake, steer: this.playerSteer, drift: this.input.held('drift') }
        this.cam.lookBack = this.input.held('lookBack')
        if (this.input.consume('item')) {
          const used = this.items.use(r, this.ordered)
          if (used && this.tutorial && this.tutorialStep === 'item') this.advanceTutorial('shortcut')
        }
        // Air trick: tap drift while airborne off a ramp.
        if (this.launched.has(r) && r.kart.airTime > 0.1 && this.input.consume('drift') && !this.trick.has(r)) this.startTrick(r)
      } else {
        this.driveAi(r, obstacles, dt)
      }
      if (r.isPlayer && !r.finished) r.kart.speedScale = 1
      r.kart.step(dt, r.input, r.events)
    }
    if (!racing) this.input.consume('drift')
    this.physics.step(dt)

    for (const r of this.racers) {
      r.kart.postStep(r.events)
      const loc = this.track.locate(r.position, r.tracker)
      if (racing) {
        const { state, events } = advance(r.progress, loc.mainS, this.track.length, this.raceTime)
        r.progress = state
        for (const e of events) this.onProgress(r, e.type, e.type === 'lap' ? e.lap : 0)
      }
      if (r.position.y < loc.height - 8 || loc.distance > WALL + 8) this.startRespawn(r)
      this.handleEvents(r)
    }
    this.kartContacts()
    this.updateStandings()
    this.items.step(dt, this.racers, this.ordered)
    for (const r of this.racers) if (!r.isPlayer || r.finished || this.autopilot) this.aiItems(r, dt)
    if (this.player && racing) this.playerChecks(dt)
    if (this.resultTimer > 0) {
      this.resultTimer -= dt
      if (this.resultTimer <= 0 && this.finishedResult) {
        this.mode = 'ended'
        this.resultsShown = true
        this.hooks.finished(this.finishedResult)
        this.music.start(RESULTS_SONG)
      }
    }
    if (this.mode === 'title') this.attractStep(dt)
    this.input.consume('confirm')
  }

  private stepCountdown(): void {
    const left = CONFIG.race.countdown + 0.6 - this.phaseTime
    const n = Math.ceil(left)
    const holding = this.input.axes.throttle > 0.5
    if (holding && this.throttleSince === null) this.throttleSince = left
    if (!holding) this.throttleSince = null
    if (n < this.countdownShown && n >= 1 && n <= 3) {
      this.countdownShown = n
      this.hooks.countdown(n)
      this.audio.play('count')
      const light = this.scenery.startLights[3 - n]
      ;(light.material as THREE.MeshBasicMaterial).color.set('#ff4f6d')
    }
    if (left <= 0) {
      this.phase = 'racing'
      this.phaseTime = 0
      this.hooks.countdown(0)
      this.hooks.banner('go')
      this.audio.play('go')
      for (const l of this.scenery.startLights) (l.material as THREE.MeshBasicMaterial).color.set('#62ff9a')
      this.music.tempoScale = 1
      this.music.start(RACE_SONG)
      const p = this.player!
      if (this.throttleSince !== null) {
        if (this.throttleSince <= CONFIG.race.startBoostWindow) {
          p.kart.boost(1.1, 1.1)
          this.hooks.toast('toast.startBoost')
          this.audio.play('boost')
          this.cam.punch(0.8)
        } else if (this.throttleSince > CONFIG.race.stallBefore) {
          p.kart.stunTime = 0.7
          this.hooks.toast('toast.stall')
          this.audio.play('stall')
        }
      }
      for (const r of this.racers) if (!r.isPlayer && Math.random() < 0.45 + (r.driver?.skill.skill ?? 0) * 0.3) r.kart.boost(0.9, 1.08)
      if (this.tutorial) this.hooks.hint('drive')
    }
  }

  private driveAi(r: Racer, obstacles: Obstacle[], dt: number): void {
    const driver = r.driver ?? this.playerDriver
    const k = r.kart
    const loc = r.tracker.loc
    // Choose path: commit to the shortcut shortly before the branch, leave at its end.
    const onShort = loc.path === 'short'
    const nearBranch = this.track.main.delta(this.track.shortMap.start, loc.s)
    if (!r.shortRoute && (onShort || (r.aiUseShortcut && loc.path === 'main' && nearBranch > -45 && nearBranch < 1))) {
      r.shortRoute = true
      driver.resetTracking()
    }
    if (r.shortRoute) {
      const cs = this.track.short.closest(k.position)
      // Missed the mouth (still on the main road well past the fork): give up the shortcut.
      const missed = loc.path === 'main' && nearBranch > 34 && nearBranch < 200
      if (cs.s > this.track.short.length - 4 || cs.distance > 30 || missed) {
        r.shortRoute = false
        driver.resetTracking()
      }
    }
    const path = r.shortRoute ? this.track.short : this.track.main
    // Failsafe: an AI wedged somewhere for several seconds gets the standard respawn.
    r.aiStuck = Math.abs(k.speed) < 3 && this.phase === 'racing' ? r.aiStuck + dt : Math.max(0, r.aiStuck - dt * 2)
    if (r.aiStuck > 3.5) {
      r.aiStuck = 0
      r.shortRoute = false
      this.startRespawn(r)
      return
    }
    const nearby: Obstacle[] = obstacles.slice()
    for (const o of this.racers) if (o !== r && o.position.distanceToSquared(k.position) < 20 * 20) nearby.push({ position: o.position, radius: 1.1, hazard: false })
    // Line up with crates when empty-handed.
    driver.laneBias = 0
    if (!r.item && r.roulette <= 0 && path === this.track.main) {
      for (const c of this.items.crates) {
        if (c.respawn > 0) continue
        const d = c.pos.distanceTo(k.position)
        if (d < 34 && d > 4) {
          const cl = this.track.main.closest(c.pos, r.tracker.hintMain)
          if (this.track.main.delta(loc.s, cl.s) > 0) {
            driver.laneBias = (cl.lateral - loc.lateral) * 0.6
            break
          }
        }
      }
    }
    const pose = {
      position: k.position,
      yaw: k.yaw,
      speed: k.speed,
      maxSpeed: k.spec.maxSpeed * k.speedScale * (k.boostTime > 0 ? 1.25 : 1),
      turnRate: k.spec.turnRate,
      drifting: k.drifting,
      driftDir: k.driftDir,
      driftTier: k.driftTier,
      grounded: k.grounded,
    }
    r.input = driver.update(dt, path, pose, nearby)
    // Rubber band (mild) relative to the player; none in attract mode.
    const ref = this.player && !this.player.finished ? this.player : null
    const base = r.isPlayer ? 0.96 : 0.955 + (r.driver?.skill.skill ?? 0.7) * 0.05
    k.speedScale = ref && !r.isPlayer ? base * catchUp(ref.progress.u - r.progress.u) : base
    // Re-decide the shortcut once per lap.
    if (Math.abs(this.track.main.delta(0, loc.s)) < 1) r.aiUseShortcut = Math.random() < CONFIG.ai.shortcutChance[Math.floor((r.driver?.skill.skill ?? 0.7) * 4.9) % 5]
    // Ramp tricks.
    if (this.launched.has(r) && k.airTime > 0.15 && k.airTime < 0.2 && !this.trick.has(r) && Math.random() < (r.driver?.skill.skill ?? 0.5) * 0.25) this.startTrick(r)
  }

  private aiItems(r: Racer, dt: number): void {
    if (!r.item || this.phase === 'countdown' || this.phase === 'intro') return
    r.aiItemDelay -= dt
    if (r.aiItemDelay > 0) return
    const loc = r.tracker.loc
    const rand = Math.random()
    let use = false
    switch (r.item) {
      case 'shield':
        use = !!this.items.beeFor(r) || rand < dt * 0.25
        break
      case 'pepper': {
        const spline = loc.path === 'main' ? this.track.main : this.track.short
        const straight = spline.maxCurvature(loc.s, 40, 4) < 0.025
        const fluffAhead = loc.path === 'short' && loc.s / this.track.short.length > 0.3 && loc.s / this.track.short.length < 0.5
        use = (straight && r.kart.speed > 14) || fluffAhead || rand < dt * 0.05
        break
      }
      case 'taffy': {
        const behind = this.racers.some(o => o !== r && r.progress.u - o.progress.u > 3 && r.progress.u - o.progress.u < 18 && Math.abs(o.tracker.loc.lateral - loc.lateral) < 4)
        use = behind || rand < dt * 0.08
        break
      }
      case 'bee': {
        const idx = this.ordered.indexOf(r)
        const ahead = idx > 0 ? this.ordered[idx - 1] : null
        use = !!ahead && !ahead.finished && ahead.progress.u - r.progress.u < 160
        break
      }
    }
    if (use) this.items.use(r, this.ordered)
    else r.aiItemDelay = 0.3
  }

  private startTrick(r: Racer): void {
    this.trick.set(r, 0)
    r.bounce(-0.8)
    if (r.isPlayer) this.audio.play('hop', { rate: 1.4 })
  }

  private startRespawn(r: Racer): void {
    if (r.respawnTime > 0) return
    r.respawnTime = CONFIG.race.respawnSeconds
    r.kart.cancelDrift()
    this.fx.ring(r.position, '#ffffff', 16, 6)
    if (r.isPlayer) {
      this.audio.play('respawn')
      this.hooks.toast('toast.respawn')
    }
  }

  private handleEvents(r: Racer): void {
    const me = r.isPlayer
    const near = this.player ? r.position.distanceTo(this.player.position) < 45 : false
    for (const e of r.events) {
      switch (e.type) {
        case 'hop':
          r.bounce(-0.6)
          if (me) this.audio.play('hop')
          break
        case 'driftStart':
          if (me && this.tutorial && this.tutorialStep === 'drift') this.advanceTutorial('driftRelease')
          break
        case 'driftTier':
          if (me) {
            this.audio.play('tier', { rate: [1, 1, 1.25, 1.5][e.tier] })
            this.input.rumble(0.1 * e.tier, 0.3, 80)
          }
          break
        case 'driftEnd':
          break
        case 'boost':
          if (me) {
            this.audio.play(e.source === 'pad' ? 'pad' : 'boost', { rate: e.source === 'drift' ? 0.8 + e.seconds * 0.3 : 1 })
            this.cam.punch(e.source === 'drift' ? 0.3 + e.seconds * 0.35 : 0.5)
            this.input.rumble(0.3, 0.5, 160)
            if (e.source === 'drift' && this.tutorial && this.tutorialStep === 'driftRelease') this.advanceTutorial('crate')
          }
          break
        case 'land': {
          this.launched.delete(r)
          const trick = this.trick.get(r)
          if (trick !== undefined) {
            this.trick.delete(r)
            r.kart.boost(0.9, 1.1)
            if (me) {
              this.audio.play('boost')
              this.hooks.toast('toast.trick')
              this.cam.punch(0.5)
            }
          }
          if (e.airTime > 0.35) {
            r.bounce(Math.min(2.5, e.impact * 0.12))
            if (near) this.fx.landing(r.view.root.position, e.impact)
            if (me) {
              this.audio.play('land', { gain: Math.min(1, e.impact / 10) })
              this.cam.addTrauma(Math.min(0.35, e.impact * 0.025))
              this.input.rumble(0.5, 0.2, 120)
            }
          }
          break
        }
        case 'bump': {
          const other = this.racers.find(o => o !== r && o.position.distanceTo(r.position) < 2.4)
          if (near && e.strength > 5) this.fx.wallHit(r.position.clone().addScaledVector(e.normal, -0.8), e.normal)
          if (me) {
            this.audio.play(other ? 'bump' : 'wall', { gain: Math.min(1, e.strength / 12) }, 0.12)
            this.cam.addTrauma(Math.min(0.4, e.strength * 0.03))
            this.input.rumble(0.4, 0.4, 100)
          }
          break
        }
        case 'takeoff':
          this.launched.add(r)
          break
      }
    }
    r.events.length = 0
    // Trick barrel-roll progress (0..1 over 0.4 s).
    const t = this.trick.get(r)
    if (t !== undefined) this.trick.set(r, Math.min(1, t + 1 / 60 / 0.4))
  }

  private kartContacts(): void {
    // Shielded or pepper-boosted karts send others flying on contact.
    for (let i = 0; i < this.racers.length; i += 1)
      for (let j = i + 1; j < this.racers.length; j += 1) {
        const a = this.racers[i]
        const b = this.racers[j]
        const d = a.position.distanceTo(b.position)
        if (d > 1.9) continue
        const power = (r: Racer) => (r.shielded ? 1 : 0) + (r.kart.boostPower > 1.15 && r.kart.boostTime > 0 ? 1 : 0)
        const pa = power(a)
        const pb = power(b)
        if (pa === pb) continue
        const [strong, weak] = pa > pb ? [a, b] : [b, a]
        if (weak.kart.spinTime > 0 || weak.shielded) continue
        const dir = weak.position.clone().sub(strong.position).setY(0).normalize()
        weak.kart.impulse(dir.multiplyScalar(9).add(new THREE.Vector3(0, 4, 0)))
        weak.kart.spinOut(0.7, 0.55)
        weak.bounce(1)
        this.fx.ring(weak.position, '#ffffff', 12, 6)
        this.sfxAt('bump', weak.position)
        if (weak.isPlayer) {
          this.cam.addTrauma(0.5)
          this.hooks.hurt('bee')
        }
      }
  }

  private onHit(victim: Racer, by: Racer | null, kind: 'bee' | 'taffy'): void {
    if (victim.isPlayer) {
      this.hooks.hurt(kind)
      this.audio.play('hitMe')
      this.cam.addTrauma(0.75)
      this.hitstop = 0.07
      this.input.rumble(1, 0.8, 300)
    } else if (by?.isPlayer) {
      this.hooks.toast(kind === 'bee' ? 'toast.beeHit' : 'toast.taffyHit', { name: `char.${victim.character.id}.name` })
      this.hitstop = 0.04
    }
  }

  private onProgress(r: Racer, type: 'lap' | 'finish', lap: number): void {
    if (type === 'finish') {
      r.finishPlace = this.racers.filter(o => o.finished).length
      if (r.isPlayer) this.onPlayerFinish()
      return
    }
    if (!r.isPlayer) return
    if (lap === CONFIG.race.laps) {
      this.hooks.banner('final')
      this.audio.play('finalLap')
      this.music.tempoScale = 1.08
    } else {
      this.hooks.banner('lap', { lap, laps: CONFIG.race.laps })
      this.audio.play('lap')
    }
  }

  private onPlayerFinish(): void {
    const p = this.player!
    this.phase = 'done'
    this.cam.mode = 'orbit'
    this.cam.resetTime()
    this.hooks.banner('finish', { place: p.finishPlace })
    this.audio.play(p.finishPlace <= 3 ? 'finish' : 'lose')
    this.music.stop()
    this.fx.confetti(p.position.clone().setY(p.position.y + 2), 60, 1.4)
    this.resultTimer = CONFIG.race.resultsDelay
    this.hooks.hint('none')
    this.tutorial = false
    // Freeze results at the moment the player crosses; estimate the rest.
    const rows: ResultRow[] = this.racers.map(r => {
      const remaining = CONFIG.race.laps * this.track.length - r.progress.u
      const time = r.finished ? r.progress.finishTime : estimateFinish(this.raceTime, remaining, Math.max(16, r.kart.spec.maxSpeed * 0.82))
      const laps = r.progress.lapTimes
      return { place: 0, character: r.character.id, time, bestLap: laps.length ? Math.min(...laps) : 0, me: r.isPlayer, estimated: !r.finished }
    })
    rows.sort((a, b) => a.time - b.time)
    rows.forEach((row, i) => (row.place = i + 1))
    const mine = rows.find(r => r.me)!
    this.finishedResult = { rows, place: mine.place, time: mine.time, bestLap: mine.bestLap, character: p.character.id }
  }

  private playerChecks(dt: number): void {
    const p = this.player!
    if (p.place !== this.lastPlace && this.phase === 'racing') {
      if (this.phaseTime > 2) {
        this.hooks.placeChange(p.place < this.lastPlace)
        if (p.place < this.lastPlace) this.audio.play('overtake')
      }
      this.lastPlace = p.place
    }
    // Wrong way.
    const loc = p.tracker.loc
    const spline = loc.path === 'main' ? this.track.main : this.track.short
    const t = spline.at(loc.s).tan
    const fwd = p.kart.forward
    const backwards = fwd.x * t.x + fwd.z * t.z < -0.4 && Math.abs(p.kart.speed) > 3
    this.wrongTimer = backwards ? this.wrongTimer + dt : Math.max(0, this.wrongTimer - dt * 3)
    p.wrongWay = this.wrongTimer > 1.4 ? 1 : 0
    // Tutorial pacing.
    if (this.tutorial) {
      this.hintTimer += dt
      if (this.tutorialStep === 'drive' && this.phase === 'racing' && this.phaseTime > 3) this.advanceTutorial('drift')
      if (this.tutorialStep === 'shortcut' && this.hintTimer > 7) this.advanceTutorial('none')
      if (this.tutorialStep === 'crate' && p.item) this.advanceTutorial('item')
    }
    if (p.item && !p.rouletteItem && p.roulette <= 0 && !(p as unknown as { _announced?: boolean })._announced) {
      ;(p as unknown as { _announced?: boolean })._announced = true
      this.hooks.itemReady(p.item)
      this.audio.play('itemReady')
    }
    if (!p.item) (p as unknown as { _announced?: boolean })._announced = false
  }

  private advanceTutorial(next: Hint): void {
    this.tutorialStep = next
    this.hintTimer = 0
    this.hooks.hint(next)
    if (next === 'none') this.tutorial = false
  }

  private updateStandings(): void {
    const ids = standings(this.racers.map(r => ({ id: r.id, u: r.progress.u, finished: r.finished, finishTime: r.progress.finishTime })))
    this.ordered = ids.map(id => this.racers[id])
    this.ordered.forEach((r, i) => (r.place = i + 1))
  }

  private attractStep(dt: number): void {
    this.attractSwitch -= dt
    if (this.attractSwitch <= 0) {
      this.attractSwitch = 7
      this.attractTarget = (this.attractTarget + 1 + Math.floor(Math.random() * 3)) % this.racers.length
      this.cam.snap()
    }
    // Keep the demo race going forever.
    for (const r of this.racers) if (r.progress.lapsDone >= CONFIG.race.laps - 1) r.progress = { ...r.progress, lapsDone: 0, u: r.progress.u - this.track.length * (CONFIG.race.laps - 1) }
  }

  // ─── rendering ───────────────────────────────────────────────────

  render(alpha: number, frameSeconds: number): void {
    const dt = Math.min(frameSeconds, 0.05)
    const focusRacer = this.mode === 'title' ? this.racers[this.attractTarget] : this.player
    const camPos = this.cam.camera.position
    for (const r of this.racers) {
      const near = r.position.distanceToSquared(camPos) < 110 * 110
      r.animate(alpha, dt, this.time, this.fx, near)
      const blink = r.respawnTime > 0 && Math.floor(this.time * 16) % 2 === 0
      r.view.root.visible = !blink
      const trick = this.trick.get(r)
      if (trick !== undefined) r.view.body.rotation.z += easeTrick(trick) * Math.PI * 2 * (r.id % 2 ? 1 : -1)
    }
    this.items.animate(dt, this.time)
    this.track.updateVisuals(this.time)
    this.fx.update(this.mode === 'paused' ? 0 : dt)

    if (this.mode === 'select') {
      if (this.showroom) {
        this.showroom.view.root.rotation.y = this.time * 0.6
        this.showroom.view.head.rotation.y = Math.sin(this.time * 1.3) * 0.4
      }
      const c = this.showroomAt.clone()
      const smp = this.track.main.at(this.track.length - 60)
      const side = smp.right.clone().multiplyScalar(-1)
      const camTarget = c.clone().add(new THREE.Vector3(0, 1.55, 0)).addScaledVector(smp.tan, -1.9)
      const desired = c.clone().addScaledVector(side, -8.4).addScaledVector(smp.tan, -1.8).add(new THREE.Vector3(0, 3.0, 0))
      if (this.selectSnap) {
        this.selectSnap = false
        this.cam.camera.position.copy(desired).addScaledVector(side, -3).add(new THREE.Vector3(0, 1.5, 0))
        this.cam.camera.fov = 48
      }
      this.cam.camera.position.lerp(desired, 1 - Math.exp(-4 * dt))
      this.cam.camera.lookAt(camTarget)
      this.cam.camera.fov += (40 - this.cam.camera.fov) * (1 - Math.exp(-4 * dt))
      this.cam.camera.updateProjectionMatrix()
      this.cam.snap()
    } else if (focusRacer) {
      const k = focusRacer.kart
      const pos = focusRacer.view.root.position.clone().setY(focusRacer.view.root.position.y + k.spec.rideHeight)
      const v = k.velocity
      const velYaw = Math.hypot(v.x, v.z) > 2 ? Math.atan2(v.x, v.z) : k.yaw
      this.cam.reducedMotion = this.reducedMotion
      if (this.mode !== 'paused') this.cam.update(dt, pos, k.renderYaw(alpha), velYaw, k.speed, k.boostTime > 0, !k.grounded, focusRacer.tracker.loc.height)
    }
    const focus = this.mode === 'select' ? this.showroomAt : (focusRacer?.position ?? this.track.main.at(0).pos)
    this.scenery.update(this.time, dt, focus)
    if (this.mode !== 'paused') this.fx.updateAmbient(dt, this.cam.camera.position)
    this.updateAudio()
    this.renderer.render(this.scene, this.cam.camera)
  }

  private updateAudio(): void {
    const p = this.player
    if (!p || this.mode !== 'playing' || !this.engine) return
    const k = p.kart
    const sp = Math.abs(k.speed)
    const boost = k.boostTime > 0
    const rpm = 55 + sp * 5.2 + (boost ? 24 : 0) + (this.phase === 'countdown' && this.input.axes.throttle > 0.5 ? 60 + Math.sin(this.time * 30) * 8 : 0)
    this.engine.set(rpm, 0.05 + Math.min(0.06, sp * 0.002) + (boost ? 0.02 : 0), 500 + sp * 45 + (boost ? 900 : 0))
    this.squeal?.set(0, k.drifting && k.grounded ? 0.05 + k.driftTier * 0.015 : 0, 1600 + k.driftTier * 500, 0, 3)
    this.wind?.set(0, Math.min(0.08, sp * 0.0025) * (boost ? 1.6 : 1), 300 + sp * 40)
    let buzzGain = 0
    for (const b of this.items.bees) {
      const d = b.pos.distanceTo(p.position)
      buzzGain = Math.max(buzzGain, Math.max(0, 1 - d / 50) * 0.06)
    }
    this.buzz?.set(210 + Math.sin(this.time * 40) * 8, buzzGain, 900, 0, 4)
  }

  private sfxAt(name: string, at: THREE.Vector3, gain = 1): void {
    const cam = this.cam.camera
    const d = at.distanceTo(cam.position)
    if (d > 80 || this.mode === 'title') return
    const rel = at.clone().sub(cam.position).normalize()
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion)
    this.audio.play(name, { gain: gain * Math.max(0.15, 1 - d / 80), pan: rel.dot(right) * 0.7 })
  }

  // ─── HUD ─────────────────────────────────────────────────────────

  hud(): HudState {
    const p = this.player!
    const k = p.kart
    return {
      phase: this.phase,
      place: p.finished ? p.finishPlace : p.place,
      total: this.racers.length,
      lap: currentLap(p.progress),
      laps: CONFIG.race.laps,
      time: p.finished ? p.progress.finishTime : this.raceTime,
      lastLap: p.progress.lapTimes[p.progress.lapTimes.length - 1] ?? 0,
      item: p.item,
      rolling: p.roulette > 0,
      shield: p.shieldTime,
      driftTier: k.driftTier,
      driftCharge: k.driftCharge,
      drifting: k.drifting,
      speed: Math.abs(k.speed),
      boost: k.boostTime > 0,
      wrongWay: p.wrongWay > 0,
      beeWarning: p.incomingBee > 0,
      map: this.racers.map(r => ({ x: r.position.x, z: r.position.z, color: r.character.ui, me: r.isPlayer, place: r.place })),
      finished: p.finished,
      countdown: this.phase === 'countdown' ? Math.max(0, CONFIG.race.countdown + 0.6 - this.phaseTime) : 0,
    }
  }
}

function easeTrick(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}
