import * as THREE from 'three'
import { ParticlePool } from '../engine/particles'
import { SkidMarks } from '../engine/trail'

/** Drift tier colours: sky blue → candy pink → golden rainbow. */
export const TIER_COLORS = ['#fff4d6', '#62d8ff', '#bd3b49', '#ffd23f']

const C = (hex: string) => new THREE.Color(hex)
const tmp = new THREE.Vector3()
const tmpV = new THREE.Vector3()

export class Fx {
  readonly glow: ParticlePool
  readonly puffs: ParticlePool
  readonly bits: ParticlePool
  readonly skids = new SkidMarks(900)
  private readonly ambient: ParticlePool
  private ambientTimer = 0
  private scale = 1

  constructor(scene: THREE.Scene) {
    this.glow = new ParticlePool(new THREE.OctahedronGeometry(0.5, 0), 900, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
    this.puffs = new ParticlePool(new THREE.IcosahedronGeometry(0.5, 0), 500, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.85, depthWrite: false, flatShading: true, roughness: 1 }))
    this.bits = new ParticlePool(new THREE.BoxGeometry(0.5, 0.12, 0.3), 500, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.5 }))
    this.ambient = new ParticlePool(new THREE.OctahedronGeometry(0.5, 0), 160, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
    scene.add(this.glow.mesh, this.puffs.mesh, this.bits.mesh, this.ambient.mesh, this.skids.mesh)
  }

  /** Quality scaling for particle counts (0.4 on low). */
  setDensity(scale: number): void {
    this.scale = scale
  }

  private n(count: number): number {
    const v = count * this.scale
    return Math.floor(v) + (Math.random() < v % 1 ? 1 : 0)
  }

  sparks(at: THREE.Vector3, side: THREE.Vector3, tier: number, intensity = 1): void {
    const color = C(TIER_COLORS[Math.min(3, tier)])
    for (let i = 0; i < this.n(2 * intensity); i += 1) {
      tmpV.set(side.x * (2 + Math.random() * 3) + (Math.random() - 0.5) * 2, 2 + Math.random() * 3.5, side.z * (2 + Math.random() * 3) + (Math.random() - 0.5) * 2)
      this.glow.spawn({ pos: at, vel: tmpV, life: 0.25 + Math.random() * 0.25, size: tier >= 3 ? 0.3 : 0.22, endSize: 0.1, color: tier >= 3 && Math.random() < 0.4 ? C(['#7ef9ff', '#a33a45', '#b2ff7a'][i % 3]) : color, gravity: -18, drag: 2 })
    }
  }

  dust(at: THREE.Vector3, color = '#fff0f6', count = 1, spread = 1): void {
    for (let i = 0; i < this.n(count); i += 1) {
      tmpV.set((Math.random() - 0.5) * 2 * spread, 0.6 + Math.random() * 1.5, (Math.random() - 0.5) * 2 * spread)
      this.puffs.spawn({ pos: tmp.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4)), vel: tmpV, life: 0.5 + Math.random() * 0.5, size: 0.45 + Math.random() * 0.35, endSize: 2.2, color: C(color), gravity: 0.5, drag: 2.5 })
    }
  }

  flame(at: THREE.Vector3, back: THREE.Vector3, hot = false): void {
    for (let i = 0; i < this.n(2); i += 1) {
      tmpV.copy(back).multiplyScalar(4 + Math.random() * 4).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.8 + Math.random(), (Math.random() - 0.5) * 1.2))
      const c = hot ? C(Math.random() < 0.5 ? '#ff3b2f' : '#ffb13b') : C(Math.random() < 0.5 ? '#ffd84d' : '#ff8a3d')
      this.glow.spawn({ pos: at, vel: tmpV, life: 0.18 + Math.random() * 0.14, size: 0.42, endSize: 0.1, color: c, gravity: 2, drag: 3 })
    }
  }

  /** Burst of sugar confetti (crate break, finish). */
  confetti(at: THREE.Vector3, count = 26, power = 1, palette = ['#a93240', '#7fe0ff', '#ffe066', '#b58cff', '#6ff0b0', '#ffffff']): void {
    for (let i = 0; i < this.n(count); i += 1) {
      tmpV.set((Math.random() - 0.5) * 12 * power, (3 + Math.random() * 7) * power, (Math.random() - 0.5) * 12 * power)
      this.bits.spawn({ pos: at, vel: tmpV, life: 0.9 + Math.random() * 0.8, size: 0.6 + Math.random() * 0.4, endSize: 0.2, color: C(palette[i % palette.length]), gravity: -16, drag: 1.4, spin: 10 })
    }
  }

  ring(at: THREE.Vector3, color: string, count = 18, speed = 9, y = 0.5): void {
    for (let i = 0; i < this.n(count); i += 1) {
      const a = (i / count) * Math.PI * 2
      tmpV.set(Math.cos(a) * speed, y + Math.random(), Math.sin(a) * speed)
      this.glow.spawn({ pos: at, vel: tmpV, life: 0.4 + Math.random() * 0.2, size: 0.34, endSize: 0.05, color: C(color), gravity: -3, drag: 3 })
    }
  }

  pollen(at: THREE.Vector3): void {
    this.ring(at, '#ffe066', 22, 10, 2)
    for (let i = 0; i < this.n(10); i += 1) this.dust(at, i % 2 ? '#ffe98a' : '#fff6c2', 1, 1.8)
  }

  goo(at: THREE.Vector3, colors = ['#7ef0c0', '#a33a45']): void {
    for (let i = 0; i < this.n(14); i += 1) {
      tmpV.set((Math.random() - 0.5) * 8, 2 + Math.random() * 5, (Math.random() - 0.5) * 8)
      this.puffs.spawn({ pos: at, vel: tmpV, life: 0.6 + Math.random() * 0.4, size: 0.5, endSize: 0.3, color: C(colors[i % 2]), gravity: -20, drag: 1 })
    }
  }

  bubblePop(at: THREE.Vector3): void {
    this.ring(at, '#9ff4ff', 24, 8, 1)
    this.ring(at, '#ffb0e8', 16, 6, 3)
  }

  landing(at: THREE.Vector3, impact: number): void {
    const n = Math.min(14, Math.floor(impact))
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2
      this.puffs.spawn({ pos: at, vel: tmpV.set(Math.cos(a) * 5, 0.6, Math.sin(a) * 5), life: 0.55, size: 0.5, endSize: 2, color: C('#fff0f6'), gravity: 0, drag: 3 })
    }
  }

  wallHit(at: THREE.Vector3, normal: THREE.Vector3): void {
    for (let i = 0; i < this.n(10); i += 1) {
      tmpV.copy(normal).multiplyScalar(4 + Math.random() * 4).add(new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4))
      this.glow.spawn({ pos: at, vel: tmpV, life: 0.3, size: 0.26, endSize: 0.05, color: C(i % 2 ? '#ffffff' : '#ffe066'), gravity: -20, drag: 1.5 })
    }
  }

  /** Floating sugar sparkles near the camera for atmosphere. */
  updateAmbient(dt: number, focus: THREE.Vector3): void {
    this.ambientTimer += dt * this.scale
    while (this.ambientTimer > 0.06) {
      this.ambientTimer -= 0.06
      const p = new THREE.Vector3(focus.x + (Math.random() - 0.5) * 70, focus.y + Math.random() * 14, focus.z + (Math.random() - 0.5) * 70)
      this.ambient.spawn({ pos: p, vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6), life: 3 + Math.random() * 2, size: 0.12 + Math.random() * 0.1, endSize: 0, color: C(['#ffffff', '#ffe3f1', '#fff4b8', '#d4f7ff'][Math.floor(Math.random() * 4)]), drag: 0.2, spin: 1 })
    }
  }

  update(dt: number): void {
    this.glow.update(dt)
    this.puffs.update(dt)
    this.bits.update(dt)
    this.ambient.update(dt)
  }

  clear(): void {
    this.glow.clear()
    this.puffs.clear()
    this.bits.clear()
    this.skids.clear()
  }
}
