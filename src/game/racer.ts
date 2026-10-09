import * as THREE from 'three'
import { KartController, type KartEvent, type KartInput } from '../engine/kart'
import type { Physics } from '../engine/physics'
import { SplineDriver } from '../engine/splineAi'
import { Trail } from '../engine/trail'
import type { Character } from './characters'
import { specFor, type ItemKind } from './config'
import { TIER_COLORS, type Fx } from './fx'
import { buildKart, type KartView } from './kartModel'
import { createProgress, type Progress } from './rules'
import { Tracker, type Track } from './track'

/**
 * One competitor: the reusable KartController (physics/handling) plus everything the race adds on
 * top — track tracking, lap progress, held item, shield, respawn state and the animated view.
 * AI racers also own a SplineDriver; the player is driven by Input in game.ts.
 */
export class Racer {
  readonly kart: KartController
  readonly view: KartView
  readonly tracker = new Tracker()
  readonly driver?: SplineDriver
  readonly events: KartEvent[] = []
  progress: Progress
  place = 1
  item: ItemKind | null = null
  /** Seconds left on the item roulette (item is revealed at 0). */
  roulette = 0
  rouletteItem: ItemKind | null = null
  shieldTime = 0
  respawnTime = 0
  /** AI: time until it considers using its item. */
  aiItemDelay = 0
  aiUseShortcut = false
  /** AI is committed to the shortcut spline. */
  shortRoute = false
  /** Seconds the AI has been (nearly) stationary while racing. */
  aiStuck = 0
  /** Racer that the bee we threw is chasing etc. — used for UI warnings. */
  incomingBee = 0
  finishPlace = 0
  goo = 0
  wrongWay = 0
  hitFlash = 0
  input: KartInput = { throttle: 0, brake: 0, steer: 0, drift: false }
  readonly trails: Trail[]
  private wheelSpin = 0
  private lean = 0
  private pitch = 0
  private squash = 0
  private squashVel = 0
  private lastRear: (THREE.Vector3 | null)[] = [null, null]
  private readonly goo3d: THREE.Mesh
  private readonly rp = new THREE.Vector3()

  constructor(
    readonly id: number,
    readonly character: Character,
    readonly isPlayer: boolean,
    physics: Physics,
    track: Track,
    slot: { pos: THREE.Vector3; yaw: number; s: number },
    skill: number,
  ) {
    const spec = specFor(character.stats)
    this.kart = new KartController(physics, spec, slot.pos, slot.yaw, pos => track.surface(track.locate(pos, this.tracker)))
    this.view = buildKart(character)
    this.progress = createProgress(slot.s, track.length)
    if (!isPlayer) {
      this.driver = new SplineDriver({ skill, lane: ((id * 0.37) % 1) * 1.2 - 0.6, bravery: 0.4 + skill * 0.6, wobble: (1 - skill) * 0.5 })
    }
    this.trails = [new Trail(22, 0.35, character.ui, 0.9), new Trail(22, 0.35, character.ui, 0.9)]
    this.goo3d = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1), new THREE.MeshStandardMaterial({ color: '#7ef0c0', transparent: true, opacity: 0.85, roughness: 0.2, flatShading: true }))
    this.goo3d.scale.set(1.3, 0.45, 1.5)
    this.goo3d.position.y = 0.4
    this.goo3d.visible = false
    this.view.root.add(this.goo3d)
    this.view.root.traverse(o => {
      if ((o as THREE.Mesh).isMesh && o !== this.view.shield) o.castShadow = true
    })
  }

  get position(): THREE.Vector3 {
    return this.kart.position
  }

  get finished(): boolean {
    return this.progress.finished
  }

  get shielded(): boolean {
    return this.shieldTime > 0
  }

  /** Update the view from the simulation (interpolated) and spawn continuous effects. */
  animate(alpha: number, dt: number, time: number, fx: Fx, near: boolean): void {
    const k = this.kart
    const v = this.view
    const p = k.renderPosition(alpha, this.rp)
    v.root.position.set(p.x, p.y - k.spec.rideHeight, p.z)
    const yaw = k.renderYaw(alpha)
    v.root.rotation.set(0, yaw, 0)
    // Align to the ground normal (pitch/roll), smoothed.
    const n = k.groundNormal
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x)
    const targetPitch = k.grounded ? -Math.asin(THREE.MathUtils.clamp(n.x * fwd.x + n.z * fwd.z, -0.6, 0.6)) : THREE.MathUtils.clamp(-k.velocity.y * 0.025, -0.35, 0.3)
    this.pitch = THREE.MathUtils.damp(this.pitch, targetPitch, 10, dt)
    const steer = k.drifting ? k.driftDir * 0.6 + this.input.steer * 0.4 : this.input.steer
    const leanTarget = (k.drifting ? k.driftDir * 0.16 : steer * 0.09) * THREE.MathUtils.clamp(Math.abs(k.speed) / 20, 0, 1)
    this.lean = THREE.MathUtils.damp(this.lean, leanTarget, 8, dt)
    // Spring squash for hops/landings.
    this.squashVel += (-this.squash * 220 - this.squashVel * 14) * dt
    this.squash += this.squashVel * dt
    v.body.rotation.set(this.pitch, k.drifting ? -k.driftDir * 0.32 : 0, this.lean)
    v.body.rotation.y += k.spinAngle
    v.body.scale.set(1 + this.squash * 0.5, 1 - this.squash, 1 + this.squash * 0.5)
    // Wheels.
    this.wheelSpin += (k.speed * dt) / 0.36
    for (const w of v.wheels) w.rotation.x = this.wheelSpin
    for (const f of v.frontPivots) f.rotation.y = -steer * 0.42
    // Driver: lean into turns, bob with speed, look toward the drift.
    v.head.rotation.set(Math.sin(time * 9) * 0.03 * Math.min(1, Math.abs(k.speed) / 10), -steer * 0.35, this.lean * 1.5)
    v.driver.position.y = Math.abs(Math.sin(time * 14)) * 0.02 * Math.min(1, Math.abs(k.speed) / 12)
    if (v.tail) v.tail.rotation.x = -0.3 + Math.sin(time * 6) * 0.1 - Math.min(0.6, Math.abs(k.speed) / 40)
    // Shield bubble.
    v.shield.visible = this.shieldTime > 0
    if (v.shield.visible) {
      const m = v.shield.material as THREE.ShaderMaterial
      m.uniforms.uTime.value = time
      const flicker = this.shieldTime < 1.5 ? (Math.sin(time * 30) > 0 ? 1 : 0.3) : 1
      v.shield.scale.setScalar(flicker)
    }
    this.goo3d.visible = this.goo > 0
    if (this.goo > 0) {
      const w = 1 + Math.sin(time * 12) * 0.06
      this.goo3d.scale.set(1.3 * w, 0.45 / w, 1.5)
    }
    v.shadow.position.set(p.x, p.y - k.spec.rideHeight + 0.06 - (k.grounded ? 0 : Math.min(6, k.airTime * 6)), p.z)
    v.shadow.visible = true
    const air = k.grounded ? 1 : Math.max(0.3, 1 - k.airTime)
    ;(v.shadow.material as THREE.MeshBasicMaterial).opacity = 0.32 * air
    v.shadow.rotation.z = -yaw

    if (!near) {
      for (const t of this.trails) t.update(p, right, false)
      return
    }
    // Drift sparks + skid marks.
    const world = (local: THREE.Vector3) => local.clone().applyEuler(new THREE.Euler(0, yaw, 0)).add(v.root.position)
    if (k.drifting && k.grounded) {
      v.sparkPoints.forEach((sp, i) => {
        const wp = world(sp)
        if (k.driftTier > 0) fx.sparks(wp, right.clone().multiplyScalar(-k.driftDir), k.driftTier, 0.8)
        else if (Math.random() < 0.35) fx.dust(wp, '#fff0f6', 1, 0.6)
        const last = this.lastRear[i]
        if (last) fx.skids.add(last, wp)
        this.lastRear[i] = wp
      })
    } else this.lastRear = [null, null]
    // Offroad dust.
    if (k.grounded && k.surface.speedMul < 0.9 && Math.abs(k.speed) > 6 && Math.random() < 0.6) fx.dust(world(v.sparkPoints[Math.random() < 0.5 ? 0 : 1]), k.surface.speedMul < 0.52 ? '#ffd1ec' : '#fff3d6', 1, 0.8)
    // Boost flames + streaks.
    const boosting = k.boostTime > 0
    v.exhausts.forEach((e, i) => {
      const wp = world(e)
      if (boosting) fx.flame(wp, fwd.clone().multiplyScalar(-1), k.boostPower > 1.15)
      this.trails[i].color = boosting ? (k.boostPower > 1.15 ? '#ff7b3d' : TIER_COLORS[Math.max(1, Math.min(3, Math.round((k.boostPower - 1) / 0.06)))]) : this.character.ui
      this.trails[i].update(world(v.sparkPoints[i]).setY(v.root.position.y + 0.45), right, boosting && k.grounded ? true : boosting)
    })
  }

  /** Visual squash impulse (positive = squash down). */
  bounce(amount: number): void {
    this.squashVel += amount * 6
  }
}
