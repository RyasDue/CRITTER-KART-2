/**
 * Unified input: keyboard, gamepad and touch all feed one action state plus three analog
 * driving axes. Gameplay reads `axes`, `held()` and `consume()`; it never checks raw keys.
 *
 * Driving: W/↑ throttle, S/↓ brake/reverse, A/D or ←/→ steer, Shift drift, Space item.
 * Gamepad: RT throttle, LT brake, left stick steer, RB/LB drift, X/Y item (A/B also drive).
 * Touch: on-screen stick + buttons call `setTouchSteer()` / `setTouchButton()`.
 */
export type Action = 'accelerate' | 'brake' | 'drift' | 'item' | 'pause' | 'confirm' | 'back' | 'lookBack' | 'camera'
export type InputMethod = 'keyboard' | 'gamepad' | 'touch'

const KEY_BINDINGS: Record<Action, string[]> = {
  accelerate: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  drift: ['ShiftLeft', 'ShiftRight'],
  item: ['Space', 'KeyE'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'NumpadEnter'],
  // Menus handle Escape/Backspace through DOM keydown; `back` is the gamepad B button.
  back: [],
  lookBack: ['KeyC'],
  camera: ['KeyV'],
}
const STEER_KEYS = { left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'] }
// Standard mapping: A=0 B=1 X=2 Y=3 LB=4 RB=5 LT=6 RT=7 Back=8 Start=9 L3=10 R3=11 D-pad 12..15.
const PAD_BINDINGS: Record<Action, number[]> = {
  accelerate: [7, 0],
  brake: [6, 1],
  drift: [5, 4],
  item: [2, 3],
  pause: [9],
  confirm: [0],
  back: [1],
  lookBack: [11],
  camera: [10],
}

export class Input {
  /** Driving axes: steer -1..1 (right +), throttle/brake 0..1. */
  readonly axes = { steer: 0, throttle: 0, brake: 0 }
  /** Menu navigation vector in [-1, 1] (x right, y up). */
  readonly move = { x: 0, y: 0 }
  method: InputMethod = 'keyboard'
  /** Touch play accelerates automatically (setting). */
  autoThrottle = true
  private keys = new Set<string>()
  private held_ = new Set<Action>()
  private pressed_ = new Set<Action>()
  private touchSteer = 0
  private touchButtons = new Set<Action>()
  private padPrev = new Set<Action>()
  private listeners: Array<() => void> = []

  constructor() {
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(type, fn as EventListener)
      this.listeners.push(() => window.removeEventListener(type, fn as EventListener))
    }
    on('keydown', e => {
      const typing = (e.target as HTMLElement | null)?.matches?.('input, textarea')
      if (typing) return
      if (!e.repeat) {
        this.keys.add(e.code)
        this.method = 'keyboard'
        for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) {
          if (codes.includes(e.code)) this.pressed_.add(action)
        }
      }
      if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault()
    })
    on('keyup', e => this.keys.delete(e.code))
    on('blur', () => this.keys.clear())
  }

  /** Touch controls: steer from the on-screen stick. */
  setTouchSteer(x: number): void {
    this.method = 'touch'
    this.touchSteer = Math.max(-1, Math.min(1, x))
  }

  setTouchButton(action: Action, down: boolean): void {
    this.method = 'touch'
    if (down && !this.touchButtons.has(action)) this.pressed_.add(action)
    if (down) this.touchButtons.add(action)
    else this.touchButtons.delete(action)
  }

  /** Sample continuous sources. Call once per rendered frame before gameplay reads input. */
  update(): void {
    const k = (codes: string[]) => codes.some(code => this.keys.has(code))
    let steer = (k(STEER_KEYS.right) ? 1 : 0) - (k(STEER_KEYS.left) ? 1 : 0)
    let throttle = k(KEY_BINDINGS.accelerate) ? 1 : 0
    let brake = k(KEY_BINDINGS.brake) ? 1 : 0
    let mx = steer
    let my = throttle - brake
    this.held_.clear()
    for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) {
      if (k(codes)) this.held_.add(action)
    }
    for (const action of this.touchButtons) this.held_.add(action)
    if (this.method === 'touch') {
      steer = this.touchSteer
      mx = this.touchSteer
      throttle = this.touchButtons.has('brake') ? 0 : this.autoThrottle || this.touchButtons.has('accelerate') ? 1 : 0
      brake = this.touchButtons.has('brake') ? 1 : 0
    }

    const pad = navigator.getGamepads?.().find(p => p && p.connected)
    if (pad) {
      const dead = (v: number, d = 0.16) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d))
      const lx = dead(pad.axes[0] ?? 0)
      const ly = dead(pad.axes[1] ?? 0)
      const rt = pad.buttons[7]?.value ?? 0
      const lt = pad.buttons[6]?.value ?? 0
      const dpadX = (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0)
      const dpadY = (pad.buttons[12]?.pressed ? 1 : 0) - (pad.buttons[13]?.pressed ? 1 : 0)
      const active = lx !== 0 || ly !== 0 || rt > 0.05 || lt > 0.05 || pad.buttons.some(b => b.pressed)
      if (active) this.method = 'gamepad'
      if (this.method === 'gamepad') {
        steer = lx || dpadX
        throttle = Math.max(rt > 0.05 ? rt : 0, pad.buttons[0]?.pressed ? 1 : 0)
        brake = Math.max(lt > 0.05 ? lt : 0, pad.buttons[1]?.pressed ? 1 : 0)
        mx = lx || dpadX
        my = -ly || dpadY
      }
      const now = new Set<Action>()
      for (const [action, buttons] of Object.entries(PAD_BINDINGS) as [Action, number[]][]) {
        if (buttons.some(i => pad.buttons[i]?.pressed)) now.add(action)
      }
      for (const action of now) {
        this.held_.add(action)
        if (!this.padPrev.has(action)) this.pressed_.add(action)
      }
      this.padPrev = now
    }
    this.axes.steer = Math.max(-1, Math.min(1, steer))
    this.axes.throttle = Math.max(0, Math.min(1, throttle))
    this.axes.brake = Math.max(0, Math.min(1, brake))
    this.move.x = mx
    this.move.y = my
  }

  held(action: Action): boolean {
    return this.held_.has(action)
  }

  pressed(action: Action): boolean {
    return this.pressed_.has(action)
  }

  /** Read and clear a press (use inside fixed simulation steps). */
  consume(action: Action): boolean {
    return this.pressed_.delete(action)
  }

  clearPresses(): void {
    this.pressed_.clear()
  }

  /** Gamepad rumble where supported (Chrome/Edge dual-rumble). */
  rumble(strong: number, weak: number, ms: number): void {
    if (this.method !== 'gamepad') return
    const pad = navigator.getGamepads?.().find(p => p && p.connected) as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | undefined
    pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) })?.catch?.(() => undefined)
  }

  dispose(): void {
    for (const off of this.listeners) off()
    this.listeners = []
  }
}
