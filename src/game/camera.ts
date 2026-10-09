import * as THREE from 'three'
import { CONFIG } from './config'

/**
 * Chase camera tuned for arcade racing: yaw lags behind the kart so drifts read from the side,
 * FOV widens with speed and boosts, trauma-based shake for hits and landings, a look-back mode,
 * and scripted orbits for the pre-race flyover and the finish.
 */
export type CamMode = 'chase' | 'cockpit' | 'orbit' | 'flyby'

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera
  mode: CamMode = 'chase'
  trauma = 0
  reducedMotion = false
  lookBack = false
  private yaw = 0
  private pos = new THREE.Vector3()
  private look = new THREE.Vector3()
  private fov: number = CONFIG.camera.fov
  private time = 0
  private orbitAngle = 0
  private initialised = false
  private kick = 0

  constructor() {
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, innerWidth / innerHeight, 0.3, 1400)
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount * (this.reducedMotion ? 0.35 : 1))
  }

  /** Short forward punch of the FOV (boost start). */
  punch(amount: number): void {
    this.kick = Math.max(this.kick, amount)
  }

  snap(): void {
    this.initialised = false
  }

  /**
   * @param target kart render position
   * @param kartYaw kart heading
   * @param velYaw direction of travel
   * @param speed forward speed m/s
   * @param boosting boost active
   * @param groundY track height under the camera
   */
  update(dt: number, target: THREE.Vector3, kartYaw: number, velYaw: number, speed: number, boosting: boolean, airborne: boolean, groundY: number): void {
    this.time += dt
    const C = CONFIG.camera
    if (this.mode === 'orbit' || this.mode === 'flyby') {
      this.orbitAngle += dt * (this.mode === 'flyby' ? 0.32 : 0.22)
      const r = this.mode === 'flyby' ? 11 - Math.min(4, this.time * 0.6) : 8.5
      const h = this.mode === 'flyby' ? 3.2 + Math.max(0, 4 - this.time) : 3.2
      const desired = new THREE.Vector3(target.x + Math.sin(kartYaw + this.orbitAngle) * r, target.y + h, target.z + Math.cos(kartYaw + this.orbitAngle) * r)
      this.pos.lerp(desired, 1 - Math.exp(-3 * dt))
      if (!this.initialised) this.pos.copy(desired)
      this.look.lerp(target.clone().setY(target.y + 1), 1 - Math.exp(-6 * dt))
      if (!this.initialised) this.look.copy(target)
      this.initialised = true
      this.yaw = kartYaw
      this.apply(dt, C.fov)
      return
    }

    if (this.mode === 'cockpit') {
      const forward = new THREE.Vector3(Math.sin(kartYaw), 0, Math.cos(kartYaw))
      const desired = target.clone().addScaledVector(forward, 0.62).setY(target.y + 1.22)
      const lookTarget = target.clone().addScaledVector(forward, 8).setY(target.y + 1.15)
      if (!this.initialised) { this.pos.copy(desired); this.look.copy(lookTarget) }
      this.pos.lerp(desired, 1 - Math.exp(-16 * dt))
      this.look.lerp(lookTarget, 1 - Math.exp(-14 * dt))
      this.initialised = true
      this.apply(dt, C.fov + (boosting ? 8 : 0))
      return
    }

    // Blend heading between kart facing and velocity so drifts swing the view outward a little.
    const speedK = THREE.MathUtils.clamp(Math.abs(speed) / 25, 0, 1)
    let wanted = kartYaw + wrap(velYaw - kartYaw) * 0.45 * speedK
    if (speed < -1) wanted = kartYaw
    if (this.lookBack) wanted += Math.PI
    if (!this.initialised) this.yaw = wanted
    this.yaw += wrap(wanted - this.yaw) * (1 - Math.exp(-(this.lookBack ? 20 : 5.2) * dt))
    const dist = C.distance + speedK * 1.1 + (boosting ? 0.8 : 0)
    const height = C.height + speedK * 0.35 + (airborne ? 0.4 : 0)
    const desired = new THREE.Vector3(target.x - Math.sin(this.yaw) * dist, target.y + height, target.z - Math.cos(this.yaw) * dist)
    desired.y = Math.max(desired.y, groundY + 1.4)
    if (!this.initialised) this.pos.copy(desired)
    const k = 1 - Math.exp(-C.follow * dt)
    this.pos.x += (desired.x - this.pos.x) * Math.min(1, k * 1.6)
    this.pos.z += (desired.z - this.pos.z) * Math.min(1, k * 1.6)
    this.pos.y += (desired.y - this.pos.y) * (1 - Math.exp(-(airborne ? 4 : 7) * dt))
    const lookTarget = new THREE.Vector3(target.x + Math.sin(this.yaw) * C.lookAhead, target.y + 1.25, target.z + Math.cos(this.yaw) * C.lookAhead)
    if (!this.initialised) this.look.copy(lookTarget)
    this.look.lerp(lookTarget, 1 - Math.exp(-14 * dt))
    this.initialised = true
    const fovTarget = C.fov + speedK * 8 + (boosting ? C.boostFov - C.fov - 6 : 0) + this.kick * 10
    this.apply(dt, fovTarget)
  }

  private apply(dt: number, fovTarget: number): void {
    this.kick = Math.max(0, this.kick - dt * 3)
    this.fov += (fovTarget - this.fov) * (1 - Math.exp(-5 * dt))
    this.camera.fov = this.fov
    this.camera.updateProjectionMatrix()
    this.camera.position.copy(this.pos)
    this.camera.lookAt(this.look)
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma
      const t = this.time * 38
      this.camera.position.x += (noise(t) - 0.5) * 0.9 * s
      this.camera.position.y += (noise(t + 17) - 0.5) * 0.7 * s
      this.camera.rotation.z += (noise(t + 41) - 0.5) * 0.1 * s
      this.trauma = Math.max(0, this.trauma - dt * 1.6)
    }
  }

  /** Scripted look for menus: slow crane over a point of interest. */
  showcase(dt: number, center: THREE.Vector3, radius: number, height: number, speed = 0.06): void {
    this.time += dt
    this.orbitAngle += dt * speed
    const desired = new THREE.Vector3(center.x + Math.sin(this.orbitAngle) * radius, center.y + height, center.z + Math.cos(this.orbitAngle) * radius)
    if (!this.initialised) this.pos.copy(desired)
    this.pos.lerp(desired, 1 - Math.exp(-1.5 * dt))
    if (!this.initialised) this.look.copy(center)
    this.look.lerp(center, 1 - Math.exp(-2 * dt))
    this.initialised = true
    this.apply(dt, 55)
  }

  resetTime(): void {
    this.time = 0
  }
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

function noise(t: number): number {
  const i = Math.floor(t)
  const f = t - i
  const h = (n: number) => {
    const x = Math.sin(n * 127.1) * 43758.5453
    return x - Math.floor(x)
  }
  const u = f * f * (3 - 2 * f)
  return h(i) * (1 - u) + h(i + 1) * u
}
