import * as THREE from 'three'
import { COLLISION, groups } from '../engine/kart'
import { RAPIER, type Physics } from '../engine/physics'
import { Trail } from '../engine/trail'
import { CONFIG, type ItemKind } from './config'
import type { Fx } from './fx'
import { Parts } from './kartModel'
import type { Racer } from './racer'
import { rollItem } from './rules'
import type { Track } from './track'

/**
 * Items: Candy Crates on the track (break into Rapier-simulated shards), and the four original
 * items — Bubble Shield, Pepper Blast, Taffy Trap (dropped behind), Homing Bee (chases the racer
 * directly ahead). Effects are reported through `ItemHooks` so audio/UI stay decoupled.
 */
export type ItemHooks = {
  sfx(name: string, at: THREE.Vector3, gain?: number): void
  hit(victim: Racer, by: Racer | null, kind: 'bee' | 'taffy'): void
  blocked(victim: Racer): void
  got(racer: Racer): void
}

type Crate = { mesh: THREE.Group; pos: THREE.Vector3; respawn: number; spin: number }
type Shard = { mesh: THREE.Mesh; body: RAPIER.RigidBody; life: number }
type Trap = { mesh: THREE.Group; body: RAPIER.RigidBody; owner: Racer; life: number; armed: number; wobble: number }
type Bee = { mesh: THREE.Group; owner: Racer; target: Racer | null; s: number; lateral: number; pos: THREE.Vector3; life: number; trail: Trail; wing: THREE.Object3D[]; path: 'main' }

const crateGeo = (() => {
  const p = new Parts()
  p.add(new THREE.BoxGeometry(1.5, 1.5, 1.5), '#ffffff')
  // Ribbon bands (tinted by instance colour through the material below).
  p.add(new THREE.BoxGeometry(1.56, 1.56, 0.34), '#fff3a8')
  p.add(new THREE.BoxGeometry(0.34, 1.56, 1.56), '#fff3a8')
  const g = p.mesh().geometry
  return g
})()

function bowGeometry(): THREE.BufferGeometry {
  const p = new Parts()
  p.add(new THREE.TorusGeometry(0.28, 0.1, 5, 8), '#ffe066', [0.26, 0.95, 0], [0, Math.PI / 2, 0.5])
  p.add(new THREE.TorusGeometry(0.28, 0.1, 5, 8), '#ffe066', [-0.26, 0.95, 0], [0, Math.PI / 2, -0.5])
  p.add(new THREE.IcosahedronGeometry(0.14, 0), '#ffd23f', [0, 0.86, 0])
  // Paw print on each side face (no text or symbols).
  for (const [rx, ry] of [[0, 0], [0, Math.PI / 2], [0, Math.PI], [0, -Math.PI / 2]]) {
    const q = new THREE.Euler(rx, ry, 0)
    const place = (x: number, y: number, r: number) => {
      const v = new THREE.Vector3(x, y, 0.79).applyEuler(q)
      p.add(new THREE.CylinderGeometry(r, r, 0.04, 8), '#ffffff', [v.x, v.y, v.z], [Math.PI / 2, ry, 0])
    }
    place(0.38, -0.36, 0.17)
    place(0.2, -0.1, 0.07)
    place(0.38, -0.02, 0.07)
    place(0.56, -0.1, 0.07)
  }
  return p.mesh().geometry
}

export class Items {
  readonly crates: Crate[] = []
  readonly traps: Trap[] = []
  readonly bees: Bee[] = []
  private readonly shards: Shard[] = []
  private readonly group = new THREE.Group()
  private readonly crateMats: THREE.MeshStandardMaterial[] = []
  private readonly shardGeo = new THREE.BoxGeometry(0.55, 0.55, 0.12)
  private readonly shardMats = ['#ff7ab6', '#7fe0ff', '#ffe066', '#b58cff'].map(c => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.4, emissive: c, emissiveIntensity: 0.25 }))
  private readonly bowGeo = bowGeometry()
  private time = 0

  constructor(scene: THREE.Scene, private readonly physics: Physics, private readonly track: Track, private readonly fx: Fx, private readonly hooks: ItemHooks) {
    scene.add(this.group)
    const colors = ['#ff7ab6', '#7fd9ff', '#b58cff', '#ffb347']
    track.itemSpots.forEach((spot, i) => {
      const mat = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], vertexColors: true, flatShading: true, roughness: 0.25, metalness: 0.05, emissive: colors[i % colors.length], emissiveIntensity: 0.28, transparent: true, opacity: 0.94 })
      this.crateMats.push(mat)
      const g = new THREE.Group()
      const body = new THREE.Mesh(crateGeo, mat)
      body.castShadow = true
      const bow = new THREE.Mesh(this.bowGeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.3 }))
      g.add(body, bow)
      g.position.copy(spot.pos)
      this.group.add(g)
      this.crates.push({ mesh: g, pos: spot.pos.clone(), respawn: 0, spin: i * 0.7 })
    })
  }

  reset(): void {
    for (const c of this.crates) {
      c.respawn = 0
      c.mesh.visible = true
      c.mesh.scale.setScalar(1)
    }
    for (const t of this.traps) this.removeTrap(t)
    this.traps.length = 0
    for (const b of this.bees) this.group.remove(b.mesh, b.trail.mesh)
    this.bees.length = 0
    for (const s of this.shards) this.removeShard(s)
    this.shards.length = 0
  }

  /** Fixed-step simulation of crates, traps, bees and shards. */
  step(dt: number, racers: Racer[], ordered: Racer[]): void {
    this.time += dt
    // Crates.
    for (const c of this.crates) {
      if (c.respawn > 0) {
        c.respawn -= dt
        if (c.respawn <= 0) {
          c.mesh.visible = true
          c.mesh.scale.setScalar(0.01)
        }
        continue
      }
      for (const r of racers) {
        if (r.respawnTime > 0) continue
        const d = r.position.distanceToSquared(c.pos)
        if (d < 2.3 * 2.3) {
          this.breakCrate(c, r)
          if (!r.item && r.roulette <= 0) {
            r.roulette = CONFIG.items.roulette
            r.rouletteItem = rollItem(r.place - 1, racers.length, Math.random)
            this.hooks.got(r)
          }
          break
        }
      }
    }
    // Roulettes.
    for (const r of racers) {
      if (r.roulette > 0) {
        r.roulette -= dt
        if (r.roulette <= 0) {
          r.item = r.rouletteItem
          r.rouletteItem = null
          r.aiItemDelay = 0.6 + Math.random() * 2.2
        }
      }
      r.shieldTime = Math.max(0, r.shieldTime - dt)
      r.goo = Math.max(0, r.goo - dt)
      r.incomingBee = 0
    }
    // Traps.
    for (let i = this.traps.length - 1; i >= 0; i -= 1) {
      const t = this.traps[i]
      t.life -= dt
      t.armed -= dt
      t.wobble = Math.max(0, t.wobble - dt)
      const tp = t.body.translation()
      if (t.life <= 0 || tp.y < -30) {
        this.removeTrap(t)
        this.traps.splice(i, 1)
        continue
      }
      for (const r of racers) {
        if (r.respawnTime > 0 || (r === t.owner && t.armed > 0)) continue
        const dx = r.position.x - tp.x
        const dy = r.position.y - tp.y
        const dz = r.position.z - tp.z
        if (dx * dx + dz * dz < 1.75 * 1.75 && Math.abs(dy) < 2) {
          const at = new THREE.Vector3(tp.x, tp.y, tp.z)
          this.fx.goo(at)
          this.hooks.sfx('taffyHit', at)
          if (r.shielded) {
            r.shieldTime = 0
            this.fx.bubblePop(r.position)
            this.hooks.blocked(r)
          } else {
            r.kart.stick(CONFIG.items.trapStick)
            r.kart.spinOut(0.55, 0.6)
            r.goo = CONFIG.items.trapStick
            r.kart.impulse(new THREE.Vector3(0, 5.5, 0))
            r.bounce(1.2)
            this.hooks.hit(r, t.owner === r ? null : t.owner, 'taffy')
          }
          this.removeTrap(t)
          this.traps.splice(i, 1)
          break
        }
      }
    }
    // Bees.
    for (let i = this.bees.length - 1; i >= 0; i -= 1) {
      const b = this.bees[i]
      b.life -= dt
      if (b.target && b.target.finished) b.target = null
      let hit = false
      if (b.life <= 0) {
        this.fx.ring(b.pos, '#ffe066', 10, 4)
        this.removeBee(b)
        this.bees.splice(i, 1)
        continue
      }
      const target = b.target
      const speed = CONFIG.items.beeSpeed
      if (target) target.incomingBee = Math.max(target.incomingBee, 1)
      const dist = target ? b.pos.distanceTo(target.position) : Infinity
      if (target && dist < CONFIG.items.beeHoming) {
        // Final dive straight at the target.
        const dir = target.position.clone().add(new THREE.Vector3(0, 0.6, 0)).sub(b.pos)
        const len = dir.length()
        b.pos.addScaledVector(dir.normalize(), Math.min(len, speed * 1.1 * dt))
        b.s = target.tracker.loc.path === 'main' ? target.tracker.loc.s : b.s
        if (len < 1.8) hit = true
      } else {
        // Follow the racing line toward the target's lateral position.
        b.s = this.track.main.wrap(b.s + speed * dt)
        const lat = target ? (target.tracker.loc.path === 'main' ? target.tracker.loc.lateral : 0) : 0
        b.lateral += (lat - b.lateral) * (1 - Math.exp(-2 * dt))
        const p = this.track.main.pointAt(b.s, b.lateral)
        p.y += 1.6 + Math.sin(this.time * 9 + i) * 0.3
        b.pos.lerp(p, 1 - Math.exp(-12 * dt))
      }
      if (hit && target) {
        this.fx.pollen(target.position)
        this.hooks.sfx('beeHit', target.position)
        if (target.shielded) {
          target.shieldTime = 0
          this.fx.bubblePop(target.position)
          this.hooks.blocked(target)
        } else {
          target.kart.spinOut(CONFIG.items.beeSpin, 0.3)
          const side = new THREE.Vector3((Math.random() - 0.5) * 6, 7.5, (Math.random() - 0.5) * 6)
          target.kart.impulse(side)
          target.bounce(1.6)
          this.hooks.hit(target, b.owner, 'bee')
        }
        this.removeBee(b)
        this.bees.splice(i, 1)
      }
    }
    // Shards.
    for (let i = this.shards.length - 1; i >= 0; i -= 1) {
      const s = this.shards[i]
      s.life -= dt
      if (s.life <= 0) {
        this.removeShard(s)
        this.shards.splice(i, 1)
      }
    }
    void ordered
  }

  /** Render-rate animation (spinning crates, wings, shard sync). */
  animate(dt: number, time: number): void {
    for (const c of this.crates) {
      if (!c.mesh.visible) continue
      c.mesh.rotation.y = time * 1.4 + c.spin
      c.mesh.rotation.x = Math.sin(time * 1.3 + c.spin) * 0.18
      c.mesh.position.y = c.pos.y + Math.sin(time * 2.2 + c.spin) * 0.22
      const s = c.mesh.scale.x
      if (s < 1) c.mesh.scale.setScalar(Math.min(1, s + dt * 4 * (1.2 - s)))
    }
    this.crateMats.forEach((m, i) => (m.emissiveIntensity = 0.22 + Math.sin(time * 4 + i) * 0.1))
    for (const s of this.shards) {
      const t = s.body.translation()
      const r = s.body.rotation()
      s.mesh.position.set(t.x, t.y, t.z)
      s.mesh.quaternion.set(r.x, r.y, r.z, r.w)
      if (s.life < 0.5) s.mesh.scale.setScalar(Math.max(0.01, s.life / 0.5))
    }
    for (const t of this.traps) {
      const p = t.body.translation()
      const r = t.body.rotation()
      t.mesh.position.set(p.x, p.y - 0.25, p.z)
      t.mesh.quaternion.set(r.x, r.y, r.z, r.w)
      const w = 1 + Math.sin(time * 5 + p.x) * 0.05
      t.mesh.scale.set(w, 1 / w, w)
    }
    for (const b of this.bees) {
      b.mesh.position.copy(b.pos)
      const ahead = b.target ? b.target.position : this.track.main.pointAt(b.s + 5)
      b.mesh.lookAt(ahead.x, b.pos.y, ahead.z)
      for (const [k, w] of b.wing.entries()) w.rotation.z = (k ? -1 : 1) * (0.5 + Math.sin(time * 70) * 0.5)
      b.trail.update(b.pos, new THREE.Vector3(0, 1, 0), true)
      if (Math.random() < 0.5) this.fx.glow.spawn({ pos: b.pos, vel: new THREE.Vector3((Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2), life: 0.35, size: 0.18, endSize: 0, color: new THREE.Color('#ffe066'), drag: 2 })
    }
  }

  // ─── item use ────────────────────────────────────────────────────

  use(r: Racer, ordered: Racer[]): ItemKind | null {
    const kind = r.item
    if (!kind) return null
    r.item = null
    const k = r.kart
    const fwd = k.forward.clone()
    switch (kind) {
      case 'shield':
        r.shieldTime = CONFIG.items.shieldSeconds
        this.fx.ring(r.position, '#9ff4ff', 18, 6, 1)
        this.hooks.sfx('shieldUp', r.position)
        break
      case 'pepper':
        k.boost(CONFIG.items.pepperSeconds, CONFIG.items.pepperPower)
        k.cancelDrift()
        this.fx.ring(r.position.clone().addScaledVector(fwd, -1.5), '#ff5a36', 16, 7, 0.5)
        this.hooks.sfx('pepper', r.position)
        break
      case 'taffy':
        this.dropTrap(r)
        this.hooks.sfx('taffyDrop', r.position)
        break
      case 'bee': {
        const idx = ordered.indexOf(r)
        const target = idx > 0 ? ordered[idx - 1] : null
        this.launchBee(r, target)
        this.hooks.sfx('beeLaunch', r.position)
        break
      }
    }
    return kind
  }

  /** Bee that is chasing `r`, if any (for UI warnings / AI shield timing). */
  beeFor(r: Racer): Bee | undefined {
    return this.bees.find(b => b.target === r)
  }

  obstacles(): { position: THREE.Vector3; radius: number; hazard: boolean }[] {
    return this.traps.map(t => {
      const p = t.body.translation()
      return { position: new THREE.Vector3(p.x, p.y, p.z), radius: 1.3, hazard: true }
    })
  }

  private breakCrate(c: Crate, r: Racer): void {
    c.mesh.visible = false
    c.respawn = CONFIG.items.boxRespawn
    this.fx.confetti(c.pos, 22, 0.9)
    this.fx.ring(c.pos, '#ffffff', 12, 7, 0.5)
    this.hooks.sfx('crate', c.pos)
    const vel = r.kart.velocity
    for (let i = 0; i < 7; i += 1) {
      const mesh = new THREE.Mesh(this.shardGeo, this.shardMats[i % this.shardMats.length])
      mesh.position.copy(c.pos).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2))
      mesh.castShadow = true
      this.group.add(mesh)
      const body = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
          .setLinvel(vel.x * 0.7 + (Math.random() - 0.5) * 9, 4 + Math.random() * 6, vel.z * 0.7 + (Math.random() - 0.5) * 9)
          .setAngvel({ x: (Math.random() - 0.5) * 20, y: (Math.random() - 0.5) * 20, z: (Math.random() - 0.5) * 20 })
          .setLinearDamping(0.3),
      )
      this.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.27, 0.27, 0.06).setRestitution(0.45).setFriction(0.6).setDensity(0.6).setCollisionGroups(groups(COLLISION.DEBRIS, COLLISION.GROUND | COLLISION.WALL)),
        body,
      )
      this.shards.push({ mesh, body, life: 1.8 + Math.random() * 0.6 })
    }
  }

  private dropTrap(r: Racer): void {
    const k = r.kart
    const fwd = k.forward
    const at = k.position.clone().addScaledVector(fwd, -2.6)
    at.y += 0.5
    const g = new THREE.Group()
    const p = new Parts()
    p.add(new THREE.IcosahedronGeometry(1, 1), '#7ef0c0', [0, 0.35, 0], [0, 0, 0], [1.25, 0.5, 1.25])
    p.add(new THREE.IcosahedronGeometry(0.6, 1), '#a33a45', [0.25, 0.62, 0.1], [0, 0, 0], [1, 0.6, 1])
    p.add(new THREE.IcosahedronGeometry(0.35, 0), '#fff6fb', [-0.3, 0.75, -0.2])
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2
      p.add(new THREE.IcosahedronGeometry(0.28, 0), i % 2 ? '#7ef0c0' : '#a33a45', [Math.cos(a) * 1.2, 0.12, Math.sin(a) * 1.2], [0, 0, 0], [1.2, 0.4, 1.2])
    }
    const mesh = p.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.18, metalness: 0.05, emissive: '#3a1030', emissiveIntensity: 0.15 }))
    g.add(mesh)
    this.group.add(g)
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(at.x, at.y, at.z)
        .setLinvel(k.velocity.x * 0.25 - fwd.x * 2, 2.5, k.velocity.z * 0.25 - fwd.z * 2)
        .setLinearDamping(1.8)
        .setAngularDamping(4)
        .enabledRotations(false, true, false),
    )
    this.physics.world.createCollider(RAPIER.ColliderDesc.ball(0.5).setRestitution(0.2).setFriction(1).setCollisionGroups(groups(COLLISION.DEBRIS, COLLISION.GROUND | COLLISION.WALL)), body)
    this.traps.push({ mesh: g, body, owner: r, life: CONFIG.items.trapLife, armed: 0.8, wobble: 0 })
    if (this.traps.length > CONFIG.items.maxTraps) {
      const old = this.traps.shift()!
      this.removeTrap(old)
    }
  }

  private launchBee(r: Racer, target: Racer | null): void {
    const g = new THREE.Group()
    const p = new Parts()
    p.add(new THREE.IcosahedronGeometry(0.42, 1), '#ffd23f', [0, 0, 0], [0, 0, 0], [0.9, 0.9, 1.25])
    p.add(new THREE.CylinderGeometry(0.4, 0.4, 0.14, 10), '#2b1a2e', [0, 0, -0.08], [Math.PI / 2, 0, 0])
    p.add(new THREE.CylinderGeometry(0.33, 0.33, 0.12, 10), '#2b1a2e', [0, 0, -0.34], [Math.PI / 2, 0, 0])
    p.add(new THREE.IcosahedronGeometry(0.3, 1), '#2b1a2e', [0, 0.05, 0.5])
    p.add(new THREE.IcosahedronGeometry(0.08, 0), '#ffffff', [0.12, 0.12, 0.74])
    p.add(new THREE.IcosahedronGeometry(0.08, 0), '#ffffff', [-0.12, 0.12, 0.74])
    p.add(new THREE.ConeGeometry(0.08, 0.25, 5), '#2b1a2e', [0, 0, -0.62], [-Math.PI / 2, 0, 0])
    g.add(p.mesh())
    const wingMat = new THREE.MeshBasicMaterial({ color: '#e8fbff', transparent: true, opacity: 0.75, side: THREE.DoubleSide })
    const wing: THREE.Object3D[] = []
    for (const s of [1, -1]) {
      const pivot = new THREE.Group()
      pivot.position.set(s * 0.15, 0.32, 0)
      const w = new THREE.Mesh(new THREE.CircleGeometry(0.34, 8), wingMat)
      w.position.set(s * 0.3, 0.05, 0)
      w.rotation.x = -Math.PI / 2
      w.scale.set(1, 0.6, 1)
      pivot.add(w)
      g.add(pivot)
      wing.push(pivot)
    }
    g.scale.setScalar(1.35)
    const pos = r.position.clone().add(new THREE.Vector3(0, 1.6, 0))
    g.position.copy(pos)
    const trail = new Trail(18, 0.3, '#ffe066', 0.7)
    this.group.add(g, trail.mesh)
    const loc = r.tracker.loc
    this.bees.push({ mesh: g, owner: r, target, s: loc.mainS, lateral: loc.path === 'main' ? loc.lateral : 0, pos, life: CONFIG.items.beeLife, trail, wing, path: 'main' })
  }

  private removeTrap(t: Trap): void {
    this.group.remove(t.mesh)
    ;(t.mesh.children[0] as THREE.Mesh).geometry.dispose()
    if (this.physics.world.getRigidBody(t.body.handle)) this.physics.world.removeRigidBody(t.body)
  }

  private removeBee(b: Bee): void {
    this.group.remove(b.mesh, b.trail.mesh)
  }

  private removeShard(s: Shard): void {
    this.group.remove(s.mesh)
    if (this.physics.world.getRigidBody(s.body.handle)) this.physics.world.removeRigidBody(s.body)
  }
}
