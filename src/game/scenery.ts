import * as THREE from 'three'

/** Non-indexed copy for per-face shading/colors (skips geometries that are already flat). */
const flat = (g: THREE.BufferGeometry): THREE.BufferGeometry => (g.index ? g.toNonIndexed() : g)
import { TOON } from './kartModel'
import { SHORT_WALL, WALL, type Track } from './track'

/**
 * Sugarloop Valley scenery: gradient sky, warm key light that follows the camera, a flat-shaded
 * terrain that is flattened around the circuit, soda lakes, instanced candy vegetation, distant
 * cupcake mountains, a frosted donut arch landmark, the start gantry and bouncing spectators.
 * Everything is procedural; one seeded RNG keeps the layout identical between sessions.
 */
export type Scenery = {
  sun: THREE.DirectionalLight
  startLights: THREE.Mesh[]
  update(time: number, dt: number, focus: THREE.Vector3): void
  setShadowMap(size: number): void
}

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash2(x: number, z: number): number {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453
  return h - Math.floor(h)
}
function vnoise(x: number, z: number): number {
  const xi = Math.floor(x)
  const zi = Math.floor(z)
  const xf = x - xi
  const zf = z - zi
  const u = xf * xf * (3 - 2 * xf)
  const v = zf * zf * (3 - 2 * zf)
  const a = hash2(xi, zi)
  const b = hash2(xi + 1, zi)
  const c = hash2(xi, zi + 1)
  const d = hash2(xi + 1, zi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
function fbm(x: number, z: number): number {
  return vnoise(x, z) * 0.55 + vnoise(x * 2.1, z * 2.1) * 0.3 + vnoise(x * 4.3, z * 4.3) * 0.15
}

const LAKES = [
  { x: -112, z: -108, r: 21 },
  { x: 47, z: -64, r: 10 },
  { x: 60, z: 40, r: 26 },
]

/** Spatial hash of centre-line samples for fast "distance to the road" queries. */
class RoadField {
  private cells = new Map<string, { x: number; z: number; y: number; w: number }[]>()
  constructor(track: Track, private readonly size = 12) {
    for (const [sp, w] of [[track.main, WALL], [track.short, SHORT_WALL]] as const) {
      for (let i = 0; i < sp.samples.length; i += 2) {
        const p = sp.samples[i].pos
        const k = `${Math.floor(p.x / size)},${Math.floor(p.z / size)}`
        let list = this.cells.get(k)
        if (!list) this.cells.set(k, (list = []))
        list.push({ x: p.x, z: p.z, y: p.y, w })
      }
    }
  }
  /** Distance beyond the wall line (negative = inside the road) and the road height there. */
  query(x: number, z: number, reach = 3): { d: number; y: number } {
    const cx = Math.floor(x / this.size)
    const cz = Math.floor(z / this.size)
    let best = Infinity
    let y = 0
    for (let i = -reach; i <= reach; i += 1)
      for (let j = -reach; j <= reach; j += 1) {
        const list = this.cells.get(`${cx + i},${cz + j}`)
        if (!list) continue
        for (const p of list) {
          const d = Math.hypot(p.x - x, p.z - z) - p.w
          if (d < best) {
            best = d
            y = p.y
          }
        }
      }
    return { d: best, y }
  }
}

export function buildScenery(scene: THREE.Scene, track: Track, shadowSize: number): Scenery {
  const rand = rng(20260926)
  const field = new RoadField(track)

  // ── sky & fog ───────────────────────────────────────────────
  scene.fog = new THREE.Fog('#4d545c', 150, 560)
  scene.background = new THREE.Color('#4d545c')
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uSun: { value: new THREE.Vector3(0.45, 0.35, -0.8).normalize() } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vDir; uniform vec3 uSun;
        void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 top = vec3(0.47, 0.62, 1.0);
          vec3 mid = vec3(0.78, 0.74, 1.0);
          vec3 hor = vec3(1.0, 0.84, 0.89);
          vec3 col = mix(hor, mid, smoothstep(0.0, 0.25, h));
          col = mix(col, top, smoothstep(0.25, 0.9, h));
          float s = max(dot(normalize(vDir), uSun), 0.0);
          col += vec3(1.0, 0.85, 0.6) * (pow(s, 64.0) * 1.2 + pow(s, 6.0) * 0.18);
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  )
  sky.renderOrder = -10
  scene.add(sky)

  // ── lights ──────────────────────────────────────────────────
  scene.add(new THREE.HemisphereLight('#ffeaf6', '#8a74b6', 0.9))
  const sun = new THREE.DirectionalLight('#ffe8c8', 2.75)
  sun.castShadow = true
  const sc = sun.shadow.camera
  sc.left = sc.bottom = -48
  sc.right = sc.top = 48
  sc.near = 10
  sc.far = 220
  sun.shadow.bias = -0.0006
  sun.shadow.normalBias = 0.04
  sun.shadow.mapSize.set(shadowSize, shadowSize)
  scene.add(sun, sun.target)
  const sunDir = new THREE.Vector3(0.45, 0.8, -0.55).normalize()
  const rim = new THREE.DirectionalLight('#b7a2ff', 0.55)
  rim.position.set(-0.6, 0.4, 0.8)
  scene.add(rim)

  // ── terrain ─────────────────────────────────────────────────
  const X0 = -270
  const X1 = 210
  const Z0 = -280
  const Z1 = 110
  const cell = 3.4
  const nx = Math.ceil((X1 - X0) / cell)
  const nz = Math.ceil((Z1 - Z0) / cell)
  const heights = new Float32Array((nx + 1) * (nz + 1))
  const heightAt = (x: number, z: number) => {
    let h = fbm(x * 0.012, z * 0.012) * 16 - 4 + fbm(x * 0.05 + 7, z * 0.05) * 2.5
    // Rise toward the valley rim so the circuit sits in a bowl.
    const cx = x + 30
    const cz = z + 80
    const rad = Math.hypot(cx * 0.85, cz)
    h += THREE.MathUtils.smoothstep(rad, 150, 260) * 26
    for (const l of LAKES) {
      const d = Math.hypot(x - l.x, z - l.z)
      h = Math.min(h, THREE.MathUtils.lerp(-3.2, h, THREE.MathUtils.smoothstep(d, l.r * 0.55, l.r * 1.45)))
    }
    const road = field.query(x, z)
    if (road.d < 40) {
      const k = THREE.MathUtils.smoothstep(road.d, 0.5, 14)
      h = THREE.MathUtils.lerp(road.y - 0.45, Math.max(h, road.y - 6), k)
      if (road.d > 0.5) h = Math.max(h, road.y - 0.45 - road.d * 0.6)
    }
    return h
  }
  for (let j = 0; j <= nz; j += 1) for (let i = 0; i <= nx; i += 1) heights[j * (nx + 1) + i] = heightAt(X0 + i * cell, Z0 + j * cell)
  const tpos: number[] = []
  const tcol: number[] = []
  const grassA = new THREE.Color('#78d489')
  const grassB = new THREE.Color('#a6e071')
  const pinkish = new THREE.Color('#a83a45')
  const sand = new THREE.Color('#ffe2ae')
  const frost = new THREE.Color('#fff4fb')
  const lilac = new THREE.Color('#b196ff')
  const tmpC = new THREE.Color()
  const pushTri = (ax: number, az: number, bx: number, bz: number, cx2: number, cz2: number, ha: number, hb: number, hc: number) => {
    tpos.push(ax, ha, az, bx, hb, bz, cx2, hc, cz2)
    const mx = (ax + bx + cx2) / 3
    const mz = (az + bz + cz2) / 3
    const mh = (ha + hb + hc) / 3
    const n = fbm(mx * 0.03, mz * 0.03)
    tmpC.copy(grassA).lerp(grassB, THREE.MathUtils.clamp(n * 1.6 - 0.3, 0, 1))
    if (n > 0.74) tmpC.lerp(pinkish, 0.55)
    if (n < 0.25) tmpC.lerp(lilac, 0.35)
    if (mh < -1.2) tmpC.copy(sand)
    if (mh > 16) tmpC.lerp(frost, THREE.MathUtils.clamp((mh - 16) / 6, 0, 1))
    const jitter = 0.94 + hash2(mx, mz) * 0.1
    tmpC.multiplyScalar(jitter)
    for (let k = 0; k < 3; k += 1) tcol.push(tmpC.r, tmpC.g, tmpC.b)
  }
  for (let j = 0; j < nz; j += 1)
    for (let i = 0; i < nx; i += 1) {
      const x0 = X0 + i * cell
      const z0 = Z0 + j * cell
      const h00 = heights[j * (nx + 1) + i]
      const h10 = heights[j * (nx + 1) + i + 1]
      const h01 = heights[(j + 1) * (nx + 1) + i]
      const h11 = heights[(j + 1) * (nx + 1) + i + 1]
      if ((i + j) % 2 === 0) {
        pushTri(x0, z0, x0, z0 + cell, x0 + cell, z0, h00, h01, h10)
        pushTri(x0 + cell, z0, x0, z0 + cell, x0 + cell, z0 + cell, h10, h01, h11)
      } else {
        pushTri(x0, z0, x0, z0 + cell, x0 + cell, z0 + cell, h00, h01, h11)
        pushTri(x0, z0, x0 + cell, z0 + cell, x0 + cell, z0, h00, h11, h10)
      }
    }
  const tgeo = new THREE.BufferGeometry()
  tgeo.setAttribute('position', new THREE.Float32BufferAttribute(tpos, 3))
  tgeo.setAttribute('color', new THREE.Float32BufferAttribute(tcol, 3))
  tgeo.computeVertexNormals()
  const terrain = new THREE.Mesh(tgeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }))
  terrain.receiveShadow = true
  scene.add(terrain)
  const under = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshBasicMaterial({ color: '#f7c9dc' }))
  under.rotation.x = -Math.PI / 2
  under.position.y = 8
  under.renderOrder = -5
  // Far ring below the rim hides the terrain edge in the fog.
  const ring = new THREE.Mesh(new THREE.RingGeometry(420, 1400, 48), new THREE.MeshBasicMaterial({ color: '#f0bdd6' }))
  ring.rotation.x = -Math.PI / 2
  ring.position.set(-30, 18, -80)
  scene.add(ring)

  // ── soda lakes ──────────────────────────────────────────────
  const waterMat = new THREE.MeshStandardMaterial({ color: '#86e3ff', emissive: '#4fb7e6', emissiveIntensity: 0.25, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.88, flatShading: true })
  const waters: THREE.Mesh[] = []
  for (const l of LAKES) {
    const g = new THREE.CircleGeometry(l.r * 1.25, 28, 0, Math.PI * 2)
    const w = new THREE.Mesh(g, waterMat)
    w.rotation.x = -Math.PI / 2
    w.position.set(l.x, -1.05, l.z)
    w.receiveShadow = true
    scene.add(w)
    waters.push(w)
  }

  // ── instanced candy flora ───────────────────────────────────
  const place = (count: number, minRoad: number, maxRoad: number, fn: (x: number, z: number, y: number, i: number) => void) => {
    let n = 0
    let tries = 0
    while (n < count && tries < count * 40) {
      tries += 1
      const x = X0 + 20 + rand() * (X1 - X0 - 40)
      const z = Z0 + 20 + rand() * (Z1 - Z0 - 40)
      const road = field.query(x, z, 4)
      if (road.d < minRoad || road.d > maxRoad) continue
      if (LAKES.some(l => Math.hypot(x - l.x, z - l.z) < l.r * 1.2)) continue
      fn(x, z, heightAt(x, z), n)
      n += 1
    }
    return n
  }
  const pastel = ['#a93240', '#ffb347', '#7fd9ff', '#b58cff', '#ffe066', '#6ff0b0', '#ff8a7a'].map(c => new THREE.Color(c))
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const v = new THREE.Vector3()
  const sv = new THREE.Vector3()

  // Lollipop trees.
  const LOLLI = 90
  const sticks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.2, 1, 6), new THREE.MeshStandardMaterial({ color: '#fff5ea', flatShading: true, roughness: 0.5 }), LOLLI)
  const candy = new THREE.InstancedMesh(lollipopGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.28 }), LOLLI)
  const nLolli = place(LOLLI, 3, 90, (x, z, y, i) => {
    const h = 3.2 + rand() * 3
    const r = 1.3 + rand() * 1.1
    m4.compose(v.set(x, y + h / 2, z), q.identity(), sv.set(1, h, 1))
    sticks.setMatrixAt(i, m4)
    q.setFromEuler(new THREE.Euler(0, rand() * Math.PI * 2, (rand() - 0.5) * 0.2))
    m4.compose(v.set(x, y + h + r * 0.7, z), q, sv.set(r, r, r))
    candy.setMatrixAt(i, m4)
    candy.setColorAt(i, pastel[i % pastel.length])
  })
  sticks.count = candy.count = nLolli
  for (const m of [sticks, candy]) {
    m.castShadow = true
    m.receiveShadow = true
    scene.add(m)
  }

  // Gumdrop bushes.
  const GUM = 220
  const gum = new THREE.InstancedMesh(gumdropGeometry(), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.3 }), GUM)
  gum.count = place(GUM, 1.2, 120, (x, z, y, i) => {
    const s = 0.8 + rand() * 1.6
    m4.compose(v.set(x, y - 0.1, z), q.setFromEuler(new THREE.Euler(0, rand() * 6, 0)), sv.set(s, s * (0.8 + rand() * 0.4), s))
    gum.setMatrixAt(i, m4)
    gum.setColorAt(i, pastel[Math.floor(rand() * pastel.length)])
  })
  gum.castShadow = true
  gum.receiveShadow = true
  scene.add(gum)

  // Candy canes.
  const CANE = 28
  const cane = new THREE.InstancedMesh(caneGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.35 }), CANE)
  cane.count = place(CANE, 4, 70, (x, z, y, i) => {
    const s = 1.4 + rand() * 1.4
    m4.compose(v.set(x, y - 0.3, z), q.setFromEuler(new THREE.Euler(0, rand() * 6, 0)), sv.set(s, s, s))
    cane.setMatrixAt(i, m4)
  })
  cane.castShadow = true
  scene.add(cane)

  // Marshmallow rocks.
  const MALLOW = 60
  const mallow = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1.1, 9), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }), MALLOW)
  const mallowCols = ['#fff6f2', '#79818a', '#ffe9c7', '#e6dcff'].map(c => new THREE.Color(c))
  mallow.count = place(MALLOW, 1.5, 60, (x, z, y, i) => {
    const s = 0.7 + rand() * 1.2
    m4.compose(v.set(x, y + 0.35 * s, z), q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.4, rand() * 6, (rand() - 0.5) * 0.4)), sv.set(s, s, s))
    mallow.setMatrixAt(i, m4)
    mallow.setColorAt(i, mallowCols[i % mallowCols.length])
  })
  mallow.castShadow = true
  mallow.receiveShadow = true
  scene.add(mallow)

  // Distant cupcake mountains.
  const cupcakes = new THREE.Group()
  const cupCols = ['#a33a45', '#b6a1ff', '#9ee7ff', '#ffd27a', '#ffb3a1']
  for (let i = 0; i < 11; i += 1) {
    const a = (i / 11) * Math.PI * 2 + 0.3
    const R = 290 + (i % 3) * 40
    const x = -30 + Math.cos(a) * R * 1.1
    const z = -80 + Math.sin(a) * R * 0.85
    const s = 28 + (i % 4) * 9
    const cup = cupcake(cupCols[i % cupCols.length], s)
    cup.position.set(x, 8 + (i % 2) * 6, z)
    cup.rotation.y = a
    cupcakes.add(cup)
  }
  scene.add(cupcakes)

  // Cotton-candy clouds.
  const clouds = new THREE.Group()
  const cloudMat = new THREE.MeshStandardMaterial({ color: '#fff3fa', emissive: '#ffd9ec', emissiveIntensity: 0.35, flatShading: true, roughness: 1, fog: true })
  const puff = new THREE.IcosahedronGeometry(1, 1)
  for (let i = 0; i < 18; i += 1) {
    const c = new THREE.Group()
    const n = 4 + Math.floor(rand() * 4)
    for (let k = 0; k < n; k += 1) {
      const m = new THREE.Mesh(puff, cloudMat)
      const s = 5 + rand() * 7
      m.scale.set(s * 1.3, s * 0.8, s)
      m.position.set((k - n / 2) * 7 + rand() * 3, rand() * 3, rand() * 5)
      c.add(m)
    }
    c.position.set(-300 + rand() * 560, 70 + rand() * 50, -330 + rand() * 420)
    c.userData.speed = 1 + rand() * 2
    clouds.add(c)
  }
  scene.add(clouds)

  // ── landmarks ───────────────────────────────────────────────
  // Frosted donut arch over the hill crest.
  const donut = new THREE.Group()
  const R = 14
  const dough = new THREE.Mesh(new THREE.TorusGeometry(R, 2.5, 10, 36), new THREE.MeshStandardMaterial({ color: '#e9a15e', flatShading: true, roughness: 0.7 }))
  const icing = new THREE.Mesh(new THREE.TorusGeometry(R, 2.75, 10, 36, Math.PI * 1.02), new THREE.MeshStandardMaterial({ color: '#ff7eb6', flatShading: true, roughness: 0.3 }))
  icing.position.z = 0.25
  icing.rotation.z = -0.01
  donut.add(dough, icing)
  const sprGeo = new THREE.BoxGeometry(0.22, 0.22, 0.9)
  const spr = new THREE.InstancedMesh(sprGeo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.4 }), 90)
  for (let i = 0; i < 90; i += 1) {
    const a = rand() * Math.PI
    const t = (rand() - 0.5) * 2.4
    const rr = R + Math.cos(t) * 2.8
    m4.compose(v.set(Math.cos(a) * rr, Math.sin(a) * rr, 0.25 + Math.sin(t) * 2.8), q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3)), sv.set(1, 1, 1))
    spr.setMatrixAt(i, m4)
    spr.setColorAt(i, pastel[i % pastel.length])
  }
  donut.add(spr)
  donut.traverse(o => {
    o.castShadow = true
  })
  donut.position.copy(track.landmarks.arch).setY(track.landmarks.arch.y - 1.5)
  donut.rotation.y = track.landmarks.archYaw
  scene.add(donut)

  // Start gantry: two candy-cane pillars and a banner with the race lights.
  const gantry = new THREE.Group()
  const s0 = track.main.at(0)
  const pillarGeo = stripedCylinder(0.7, 9.5, 14)
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.4 }))
    p.position.copy(s0.pos).addScaledVector(s0.right, side * (WALL + 1.1))
    p.position.y += 4.75
    p.castShadow = true
    gantry.add(p)
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1), new THREE.MeshStandardMaterial({ color: '#ffe066', flatShading: true, roughness: 0.3 }))
    ball.position.copy(p.position).setY(p.position.y + 5.3)
    gantry.add(ball)
  }
  const bannerTex = bannerTexture()
  const banner = new THREE.Mesh(new THREE.BoxGeometry((WALL + 1.1) * 2, 2.6, 0.6), [
    new THREE.MeshStandardMaterial({ color: '#a92d3b' }),
    new THREE.MeshStandardMaterial({ color: '#a92d3b' }),
    new THREE.MeshStandardMaterial({ color: '#a92d3b' }),
    new THREE.MeshStandardMaterial({ color: '#a92d3b' }),
    new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.6 }),
    new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.6 }),
  ])
  banner.position.copy(s0.pos).setY(s0.pos.y + 8.3)
  banner.rotation.y = Math.atan2(s0.tan.x, s0.tan.z)
  banner.castShadow = true
  gantry.add(banner)
  const startLights: THREE.Mesh[] = []
  for (let i = 0; i < 3; i += 1) {
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.55, 16), new THREE.MeshBasicMaterial({ color: '#3a2440', toneMapped: false }))
    l.position.copy(banner.position).addScaledVector(s0.right, (i - 1) * 1.6).addScaledVector(s0.tan, -0.32)
    l.position.y -= 2.1
    l.rotation.y = banner.rotation.y + Math.PI
    const back = new THREE.Mesh(new THREE.CircleGeometry(0.75, 16), new THREE.MeshStandardMaterial({ color: '#2b1a2e' }))
    back.position.copy(l.position).addScaledVector(s0.tan, 0.02)
    back.rotation.y = l.rotation.y
    gantry.add(back, l)
    startLights.push(l)
  }
  scene.add(gantry)

  // Bleachers with bouncing critter fans beside the start straight.
  const fans: { mesh: THREE.InstancedMesh; base: THREE.Matrix4[]; phase: number[] } = { mesh: new THREE.InstancedMesh(fanGeometry(), TOON, 60), base: [], phase: [] }
  const bleacher = new THREE.MeshStandardMaterial({ color: '#b98cff', flatShading: true, roughness: 0.7 })
  let fanCount = 0
  for (const [sAt, side] of [[-40, 1], [-70, -1], [20, 1]] as const) {
    const smp = track.main.at(sAt)
    const yaw = Math.atan2(smp.tan.x, smp.tan.z)
    for (let row = 0; row < 3; row += 1) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(22, 1, 2.2), bleacher)
      step.position.copy(smp.pos).addScaledVector(smp.right, side * (WALL + 4 + row * 2.2))
      step.position.y += 0.5 + row * 1
      step.scale.y = 1 + row
      step.position.y = smp.pos.y + (1 + row) * 0.5
      step.rotation.y = yaw
      step.castShadow = step.receiveShadow = true
      scene.add(step)
      for (let k = 0; k < 7 && fanCount < 60; k += 1) {
        const p = smp.pos.clone().addScaledVector(smp.right, side * (WALL + 4 + row * 2.2)).addScaledVector(smp.tan, (k - 3) * 3 + (rand() - 0.5))
        p.y = smp.pos.y + (1 + row) + 0.05
        const mm = new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2), 0)), new THREE.Vector3(1, 1, 1))
        fans.base.push(mm)
        fans.phase.push(rand() * 10)
        fans.mesh.setMatrixAt(fanCount, mm)
        fans.mesh.setColorAt(fanCount, pastel[fanCount % pastel.length])
        fanCount += 1
      }
    }
  }
  fans.mesh.count = fanCount
  fans.mesh.castShadow = true
  scene.add(fans.mesh)

  // Shortcut signpost.
  const sign = new THREE.Group()
  const sp = track.short.at(3)
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3.6, 6), new THREE.MeshStandardMaterial({ color: '#fff5ea' }))
  post.position.y = 1.8
  const board = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.3, 0.2), [
    new THREE.MeshStandardMaterial({ color: '#ffd84d' }),
    new THREE.MeshStandardMaterial({ color: '#ffd84d' }),
    new THREE.MeshStandardMaterial({ color: '#ffd84d' }),
    new THREE.MeshStandardMaterial({ color: '#ffd84d' }),
    new THREE.MeshStandardMaterial({ map: arrowTexture() }),
    new THREE.MeshStandardMaterial({ color: '#ffd84d' }),
  ])
  board.position.y = 3.4
  sign.add(post, board)
  const main0 = track.main.closest(sp.pos)
  const mainS = track.main.at(main0.s)
  sign.position.copy(mainS.pos).addScaledVector(mainS.right, Math.sign(main0.lateral) * -1 * (WALL + 1.2) * -1)
  sign.position.copy(sp.pos).addScaledVector(sp.right, 0).add(new THREE.Vector3())
  sign.position.copy(track.main.pointAt(main0.s - 18, Math.sign(main0.lateral || 1) * (WALL + 1.3)))
  sign.rotation.y = track.main.yawAt(main0.s - 18) + Math.PI
  sign.traverse(o => (o.castShadow = true))
  scene.add(sign)

  const setShadowMap = (size: number) => {
    sun.shadow.mapSize.set(size, size)
    sun.shadow.map?.dispose()
    sun.shadow.map = null as unknown as THREE.WebGLRenderTarget
  }

  return {
    sun,
    startLights,
    setShadowMap,
    update(time, dt, focus) {
      sun.position.copy(focus).addScaledVector(sunDir, 110)
      sun.target.position.copy(focus)
      for (const w of waters) w.position.y = -1.05 + Math.sin(time * 0.8 + w.position.x) * 0.06
      for (const c of clouds.children) {
        c.position.x += c.userData.speed * dt
        if (c.position.x > 280) c.position.x = -320
      }
      const tmp = new THREE.Matrix4()
      for (let i = 0; i < fans.base.length; i += 1) {
        const hop = Math.max(0, Math.sin(time * 7 + fans.phase[i])) * 0.35
        tmp.copy(fans.base[i])
        tmp.elements[13] += hop
        fans.mesh.setMatrixAt(i, tmp)
      }
      fans.mesh.instanceMatrix.needsUpdate = true
      void under
    },
  }
}

function lollipopGeometry(): THREE.BufferGeometry {
  // Flat disc with a two-tone spiral baked into vertex colours (white swirl over instance colour).
  const g = flat(new THREE.CylinderGeometry(1, 1, 0.34, 18, 1))
  g.rotateX(Math.PI / 2)
  const pos = g.getAttribute('position')
  const col = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3
    const a = Math.atan2(cy, cx)
    const r = Math.hypot(cx, cy)
    const stripe = Math.sin(a * 2 + r * 9) > 0.2
    const c = stripe ? 1 : 0.55
    for (let k = 0; k < 3; k += 1) {
      col[(i + k) * 3] = stripe ? 1 : c
      col[(i + k) * 3 + 1] = stripe ? 1 : c
      col[(i + k) * 3 + 2] = stripe ? 1 : c
    }
  }
  // Instance colour multiplies vertex colour; white stripes stay pale, the rest takes the tint.
  for (let i = 0; i < col.length; i += 1) col[i] = col[i] > 0.9 ? 1 : 0.62
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.computeVertexNormals()
  return g
}

function gumdropGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= 6; i += 1) {
    const t = i / 6
    pts.push(new THREE.Vector2(Math.max(0.001, Math.cos(t * Math.PI * 0.5) * (1 - t * 0.15)), Math.sin(t * Math.PI * 0.5) * 1.15))
  }
  pts.unshift(new THREE.Vector2(0.001, 0))
  return new THREE.LatheGeometry(pts, 8)
}

function caneGeometry(): THREE.BufferGeometry {
  const path = new THREE.CurvePath<THREE.Vector3>()
  path.add(new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 3.2, 0)))
  const arc = new THREE.CubicBezierCurve3(new THREE.Vector3(0, 3.2, 0), new THREE.Vector3(0, 4.4, 0), new THREE.Vector3(1.4, 4.4, 0), new THREE.Vector3(1.4, 3.4, 0))
  path.add(arc)
  const g = flat(new THREE.TubeGeometry(path as unknown as THREE.Curve<THREE.Vector3>, 40, 0.28, 7, false))
  const pos = g.getAttribute('position')
  const col = new Float32Array(pos.count * 3)
  const red = new THREE.Color('#ff3f6e')
  const white = new THREE.Color('#fff6f8')
  for (let i = 0; i < pos.count; i += 3) {
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3
    const z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3
    const c = Math.sin((y + x) * 4 + Math.atan2(z, x) * 1.5) > 0 ? red : white
    for (let k = 0; k < 3; k += 1) col.set([c.r, c.g, c.b], (i + k) * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.computeVertexNormals()
  return g
}

function stripedCylinder(r: number, h: number, bands: number): THREE.BufferGeometry {
  const g = flat(new THREE.CylinderGeometry(r, r, h, 10, bands * 2))
  const pos = g.getAttribute('position')
  const col = new Float32Array(pos.count * 3)
  const red = new THREE.Color('#ff3f6e')
  const white = new THREE.Color('#fff6f8')
  for (let i = 0; i < pos.count; i += 3) {
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3
    const z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3
    const c = Math.sin(y * 2.2 + Math.atan2(z, x)) > 0 ? red : white
    for (let k = 0; k < 3; k += 1) col.set([c.r, c.g, c.b], (i + k) * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.computeVertexNormals()
  return g
}

function cupcake(frosting: string, s: number): THREE.Group {
  const g = new THREE.Group()
  const liner = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.9, s * 0.7, s * 0.8, 18), new THREE.MeshStandardMaterial({ color: '#f5b7c9', flatShading: true, roughness: 0.8 }))
  liner.position.y = s * 0.4
  const top = new THREE.Mesh(new THREE.IcosahedronGeometry(s * 0.95, 1), new THREE.MeshStandardMaterial({ color: frosting, flatShading: true, roughness: 0.5 }))
  top.scale.set(1, 0.62, 1)
  top.position.y = s * 0.95
  const swirl = new THREE.Mesh(new THREE.IcosahedronGeometry(s * 0.55, 1), new THREE.MeshStandardMaterial({ color: frosting, flatShading: true, roughness: 0.5 }))
  swirl.scale.set(1, 0.7, 1)
  swirl.position.y = s * 1.45
  const cherry = new THREE.Mesh(new THREE.IcosahedronGeometry(s * 0.2, 1), new THREE.MeshStandardMaterial({ color: '#ff3355', flatShading: true, roughness: 0.25 }))
  cherry.position.y = s * 1.9
  g.add(liner, top, swirl, cherry)
  return g
}

function fanGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const body = flat(new THREE.CapsuleGeometry(0.42, 0.5, 2, 7))
  body.translate(0, 0.72, 0)
  const earL = flat(new THREE.IcosahedronGeometry(0.17, 0))
  earL.translate(0.25, 1.38, 0)
  const earR = earL.clone()
  earR.translate(-0.5, 0, 0)
  const eyeL = flat(new THREE.IcosahedronGeometry(0.06, 0))
  eyeL.translate(0.14, 1.05, 0.38)
  const eyeR = eyeL.clone()
  eyeR.translate(-0.28, 0, 0)
  const white = (g: THREE.BufferGeometry, c: number) => {
    const n = g.getAttribute('position').count
    g.deleteAttribute('uv')
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(c), 3))
    parts.push(g)
  }
  white(body, 1)
  white(earL, 0.8)
  white(earR, 0.8)
  white(eyeL, 0.05)
  white(eyeR, 0.05)
  let merged = parts[0]
  const all = parts.map(p => p)
  const positions: number[] = []
  const colors: number[] = []
  for (const p of all) {
    positions.push(...(p.getAttribute('position').array as Float32Array))
    colors.push(...(p.getAttribute('color').array as Float32Array))
  }
  merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  merged.computeVertexNormals()
  return merged
}

function bannerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 128
  const g = c.getContext('2d')!
  for (let i = 0; i < 32; i += 1) {
    g.fillStyle = i % 2 ? '#ffffff' : '#9e3541'
    g.fillRect(i * 32, 0, 32, 16)
    g.fillStyle = i % 2 ? '#9e3541' : '#ffffff'
    g.fillRect(i * 32, 112, 32, 16)
  }
  g.fillStyle = '#a92d3b'
  g.fillRect(0, 16, 1024, 96)
  g.font = '900 64px Sora, "Noto Sans SC", sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineWidth = 12
  g.strokeStyle = '#2b1a2e'
  g.lineJoin = 'round'
  g.strokeText('DRIFT KART TR', 512, 66)
  g.fillStyle = '#fff4c8'
  g.fillText('DRIFT KART TR', 512, 66)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function arrowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#ffd84d'
  g.fillRect(0, 0, 256, 128)
  g.strokeStyle = '#2b1a2e'
  g.lineWidth = 10
  g.strokeRect(5, 5, 246, 118)
  g.fillStyle = '#9e3541'
  g.strokeStyle = '#2b1a2e'
  g.lineWidth = 8
  g.beginPath()
  g.moveTo(40, 50)
  g.lineTo(150, 50)
  g.lineTo(150, 22)
  g.lineTo(215, 64)
  g.lineTo(150, 106)
  g.lineTo(150, 78)
  g.lineTo(40, 78)
  g.closePath()
  g.fill()
  g.stroke()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
