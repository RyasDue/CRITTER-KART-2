import * as THREE from 'three'

/**
 * Pooled particles on one InstancedMesh (one draw call per pool). Each particle has its own
 * colour, size curve, gravity and drag; gameplay spawns them through small preset helpers.
 */
export type ParticleSpec = {
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  size: number
  /** Size multiplier at end of life (1 = constant, 0 = shrink out). */
  endSize?: number
  color: THREE.Color
  gravity?: number
  drag?: number
  spin?: number
}

type Particle = {
  age: number
  life: number
  pos: THREE.Vector3
  vel: THREE.Vector3
  size: number
  endSize: number
  color: THREE.Color
  gravity: number
  drag: number
  spin: number
  rot: number
}

export class ParticlePool {
  readonly mesh: THREE.InstancedMesh
  private readonly items: Particle[] = []
  private readonly free: Particle[] = []
  private readonly dummy = new THREE.Object3D()

  constructor(geometry: THREE.BufferGeometry, private readonly max = 600, material?: THREE.Material) {
    const mat = material ?? new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false })
    this.mesh = new THREE.InstancedMesh(geometry, mat, max)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.setColorAt(0, new THREE.Color())
  }

  get count(): number {
    return this.items.length
  }

  spawn(p: ParticleSpec): void {
    if (this.items.length >= this.max) {
      const old = this.items.shift()
      if (old) this.free.push(old)
    }
    const q = this.free.pop() ?? { age: 0, life: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 1, endSize: 0, color: new THREE.Color(), gravity: 0, drag: 0, spin: 0, rot: 0 }
    q.age = 0
    q.life = p.life
    q.pos.copy(p.pos)
    q.vel.copy(p.vel)
    q.size = p.size
    q.endSize = p.endSize ?? 0
    q.color.copy(p.color)
    q.gravity = p.gravity ?? 0
    q.drag = p.drag ?? 1.5
    q.spin = p.spin ?? 4
    q.rot = Math.random() * Math.PI
    this.items.push(q)
  }

  update(dt: number): void {
    let w = 0
    for (let i = 0; i < this.items.length; i += 1) {
      const p = this.items[i]
      p.age += dt
      if (p.age >= p.life) {
        this.free.push(p)
        continue
      }
      p.vel.y += p.gravity * dt
      p.vel.multiplyScalar(Math.exp(-p.drag * dt))
      p.pos.addScaledVector(p.vel, dt)
      p.rot += p.spin * dt
      const k = p.age / p.life
      const s = p.size * (1 + (p.endSize - 1) * k)
      this.dummy.position.copy(p.pos)
      this.dummy.rotation.set(p.rot, p.rot * 0.7, 0)
      this.dummy.scale.setScalar(Math.max(0.0001, s))
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(w, this.dummy.matrix)
      this.mesh.setColorAt(w, p.color)
      this.items[w] = p
      w += 1
    }
    this.items.length = w
    this.mesh.count = w
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  clear(): void {
    this.free.push(...this.items)
    this.items.length = 0
    this.mesh.count = 0
  }
}
