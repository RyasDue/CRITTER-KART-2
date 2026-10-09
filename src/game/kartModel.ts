import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Character } from './characters'

/**
 * Procedural low-poly karts and critter drivers. Static parts are merged into a few vertex-
 * coloured meshes per kart (≈8 draw calls), with separate nodes only for animated parts:
 * steering front wheels, rolling wheels, the body (lean/squash), the head (bob) and the tail.
 */
export const TOON = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.62, metalness: 0.02 })

type V3 = [number, number, number]

export class Parts {
  private list: THREE.BufferGeometry[] = []

  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone()
    g.deleteAttribute('uv')
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale))
    g.applyMatrix4(m)
    const c = new THREE.Color(color)
    const n = g.getAttribute('position').count
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i += 1) {
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.list.push(g)
    return this
  }

  /** Capsule-ish limb between two points. */
  limb(a: V3, b: V3, r: number, color: THREE.ColorRepresentation): this {
    const va = new THREE.Vector3(...a)
    const vb = new THREE.Vector3(...b)
    const len = va.distanceTo(vb)
    const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len), 2, 6)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize())
    const e = new THREE.Euler().setFromQuaternion(q)
    const mid = va.add(vb).multiplyScalar(0.5)
    return this.add(g, color, [mid.x, mid.y, mid.z], [e.x, e.y, e.z])
  }

  mesh(material: THREE.Material = TOON): THREE.Mesh {
    const merged = mergeGeometries(this.list, false)!
    merged.computeVertexNormals()
    for (const g of this.list) g.dispose()
    this.list = []
    const mesh = new THREE.Mesh(merged, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }
}

const ico = (r: number, d = 1) => new THREE.IcosahedronGeometry(r, d)
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z)
const cyl = (rt: number, rb: number, h: number, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s)
const cone = (r: number, h: number, s = 6) => new THREE.ConeGeometry(r, h, s)

const INK = '#2b1a2e'
const WHITE = '#fffaf2'
const PINK = '#a33a45'

export type KartView = {
  root: THREE.Group
  /** Lean/squash node containing chassis + driver. */
  body: THREE.Group
  driver: THREE.Group
  head: THREE.Group
  tail?: THREE.Group
  frontPivots: THREE.Group[]
  wheels: THREE.Object3D[]
  /** Local positions of the rear wheel contact points (drift sparks). */
  sparkPoints: THREE.Vector3[]
  /** Local exhaust tips (boost flames). */
  exhausts: THREE.Vector3[]
  shield: THREE.Mesh
  shadow: THREE.Mesh
}

export function bubbleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uPop: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      uniform float uTime;
      void main() {
        vec3 p = position * (1.0 + 0.035 * sin(uTime * 6.0 + position.y * 4.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      uniform float uTime; uniform float uPop;
      void main() {
        float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
        vec3 a = vec3(0.55, 0.95, 1.0); vec3 b = vec3(1.0, 0.6, 0.9);
        vec3 col = mix(a, b, 0.5 + 0.5 * sin(vP.y * 3.0 + uTime * 2.0));
        float alpha = (0.08 + f * 0.75) * (1.0 - uPop);
        gl_FragColor = vec4(col * (1.0 + f), alpha);
      }`,
  })
}

/** Driver torso + head for one species (also used for portraits). */
function buildDriver(c: Character): { driver: THREE.Group; head: THREE.Group; tail?: THREE.Group } {
  const driver = new THREE.Group()
  const torso = new Parts()
  torso.add(ico(0.42), c.fur, [0, 0.95, -0.32], [0, 0, 0], [1, 1.05, 0.9])
  torso.add(ico(0.3), c.belly, [0, 0.9, -0.08], [0, 0, 0], [1, 1.1, 0.45])
  torso.add(new THREE.TorusGeometry(0.28, 0.09, 5, 10), c.kartAccent, [0, 1.24, -0.28], [Math.PI / 2, 0, 0])
  torso.limb([0.34, 1.08, -0.22], [0.17, 0.98, 0.3], 0.1, c.fur)
  torso.limb([-0.34, 1.08, -0.22], [-0.17, 0.98, 0.3], 0.1, c.fur)
  torso.add(ico(0.1, 0), c.furDark, [0.16, 0.98, 0.34])
  torso.add(ico(0.1, 0), c.furDark, [-0.16, 0.98, 0.34])
  driver.add(torso.mesh())

  const head = new THREE.Group()
  head.position.set(0, 1.58, -0.24)
  const h = new Parts()
  const eye = (x: number, y: number, z: number, sy = 1, r = 0.075) => {
    h.add(ico(r, 1), INK, [x, y, z], [0, 0, 0], [1, sy, 0.8])
    if (sy > 0.6) h.add(ico(r * 0.35, 0), WHITE, [x + 0.025, y + 0.03, z + r * 0.7])
  }
  const cheeks = (y = -0.12, z = 0.36) => {
    h.add(ico(0.075, 1), PINK, [0.3, y, z], [0, 0, 0], [1, 0.6, 0.4])
    h.add(ico(0.075, 1), PINK, [-0.3, y, z], [0, 0, 0], [1, 0.6, 0.4])
  }
  let tail: THREE.Group | undefined
  switch (c.id) {
    case 'hamster':
      h.add(ico(0.5), c.fur, [0, 0, 0], [0, 0, 0], [1.08, 0.95, 1])
      h.add(ico(0.2), c.belly, [0.3, -0.14, 0.22], [0, 0, 0], [1, 0.85, 0.9])
      h.add(ico(0.2), c.belly, [-0.3, -0.14, 0.22], [0, 0, 0], [1, 0.85, 0.9])
      h.add(ico(0.26), c.belly, [0, -0.12, 0.33], [0, 0, 0], [1.1, 0.75, 0.6])
      for (const s of [1, -1]) {
        h.add(ico(0.15), c.furDark, [s * 0.32, 0.38, -0.02], [0, 0, 0], [1, 1, 0.45])
        h.add(ico(0.09), PINK, [s * 0.32, 0.38, 0.04], [0, 0, 0], [1, 1, 0.3])
      }
      eye(0.18, 0.06, 0.43)
      eye(-0.18, 0.06, 0.43)
      h.add(ico(0.05, 0), '#ff6f91', [0, -0.05, 0.52])
      cheeks()
      break
    case 'hedgehog': {
      h.add(ico(0.48), c.fur, [0, 0, 0])
      h.add(ico(0.3), c.belly, [0, -0.08, 0.26], [0, 0, 0], [1.1, 0.9, 0.9])
      h.add(cone(0.14, 0.32, 6), c.belly, [0, -0.1, 0.55], [Math.PI / 2, 0, 0])
      h.add(ico(0.07, 0), INK, [0, -0.1, 0.72])
      eye(0.17, 0.08, 0.42)
      eye(-0.17, 0.08, 0.42)
      cheeks(-0.14, 0.34)
      // Spikes over the back of the head.
      for (let i = 0; i < 16; i += 1) {
        const a = (i / 16) * Math.PI * 2
        const ring = i % 2 === 0 ? 0.35 : 0.8
        const dir = new THREE.Vector3(Math.cos(a) * 0.9, Math.sin(a) * 0.9 + 0.35, -0.9 + ring * 0.4).normalize()
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
        const e = new THREE.Euler().setFromQuaternion(q)
        const p = dir.clone().multiplyScalar(0.42)
        if (p.z > 0.15) continue
        h.add(cone(0.11, 0.42, 4), c.furDark, [p.x, p.y, p.z], [e.x, e.y, e.z])
      }
      for (const s of [1, -1]) h.add(ico(0.1), c.furDark, [s * 0.3, 0.36, 0.05], [0, 0, 0], [1, 1, 0.5])
      break
    }
    case 'sloth':
      h.add(ico(0.5), c.fur, [0, 0, 0], [0, 0, 0], [1.02, 0.96, 1])
      h.add(ico(0.36), c.belly, [0, -0.02, 0.2], [0, 0, 0], [1.2, 0.95, 0.85])
      for (const s of [1, -1]) {
        h.add(ico(0.13), c.furDark, [s * 0.19, 0.02, 0.42], [0, 0, s * 0.5], [1.5, 0.75, 0.45])
        h.add(ico(0.05, 1), INK, [s * 0.2, 0.02, 0.48], [0, 0, 0], [1.3, 0.45, 0.6])
      }
      h.add(ico(0.07, 0), '#3b2a22', [0, -0.12, 0.53], [0, 0, 0], [1.2, 0.8, 0.8])
      h.add(box(0.14, 0.025, 0.02), '#3b2a22', [0, -0.24, 0.49])
      h.add(ico(0.14, 0), c.furDark, [0.05, 0.5, -0.02], [0.4, 0, 0.3], [1, 1.4, 1])
      cheeks(-0.18, 0.4)
      break
    case 'redpanda':
      h.add(ico(0.5), c.fur, [0, 0, 0], [0, 0, 0], [1.1, 0.95, 1])
      h.add(ico(0.26), c.belly, [0, -0.14, 0.34], [0, 0, 0], [1.2, 0.75, 0.6])
      for (const s of [1, -1]) {
        h.add(cone(0.17, 0.32, 5), c.fur, [s * 0.33, 0.43, -0.02], [0, 0, -s * 0.35])
        h.add(cone(0.1, 0.2, 5), WHITE, [s * 0.32, 0.41, 0.06], [0, 0, -s * 0.35])
        h.add(ico(0.065, 0), WHITE, [s * 0.2, 0.21, 0.42])
        h.add(ico(0.12), c.furDark, [s * 0.22, -0.18, 0.3], [0, 0, 0], [0.7, 1.2, 0.5])
      }
      eye(0.19, 0.06, 0.44)
      eye(-0.19, 0.06, 0.44)
      h.add(ico(0.055, 0), INK, [0, -0.08, 0.55])
      break
    case 'bunny':
      h.add(ico(0.48), c.fur, [0, 0, 0], [0, 0, 0], [1, 0.98, 1])
      h.add(ico(0.24), c.belly, [0, -0.14, 0.32], [0, 0, 0], [1.2, 0.75, 0.6])
      for (const s of [1, -1]) {
        h.add(new THREE.CapsuleGeometry(0.11, 0.62, 2, 6), c.fur, [s * 0.17, 0.72, -0.1], [-0.25, 0, -s * 0.18])
        h.add(new THREE.CapsuleGeometry(0.055, 0.5, 2, 5), PINK, [s * 0.17, 0.72, -0.02], [-0.25, 0, -s * 0.18], [1, 1, 0.5])
      }
      eye(0.17, 0.06, 0.42)
      eye(-0.17, 0.06, 0.42)
      h.add(ico(0.055, 0), '#ff6f91', [0, -0.07, 0.5])
      h.add(box(0.1, 0.09, 0.03), WHITE, [0, -0.2, 0.47])
      cheeks()
      break
    case 'frog':
      h.add(ico(0.5), c.fur, [0, 0, 0], [0, 0, 0], [1.25, 0.78, 1])
      h.add(ico(0.36), c.belly, [0, -0.2, 0.18], [0, 0, 0], [1.35, 0.5, 0.9])
      for (const s of [1, -1]) {
        h.add(ico(0.18), c.fur, [s * 0.25, 0.32, 0.12])
        h.add(ico(0.13), WHITE, [s * 0.25, 0.35, 0.22])
        h.add(ico(0.07), INK, [s * 0.25, 0.36, 0.33])
        h.add(ico(0.025, 0), WHITE, [s * 0.25 + 0.03, 0.39, 0.39])
      }
      h.add(box(0.46, 0.03, 0.03), '#2d5c2a', [0, -0.13, 0.49], [0, 0, 0])
      cheeks(-0.08, 0.42)
      break
  }
  const headMesh = h.mesh()
  head.add(headMesh)
  driver.add(head)

  if (c.id === 'redpanda') {
    tail = new THREE.Group()
    tail.position.set(0, 0.8, -0.95)
    const t = new Parts()
    for (let i = 0; i < 6; i += 1) {
      const k = i / 5
      t.add(ico(0.2 - k * 0.04, 1), i % 2 === 0 ? c.fur : c.furDark, [0, k * 0.55, -0.1 - Math.sin(k * 2.2) * 0.35], [0, 0, 0], [1, 0.9, 1])
    }
    tail.add(t.mesh())
    driver.add(tail)
  } else if (c.id === 'bunny' || c.id === 'hamster') {
    const t = new Parts().add(ico(0.12), c.id === 'bunny' ? WHITE : c.furDark, [0, 0.82, -0.72])
    driver.add(t.mesh())
  }
  return { driver, head, tail }
}

export function buildKart(c: Character): KartView {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  const chassis = new Parts()
  const kc = c.kart
  const ac = c.kartAccent
  chassis.add(box(1.36, 0.26, 2.0), kc, [0, 0.42, 0])
  chassis.add(box(1.0, 0.24, 0.62), kc, [0, 0.5, 1.12], [-0.28, 0, 0])
  chassis.add(box(0.36, 0.3, 1.25), ac, [0.72, 0.44, -0.05])
  chassis.add(box(0.36, 0.3, 1.25), ac, [-0.72, 0.44, -0.05])
  chassis.add(cyl(0.13, 0.13, 1.5, 8), WHITE, [0, 0.33, 1.45], [0, 0, Math.PI / 2])
  chassis.add(box(0.78, 0.12, 0.62), '#4a2f3c', [0, 0.6, -0.34])
  chassis.add(box(0.82, 0.72, 0.16), ac, [0, 0.94, -0.72], [-0.12, 0, 0])
  chassis.add(box(0.95, 0.42, 0.48), '#5b3a2a', [0, 0.62, -0.98])
  for (const s of [1, -1]) {
    chassis.add(cyl(0.1, 0.12, 0.5, 7), ac, [s * 0.3, 0.8, -1.26], [-1.1, 0, 0])
    chassis.add(cyl(0.12, 0.1, 0.1, 7), WHITE, [s * 0.3, 0.9, -1.48], [-1.1, 0, 0])
    chassis.add(box(0.06, 0.45, 0.06), INK, [s * 0.55, 1.05, -1.02])
  }
  chassis.add(box(1.55, 0.08, 0.38), ac, [0, 1.27, -1.08], [0.12, 0, 0])
  chassis.add(box(1.55, 0.05, 0.4), kc, [0, 1.32, -1.08], [0.12, 0, 0])
  chassis.add(cyl(0.04, 0.04, 0.5, 5), INK, [0, 0.78, 0.42], [-0.9, 0, 0])
  chassis.add(new THREE.TorusGeometry(0.2, 0.045, 5, 10), INK, [0, 0.96, 0.3], [-0.55, 0, 0])
  // Paw emblem on the nose.
  chassis.add(cyl(0.12, 0.12, 0.03, 8), WHITE, [0, 0.66, 1.1], [1.29, 0, 0])
  for (const [x, z] of [[-0.11, 0.1], [0, 0.14], [0.11, 0.1]]) chassis.add(cyl(0.045, 0.045, 0.03, 6), WHITE, [x, 0.7 + z * 0.3, 1.2 - z * 0.1], [1.29, 0, 0])
  body.add(chassis.mesh())

  const { driver, head, tail } = buildDriver(c)
  body.add(driver)

  const wheels: THREE.Object3D[] = []
  const frontPivots: THREE.Group[] = []
  const makeWheel = (r: number, w: number) => {
    const p = new Parts()
    p.add(cyl(r, r, w, 10), '#3a2430', [0, 0, 0], [0, 0, Math.PI / 2])
    p.add(cyl(r * 0.55, r * 0.55, w + 0.04, 8), ac, [0, 0, 0], [0, 0, Math.PI / 2])
    p.add(cyl(r * 0.2, r * 0.2, w + 0.08, 6), WHITE, [0, 0, 0], [0, 0, Math.PI / 2])
    p.add(box(w + 0.02, r * 0.3, r * 2.02), '#2a1822', [0, 0, 0])
    return p.mesh()
  }
  for (const s of [1, -1]) {
    const pivot = new THREE.Group()
    pivot.position.set(s * 0.8, 0.33, 0.78)
    const w = makeWheel(0.33, 0.3)
    pivot.add(w)
    root.add(pivot)
    frontPivots.push(pivot)
    wheels.push(w)
    const rear = makeWheel(0.39, 0.4)
    rear.position.set(s * 0.82, 0.39, -0.78)
    root.add(rear)
    wheels.push(rear)
  }

  const shield = new THREE.Mesh(new THREE.IcosahedronGeometry(1.75, 2), bubbleMaterial())
  shield.position.y = 0.95
  shield.visible = false
  root.add(shield)

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.25, 16),
    new THREE.MeshBasicMaterial({ color: '#2b1430', transparent: true, opacity: 0.32, depthWrite: false }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.scale.set(0.85, 1.25, 1)
  shadow.renderOrder = 1

  return {
    root,
    body,
    driver,
    head,
    tail,
    frontPivots,
    wheels,
    sparkPoints: [new THREE.Vector3(0.82, 0.05, -1.05), new THREE.Vector3(-0.82, 0.05, -1.05)],
    exhausts: [new THREE.Vector3(0.3, 0.95, -1.55), new THREE.Vector3(-0.3, 0.95, -1.55)],
    shield,
    shadow,
  }
}

/** Head-and-shoulders portraits for UI cards, rendered once with the game renderer. */
export function renderPortraits(gl: THREE.WebGLRenderer, roster: Character[], size = 160): Map<string, string> {
  const out = new Map<string, string>()
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight('#fff4f8', '#8a6a9a', 1.6))
  const key = new THREE.DirectionalLight('#fff0e0', 2.4)
  key.position.set(2, 3, 4)
  scene.add(key)
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20)
  cam.position.set(0.9, 1.75, 3.1)
  cam.lookAt(0, 1.38, 0)
  const target = new THREE.WebGLRenderTarget(size, size, { samples: 4 })
  target.texture.colorSpace = THREE.SRGBColorSpace
  const pixels = new Uint8Array(size * size * 4)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const prevTarget = gl.getRenderTarget()
  const prevClear = gl.getClearColor(new THREE.Color())
  const prevAlpha = gl.getClearAlpha()
  const prevTone = gl.toneMapping
  gl.setClearColor(0x000000, 0)
  for (const c of roster) {
    const { driver } = buildDriver(c)
    driver.rotation.y = 0.35
    scene.add(driver)
    gl.setRenderTarget(target)
    gl.clear()
    gl.render(scene, cam)
    gl.readRenderTargetPixels(target, 0, 0, size, size, pixels)
    const img = ctx.createImageData(size, size)
    for (let y = 0; y < size; y += 1) {
      const src = (size - 1 - y) * size * 4
      img.data.set(pixels.subarray(src, src + size * 4), y * size * 4)
    }
    ctx.clearRect(0, 0, size, size)
    ctx.putImageData(img, 0, 0)
    out.set(c.id, canvas.toDataURL('image/png'))
    scene.remove(driver)
    driver.traverse(o => (o as THREE.Mesh).geometry?.dispose())
  }
  gl.setRenderTarget(prevTarget)
  gl.setClearColor(prevClear, prevAlpha)
  gl.toneMapping = prevTone
  target.dispose()
  return out
}
