import * as THREE from 'three'

/**
 * Ribbon trail that follows a moving point (boost streaks, bee trails). Width tapers and alpha
 * fades toward the tail; `emit` controls whether new points are appended or the trail drains.
 */
export class Trail {
  readonly mesh: THREE.Mesh
  private readonly points: THREE.Vector3[] = []
  private readonly pos: Float32Array
  private readonly alpha: Float32Array
  private readonly geo = new THREE.BufferGeometry()
  private drain = 0

  constructor(private readonly max = 24, private readonly width = 0.5, color: THREE.ColorRepresentation = '#ffffff', opacity = 0.8) {
    this.pos = new Float32Array(max * 2 * 3)
    this.alpha = new Float32Array(max * 2)
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
    const idx: number[] = []
    for (let i = 0; i < max - 1; i += 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
    this.geo.setIndex(idx)
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
        vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(uColor * (0.6 + vA), vA * uOpacity); }`,
      }),
    )
    this.mesh.frustumCulled = false
  }

  set color(c: THREE.ColorRepresentation) {
    ;(this.mesh.material as THREE.ShaderMaterial).uniforms.uColor.value.set(c)
  }

  reset(): void {
    this.points.length = 0
    this.geo.setDrawRange(0, 0)
  }

  /** Add the head position (world) and a side vector for the ribbon width. */
  update(head: THREE.Vector3, side: THREE.Vector3, emit: boolean): void {
    if (emit) {
      this.drain = 0
      const last = this.points[0]
      if (!last || last.distanceToSquared(head) > 0.09) {
        this.points.unshift(head.clone())
        if (this.points.length > this.max) this.points.pop()
      } else last.copy(head)
    } else {
      this.drain += 1
      if (this.drain % 1 === 0 && this.points.length) this.points.pop()
    }
    const n = this.points.length
    for (let i = 0; i < n; i += 1) {
      const p = this.points[i]
      const k = 1 - i / Math.max(1, n - 1)
      const w = this.width * (0.2 + 0.8 * k) * 0.5
      this.pos.set([p.x + side.x * w, p.y + side.y * w, p.z + side.z * w], i * 6)
      this.pos.set([p.x - side.x * w, p.y - side.y * w, p.z - side.z * w], i * 6 + 3)
      this.alpha[i * 2] = this.alpha[i * 2 + 1] = k * k
    }
    ;(this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6))
  }
}

/** Ring buffer of flat quads laid on the ground (tyre marks while drifting). */
export class SkidMarks {
  readonly mesh: THREE.InstancedMesh
  private next = 0
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly s = new THREE.Vector3()
  private readonly mid = new THREE.Vector3()
  private readonly dir = new THREE.Vector3()

  constructor(private readonly max = 700, color: THREE.ColorRepresentation = '#3a1f2a') {
    const g = new THREE.PlaneGeometry(1, 1)
    g.rotateX(-Math.PI / 2)
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), max)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.mesh.renderOrder = 1
  }

  add(a: THREE.Vector3, b: THREE.Vector3, width = 0.32): void {
    this.dir.subVectors(b, a)
    const len = this.dir.length()
    if (len < 0.05 || len > 4) return
    this.mid.addVectors(a, b).multiplyScalar(0.5)
    this.mid.y += 0.04
    this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(this.dir.x, this.dir.z))
    this.s.set(width, 1, len + 0.05)
    this.m.compose(this.mid, this.q, this.s)
    this.mesh.setMatrixAt(this.next, this.m)
    this.next = (this.next + 1) % this.max
    this.mesh.count = Math.max(this.mesh.count, this.next === 0 ? this.max : this.next)
    this.mesh.instanceMatrix.needsUpdate = true
  }

  clear(): void {
    this.next = 0
    this.mesh.count = 0
  }
}
