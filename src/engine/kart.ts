import * as THREE from 'three'
import { RAPIER, type Physics } from './physics'

/**
 * Reusable arcade vehicle controller.
 *
 * A kart is a Rapier dynamic ball (walls, props and other karts collide physically, heavier
 * karts shove lighter ones) whose velocity is rewritten every fixed step from a kinematic
 * arcade model: ray-cast ground hugging, heading-based steering with speed-dependent authority,
 * lateral grip, hop-to-drift with tiered spark charge and release boost, jumps, and hit states
 * (spin-out, sticky slow, knock-back). Gameplay feeds `KartInput` and a `SurfaceProvider`;
 * everything else (items, AI, rules) lives outside.
 */
export type KartInput = {
  /** 0..1 */
  throttle: number
  /** 0..1 — brakes, then reverses. */
  brake: number
  /** -1..1, positive = right. */
  steer: number
  /** Drift button held. */
  drift: boolean
}

export type KartSpec = {
  radius: number
  rideHeight: number
  mass: number
  maxSpeed: number
  accel: number
  reverseSpeed: number
  brakeDecel: number
  coastDecel: number
  /** Yaw rate (rad/s) at full steer. */
  turnRate: number
  /** Lateral grip (1/s). */
  grip: number
  driftGrip: number
  /** Drift yaw multipliers for wide (steer against) and tight (steer into) lines. */
  driftWide: number
  driftTight: number
  driftMinSpeed: number
  hopSpeed: number
  gravity: number
  maxFall: number
  /** Seconds of charge to reach each spark tier. */
  tiers: readonly number[]
  /** Boost seconds granted per tier on release. */
  tierBoost: readonly number[]
  boostSpeed: number
  boostAccel: number
  /** 0..1: how much a wall impact turns the nose along the deflected velocity. */
  wallGlance: number
}

export type SurfaceInfo = {
  /** Multiplier on top speed (offroad < 1). */
  speedMul: number
  /** Multiplier on grip. */
  gripMul: number
  /** Standing on a boost pad this step. */
  boostPad: boolean
}

export type SurfaceProvider = (pos: THREE.Vector3, groundCollider: RAPIER.Collider | null) => SurfaceInfo

export type KartEvent =
  | { type: 'hop' }
  | { type: 'driftStart'; dir: number }
  | { type: 'driftTier'; tier: number }
  | { type: 'driftEnd'; tier: number }
  | { type: 'boost'; source: 'drift' | 'pad' | 'item' | 'start' | 'land'; seconds: number }
  | { type: 'takeoff' }
  | { type: 'land'; impact: number; airTime: number }
  | { type: 'bump'; strength: number; normal: THREE.Vector3 }

export const COLLISION = {
  GROUND: 0x0001,
  WALL: 0x0002,
  DEBRIS: 0x0004,
  KART: 0x0008,
}
/** Interaction groups word: membership in the high 16 bits, filter in the low 16. */
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff)

const UP = new THREE.Vector3(0, 1, 0)

export class KartController {
  readonly body: RAPIER.RigidBody
  readonly collider: RAPIER.Collider
  readonly position = new THREE.Vector3()
  readonly prevPosition = new THREE.Vector3()
  readonly velocity = new THREE.Vector3()
  readonly groundNormal = new THREE.Vector3(0, 1, 0)
  yaw = 0
  prevYaw = 0
  /** Signed forward speed (m/s). */
  speed = 0
  grounded = true
  airTime = 0
  drifting = false
  driftDir = 0
  driftCharge = 0
  driftTier = 0
  boostTime = 0
  boostPower = 1
  /** Hit states. */
  spinTime = 0
  spinTotal = 0
  stickTime = 0
  stunTime = 0
  /** Visual-only spin angle accumulated during spin-outs. */
  spinAngle = 0
  /** Reduced grip after bumps so karts slide instead of snapping back. */
  bumpTime = 0
  /** Multiplier for top speed from outside systems (catch-up, difficulty). */
  speedScale = 1
  surface: SurfaceInfo = { speedMul: 1, gripMul: 1, boostPad: false }
  groundCollider: RAPIER.Collider | null = null
  steerSmoothed = 0

  private hopTime = 0
  private driftHeldPrev = false
  private pendingDrift = false
  private intended = new THREE.Vector3()
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
  private readonly fwd = new THREE.Vector3()
  private readonly right = new THREE.Vector3()

  constructor(
    private readonly physics: Physics,
    public spec: KartSpec,
    start: THREE.Vector3,
    yaw: number,
    private readonly surfaceAt: SurfaceProvider,
  ) {
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(start.x, start.y + spec.rideHeight, start.z)
        .lockRotations()
        .setGravityScale(0)
        .setCcdEnabled(true)
        .setLinearDamping(0),
    )
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.ball(spec.radius)
        .setMass(spec.mass)
        .setFriction(0)
        .setRestitution(0.35)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setCollisionGroups(groups(COLLISION.KART, COLLISION.WALL | COLLISION.KART)),
      this.body,
    )
    this.teleport(start, yaw)
  }

  get forward(): THREE.Vector3 {
    return this.fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))
  }

  get boosting(): boolean {
    return this.boostTime > 0
  }

  get stunned(): boolean {
    return this.spinTime > 0 || this.stunTime > 0
  }

  teleport(p: THREE.Vector3, yaw: number): void {
    this.body.setTranslation({ x: p.x, y: p.y + this.spec.rideHeight, z: p.z }, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.position.set(p.x, p.y + this.spec.rideHeight, p.z)
    this.prevPosition.copy(this.position)
    this.velocity.set(0, 0, 0)
    this.yaw = this.prevYaw = yaw
    this.speed = 0
    this.drifting = false
    this.driftCharge = 0
    this.driftTier = 0
    this.boostTime = 0
    this.spinTime = this.stickTime = this.stunTime = this.bumpTime = 0
    this.spinAngle = 0
    this.grounded = true
    this.airTime = 0
  }

  /** Start a boost (stacks by keeping the longer time and the stronger power). */
  boost(seconds: number, power = 1): void {
    this.boostTime = Math.max(this.boostTime, seconds)
    this.boostPower = this.boostTime > 0 && this.boostPower > power ? this.boostPower : power
  }

  /** Spin out: lose most speed and control for `seconds`. */
  spinOut(seconds: number, keepSpeed = 0.35): void {
    this.spinTime = seconds
    this.spinTotal = seconds
    this.speed *= keepSpeed
    this.cancelDrift()
    this.boostTime = 0
  }

  /** Gooey slow-down: top speed and acceleration heavily reduced. */
  stick(seconds: number): void {
    this.stickTime = Math.max(this.stickTime, seconds)
    this.cancelDrift()
    this.boostTime = 0
  }

  /** Instant velocity change in world space (item hits, rams). */
  impulse(v: THREE.Vector3): void {
    const lv = this.body.linvel()
    this.body.setLinvel({ x: lv.x + v.x, y: lv.y + v.y, z: lv.z + v.z }, true)
    if (v.y > 1) this.grounded = false
    this.bumpTime = Math.max(this.bumpTime, 0.35)
  }

  cancelDrift(): void {
    this.drifting = false
    this.driftCharge = 0
    this.driftTier = 0
    this.pendingDrift = false
  }

  /** Advance one fixed step BEFORE the physics world steps. */
  step(dt: number, input: KartInput, events: KartEvent[]): void {
    const S = this.spec
    this.prevPosition.copy(this.position)
    this.prevYaw = this.yaw
    const t = this.body.translation()
    this.position.set(t.x, t.y, t.z)
    const lv = this.body.linvel()
    this.velocity.set(lv.x, lv.y, lv.z)

    // ── ground probe ───────────────────────────────────────────────
    const wasGrounded = this.grounded
    const probeUp = 1.2
    const snap = wasGrounded ? 0.45 : 0.06
    this.ray.origin = { x: t.x, y: t.y + probeUp, z: t.z }
    const hit = this.physics.world.castRayAndGetNormal(this.ray, probeUp + S.rideHeight + snap, true, undefined, groups(0xffff, COLLISION.GROUND))
    let groundY = -Infinity
    if (hit && (this.velocity.y < 3 || wasGrounded)) {
      groundY = t.y + probeUp - hit.timeOfImpact
      this.groundNormal.set(hit.normal.x, hit.normal.y, hit.normal.z)
      if (this.groundNormal.y < 0.5) this.groundNormal.set(0, 1, 0)
      this.groundCollider = hit.collider
      this.grounded = this.hopTime <= 0
    } else {
      this.grounded = false
      this.groundCollider = null
    }
    if (this.grounded && !wasGrounded) {
      events.push({ type: 'land', impact: Math.max(0, -this.velocity.y), airTime: this.airTime })
      if (this.pendingDrift && input.drift && Math.abs(input.steer) > 0.2 && this.speed > S.driftMinSpeed) this.startDrift(Math.sign(input.steer), events)
      this.pendingDrift = false
    }
    if (!this.grounded && wasGrounded && this.hopTime <= 0) events.push({ type: 'takeoff' })
    this.airTime = this.grounded ? 0 : this.airTime + dt
    this.hopTime = Math.max(0, this.hopTime - dt)

    this.surface = this.surfaceAt(this.position, this.groundCollider)
    if (this.grounded && this.surface.boostPad) {
      if (this.boostTime < 0.9) events.push({ type: 'boost', source: 'pad', seconds: 1.1 })
      this.boost(1.1, 1.1)
    }

    // ── timers ────────────────────────────────────────────────────
    this.boostTime = Math.max(0, this.boostTime - dt)
    this.stickTime = Math.max(0, this.stickTime - dt)
    this.stunTime = Math.max(0, this.stunTime - dt)
    this.bumpTime = Math.max(0, this.bumpTime - dt)
    if (this.spinTime > 0) {
      this.spinTime = Math.max(0, this.spinTime - dt)
      // Two full turns eased out over the spin duration.
      const k = this.spinTotal > 0 ? dt / this.spinTotal : 0
      this.spinAngle += Math.PI * 4 * k * (0.4 + 1.6 * (this.spinTime / Math.max(0.01, this.spinTotal)))
    } else {
      this.spinAngle = THREE.MathUtils.damp(this.spinAngle, Math.round(this.spinAngle / (Math.PI * 2)) * Math.PI * 2, 10, dt)
    }

    const stunned = this.stunned
    const throttle = stunned ? 0 : THREE.MathUtils.clamp(input.throttle, 0, 1)
    const brake = stunned ? 0 : THREE.MathUtils.clamp(input.brake, 0, 1)
    const steer = stunned ? 0 : THREE.MathUtils.clamp(input.steer, -1, 1)
    this.steerSmoothed = steer

    // ── frame ─────────────────────────────────────────────────────
    const fwd = this.forward
    const right = this.right.set(-fwd.z, 0, fwd.x)
    let vf = this.velocity.x * fwd.x + this.velocity.z * fwd.z
    let vl = this.velocity.x * right.x + this.velocity.z * right.z
    this.speed = vf

    // ── drift state machine ───────────────────────────────────────
    const driftPressed = input.drift && !this.driftHeldPrev && !stunned
    this.driftHeldPrev = input.drift
    if (driftPressed && this.grounded && vf > 4) {
      this.hopTime = 0.1
      this.grounded = false
      this.velocity.y = S.hopSpeed
      this.pendingDrift = true
      events.push({ type: 'hop' })
      if (Math.abs(steer) > 0.2 && vf > S.driftMinSpeed) {
        this.startDrift(Math.sign(steer), events)
        this.pendingDrift = false
      }
    }
    if (this.pendingDrift && input.drift && Math.abs(steer) > 0.25 && vf > S.driftMinSpeed && !this.drifting) {
      this.startDrift(Math.sign(steer), events)
      this.pendingDrift = false
    }
    if (this.drifting) {
      const release = !input.drift
      const fail = vf < S.driftMinSpeed * 0.7 || stunned || this.surface.speedMul < 0.75
      if (release || fail) {
        const tier = this.driftTier
        events.push({ type: 'driftEnd', tier })
        if (!fail && tier > 0) {
          const secs = S.tierBoost[tier - 1]
          this.boost(secs, 1 + tier * 0.06)
          events.push({ type: 'boost', source: 'drift', seconds: secs })
        }
        this.cancelDrift()
      } else if (this.grounded) {
        const into = steer * this.driftDir
        this.driftCharge += dt * (0.75 + 0.55 * Math.max(0, into))
        const tier = S.tiers.filter(x => this.driftCharge >= x).length
        if (tier > this.driftTier) {
          this.driftTier = tier
          events.push({ type: 'driftTier', tier })
        }
      }
    }

    // ── longitudinal ──────────────────────────────────────────────
    const slow = this.stickTime > 0 ? 0.32 : 1
    let top = S.maxSpeed * this.speedScale * this.surface.speedMul * slow
    let accel = S.accel * (this.stickTime > 0 ? 0.4 : 1)
    if (this.boostTime > 0) {
      top = Math.max(top, S.boostSpeed * this.speedScale * this.boostPower * (this.surface.speedMul < 1 ? 0.92 : 1))
      accel = S.boostAccel
    }
    if (this.grounded) {
      if (this.boostTime > 0 && vf < top) vf = Math.min(top, vf + accel * dt)
      else if (throttle > 0 && vf < top) {
        const k = 1 - 0.55 * THREE.MathUtils.clamp(vf / top, 0, 1)
        vf = Math.min(top, vf + accel * throttle * k * dt)
      } else if (vf > top) {
        vf = Math.max(top, vf - (this.surface.speedMul < 1 ? 38 : 14) * dt)
      }
      if (brake > 0) {
        if (vf > 0.5) vf -= S.brakeDecel * brake * dt
        else vf = Math.max(-S.reverseSpeed, vf - S.accel * 0.6 * brake * dt)
      }
      if (throttle === 0 && brake === 0 && this.boostTime <= 0) {
        const drag = S.coastDecel * dt
        vf = Math.abs(vf) <= drag ? 0 : vf - Math.sign(vf) * drag
      }
      if (this.stickTime > 0) vf *= Math.exp(-2.2 * dt)
      if (this.spinTime > 0) vf *= Math.exp(-2.4 * dt)
    } else if (throttle > 0 && vf < top) {
      vf += accel * 0.15 * dt
    }

    // ── steering ─────────────────────────────────────────────────
    const absV = Math.abs(vf)
    const authority = THREE.MathUtils.clamp(absV / 7, 0, 1) * (1 - 0.28 * THREE.MathUtils.clamp((absV - 14) / 18, 0, 1))
    let yawRate = 0
    if (this.drifting) {
      const into = steer * this.driftDir
      const m = THREE.MathUtils.lerp(S.driftWide, S.driftTight, (into + 1) / 2)
      yawRate = this.driftDir * S.turnRate * m * Math.max(0.6, authority)
    } else {
      yawRate = steer * S.turnRate * authority * Math.sign(vf || 1)
    }
    if (!this.grounded) yawRate *= 0.55
    this.yaw -= yawRate * dt

    // ── lateral grip ─────────────────────────────────────────────
    const newFwd = this.forward
    const newRight = this.right.set(-newFwd.z, 0, newFwd.x)
    // Re-project the old velocity on the rotated frame (the kart turns, momentum stays).
    const hx = fwd.x * vf + right.x * vl
    const hz = fwd.z * vf + right.z * vl
    vf = hx * newFwd.x + hz * newFwd.z
    vl = hx * newRight.x + hz * newRight.z
    let grip = (this.drifting ? S.driftGrip : S.grip) * this.surface.gripMul
    if (this.bumpTime > 0) grip *= 0.25
    if (this.spinTime > 0) grip *= 0.35
    if (!this.grounded) grip *= 0.15
    const lostLat = Math.abs(vl) * (1 - Math.exp(-grip * dt))
    vl *= Math.exp(-grip * dt)
    // Part of the scrubbed sideways speed carries into forward speed while drifting.
    if (this.drifting && vf > 0) vf += lostLat * 0.55

    // ── vertical ─────────────────────────────────────────────────
    const vx = newFwd.x * vf + newRight.x * vl
    const vz = newFwd.z * vf + newRight.z * vl
    let vy = this.velocity.y
    if (this.grounded) {
      const n = this.groundNormal
      vy = -(n.x * vx + n.z * vz) / Math.max(0.3, n.y)
      const targetY = groundY + S.rideHeight
      vy += THREE.MathUtils.clamp((targetY - t.y) * 14, -8, 8)
    } else {
      vy = Math.max(S.maxFall, vy + S.gravity * dt)
    }
    this.intended.set(vx, vy, vz)
    this.body.setLinvel({ x: vx, y: vy, z: vz }, true)
    this.speed = vf
  }

  /** Read results AFTER the physics world stepped (collisions resolved). */
  postStep(events: KartEvent[]): void {
    const t = this.body.translation()
    this.position.set(t.x, t.y, t.z)
    const lv = this.body.linvel()
    const dvx = lv.x - this.intended.x
    const dvz = lv.z - this.intended.z
    const dv = Math.hypot(dvx, dvz)
    if (dv > 3.5) {
      this.bumpTime = Math.max(this.bumpTime, 0.18)
      events.push({ type: 'bump', strength: dv, normal: new THREE.Vector3(dvx / dv, 0, dvz / dv) })
      if (dv > 9) this.cancelDrift()
      // Glancing blows: swing the nose toward the deflected velocity so the kart scrapes along
      // the barrier and keeps most of its speed instead of grinding to a halt facing the wall.
      const hs = Math.hypot(lv.x, lv.z)
      if (hs > 3 && !this.stunned) {
        let d = Math.atan2(lv.x, lv.z) - this.yaw
        d = Math.atan2(Math.sin(d), Math.cos(d))
        if (Math.abs(d) < 1.9) this.yaw += THREE.MathUtils.clamp(d * this.spec.wallGlance, -0.4, 0.4)
      }
    }
  }

  private startDrift(dir: number, events: KartEvent[]): void {
    this.drifting = true
    this.driftDir = dir
    this.driftCharge = 0
    this.driftTier = 0
    events.push({ type: 'driftStart', dir })
  }

  /** Interpolated render transform. */
  renderPosition(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    return out.lerpVectors(this.prevPosition, this.position, alpha)
  }

  renderYaw(alpha: number): number {
    let d = this.yaw - this.prevYaw
    d = Math.atan2(Math.sin(d), Math.cos(d))
    return this.prevYaw + d * alpha
  }

  dispose(): void {
    this.physics.world.removeRigidBody(this.body)
  }
}

export { UP as WORLD_UP }
