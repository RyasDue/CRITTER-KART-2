import * as THREE from 'three'
import type { KartInput } from './kart'
import { wrapAngle, type TrackSpline } from './spline'

/**
 * Reusable spline-following driver. It turns a kart pose plus a track spline into `KartInput`:
 * pure-pursuit steering toward a look-ahead point on a preferred racing lane, curvature-aware
 * speed control, drift entry/hold/release through long corners, lateral avoidance of
 * obstacles/karts ahead, and stuck recovery. It knows nothing about items or race rules; the
 * game decides which spline to follow (e.g. a shortcut branch) and which obstacles matter.
 */
export type DriverSkill = {
  /** 0..1 overall competence (reaction, line precision, drift use). */
  skill: number
  /** Preferred lane as a fraction of half width (-1 left .. 1 right). */
  lane: number
  /** Multiplier on corner speed the driver dares to carry. */
  bravery: number
  /** Probability-per-second of a small steering wobble. */
  wobble: number
}

export type DriverPose = {
  position: THREE.Vector3
  yaw: number
  speed: number
  maxSpeed: number
  turnRate: number
  drifting: boolean
  driftDir: number
  driftTier: number
  grounded: boolean
}

export type Obstacle = { position: THREE.Vector3; radius: number; /** Karts move; static hazards weigh more. */ hazard: boolean }

export type DriverDebug = { target: THREE.Vector3; targetSpeed: number; lateral: number }

export class SplineDriver {
  /** Extra lateral offset requested by the game (e.g. line up with an item box). */
  laneBias = 0
  /** Distance along the spline, updated by `update` from the closest query. */
  s = 0
  readonly debug: DriverDebug = { target: new THREE.Vector3(), targetSpeed: 0, lateral: 0 }
  private hint = -1
  private stuckTime = 0
  private reverseTime = 0
  private wobbleTime = 0
  private wobbleDir = 0
  private avoid = 0
  private laneDrift = 0
  private driftHold = 0

  constructor(public skill: DriverSkill, private readonly random: () => number = Math.random) {}

  resetTracking(): void {
    this.hint = -1
    this.stuckTime = 0
    this.reverseTime = 0
  }

  update(dt: number, path: TrackSpline, pose: DriverPose, obstacles: readonly Obstacle[]): KartInput {
    const sk = this.skill
    const c = path.closest(pose.position, this.hint)
    this.hint = c.index
    this.s = c.s
    const here = path.at(c.s)
    const half = here.halfWidth

    // Stuck recovery: reverse briefly with opposite lock.
    if (this.reverseTime > 0) {
      this.reverseTime -= dt
      const yawErr = wrapAngle(path.yawAt(c.s + 6) - pose.yaw)
      return { throttle: 0, brake: 1, steer: THREE.MathUtils.clamp(yawErr * 2, -1, 1), drift: false }
    }
    if (Math.abs(pose.speed) < 1.5) this.stuckTime += dt
    else this.stuckTime = Math.max(0, this.stuckTime - dt * 2)
    if (this.stuckTime > 1.4) {
      this.stuckTime = 0
      this.reverseTime = 0.9
    }

    // Slowly wander the preferred lane so the pack does not drive in single file.
    this.laneDrift += (this.random() - 0.5) * dt * 0.6
    this.laneDrift = THREE.MathUtils.clamp(this.laneDrift, -0.25, 0.25)

    // Lateral avoidance of obstacles in the look-ahead corridor.
    let push = 0
    const ahead = new THREE.Vector3(Math.sin(pose.yaw), 0, Math.cos(pose.yaw))
    for (const o of obstacles) {
      const dx = o.position.x - pose.position.x
      const dz = o.position.z - pose.position.z
      const along = dx * ahead.x + dz * ahead.z
      const range = o.hazard ? 26 : 12
      if (along < 1 || along > range) continue
      const side = dx * -ahead.z + dz * ahead.x
      const clearance = o.radius + 1.6
      if (Math.abs(side) > clearance + 0.8) continue
      const weight = (1 - along / range) * (o.hazard ? 1.4 : 0.8) * (0.5 + sk.skill * 0.5)
      push += -Math.sign(side || (this.random() - 0.5)) * (clearance + 0.8 - Math.abs(side)) * weight
    }
    this.avoid = THREE.MathUtils.damp(this.avoid, THREE.MathUtils.clamp(push, -6, 6), 6, dt)

    const lanePref = (sk.lane + this.laneDrift) * (half - 2.2) + this.laneBias
    // Racing line: drift toward the inside of upcoming corners.
    const turnAhead = path.headingChange(c.s + 6, 26)
    const inside = THREE.MathUtils.clamp(turnAhead * 3.4, -1, 1) * (half - 2.5) * 0.42 * sk.skill
    let lateral = THREE.MathUtils.clamp(lanePref * 0.7 - inside + this.avoid, -(half - 1.8), half - 1.8)
    // Edge recovery: when already close to a barrier, pull the line back toward the middle.
    const edge = Math.abs(c.lateral) - (half - 1.6)
    if (edge > 0) lateral -= Math.sign(c.lateral) * Math.min(3, edge * 2.2)
    this.debug.lateral = lateral

    // Pure pursuit target. The look-ahead shrinks in tight bends so the chord toward the target
    // never cuts through the inside barrier (sagitta = look^2 * kappa / 8 kept under ~0.7 m).
    const kLook = path.maxCurvature(c.s, 18)
    let look = 5.5 + Math.abs(pose.speed) * 0.42
    if (kLook > 1e-4) look = Math.min(look, Math.max(5, Math.sqrt(5.6 / kLook)))
    const target = path.pointAt(c.s + look, lateral, this.debug.target)
    const desiredYaw = Math.atan2(target.x - pose.position.x, target.z - pose.position.z)
    let yawErr = wrapAngle(desiredYaw - pose.yaw)

    // Occasional wobble for lower-skill drivers.
    this.wobbleTime -= dt
    if (this.wobbleTime <= 0 && this.random() < sk.wobble * dt) {
      this.wobbleTime = 0.25 + this.random() * 0.35
      this.wobbleDir = this.random() < 0.5 ? -1 : 1
    }
    if (this.wobbleTime > 0) yawErr += this.wobbleDir * 0.12

    // Speed control from the tightest curvature we are about to meet.
    const kappa = path.maxCurvature(c.s + 3, 12 + Math.abs(pose.speed) * 0.9)
    const yawCap = pose.turnRate * (pose.drifting ? 1.15 : 0.9)
    const safe = kappa > 1e-4 ? (yawCap / kappa) * (0.9 + sk.bravery * 0.25) : Infinity
    const targetSpeed = Math.min(pose.maxSpeed, Math.max(12, safe))
    this.debug.targetSpeed = targetSpeed

    let throttle = 1
    let brake = 0
    if (pose.speed > targetSpeed + 2.5) {
      throttle = 0
      brake = THREE.MathUtils.clamp((pose.speed - targetSpeed) / 8, 0, 1) * (0.5 + sk.skill * 0.5)
    } else if (pose.speed > targetSpeed) throttle = 0.4

    // Drift through long corners.
    let drift = false
    const longTurn = path.headingChange(c.s + 4, 30)
    const wants = Math.abs(longTurn) > 0.6 - sk.skill * 0.2 && pose.speed > 15 && pose.grounded
    if (pose.drifting) {
      this.driftHold += dt
      const stillTurning = Math.abs(path.headingChange(c.s + 2, 18)) > 0.12 && Math.sign(longTurn) === -pose.driftDir
      drift = stillTurning || this.driftHold < 0.5
      if (Math.abs(yawErr) > 0.75) drift = false
      // Sliding wide toward the outside barrier: straighten up instead of holding the drift.
      if (Math.abs(c.lateral) > half - 1.2 && Math.sign(c.lateral) !== Math.sign(lateral || 1) && this.driftHold > 0.35) drift = false
    } else {
      this.driftHold = 0
      // Positive heading change = left turn = steer negative.
      if (wants && this.random() < (0.6 + sk.skill) * dt * 6) drift = true
    }

    let steer: number
    if (pose.drifting && drift) {
      // In a drift, steer blends between wide and tight lines around the drift direction.
      const need = -yawErr * 2.6 * pose.driftDir
      steer = THREE.MathUtils.clamp(need, -1, 1) * pose.driftDir
      steer = THREE.MathUtils.clamp(pose.driftDir * 0.15 + steer, -1, 1)
    } else {
      steer = THREE.MathUtils.clamp(-yawErr * (2.2 + sk.skill), -1, 1)
      if (drift) steer = -Math.sign(longTurn) || steer
    }
    if (Math.abs(yawErr) > 1.2 && pose.speed > 10) {
      throttle = 0.3
      brake = 0.4
    }
    return { throttle, brake, steer, drift }
  }
}
