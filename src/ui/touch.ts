import type { Action, Input } from '../engine/input'
import type { I18n } from '../engine/i18n'

/**
 * Landscape touch controls: a horizontal steering stick on the left and DRIFT / ITEM / BRAKE
 * buttons on the right. Everything feeds the unified Input so gameplay code is unaware of touch.
 * No gyro or other phone-only APIs.
 */
export class TouchControls {
  private readonly el: HTMLElement
  private readonly knob: HTMLElement
  private stickId = -1
  private stickX = 0
  private stickCenter = 0

  constructor(root: HTMLElement, private readonly input: Input, private readonly i18n: I18n, private readonly active: () => boolean) {
    this.el = document.createElement('div')
    this.el.className = 'touch'
    this.el.innerHTML = `
      <div class="stick" data-stick><div class="stick-track"><span>◀</span><span>▶</span></div><div class="stick-knob" data-knob></div></div><div class="dpad"><button class="tbtn tbtn-up" data-a="accelerate">▲</button><button class="tbtn tbtn-down" data-a="brake">▼</button><button class="tbtn tbtn-left" data-a="steerLeft">◀</button><button class="tbtn tbtn-right" data-a="steerRight">▶</button></div>
      <div class="tbtns">
        <button class="tbtn tbtn-item" data-a="item"><span data-l="touch.item"></span></button>
        <button class="tbtn tbtn-brake" data-a="brake"><span data-l="touch.brake"></span></button>
        <button class="tbtn tbtn-drift" data-a="drift"><span data-l="touch.drift"></span></button><button class="tbtn tbtn-camera" data-a="camera"><span data-l="touch.camera"></span></button>
      </div>`
    root.appendChild(this.el)
    this.knob = this.el.querySelector('[data-knob]')!
    const stick = this.el.querySelector<HTMLElement>('[data-stick]')!
    stick.addEventListener('pointerdown', e => {
      e.preventDefault()
      this.stickId = e.pointerId
      stick.setPointerCapture(e.pointerId)
      const r = stick.getBoundingClientRect()
      this.stickCenter = r.left + r.width / 2
      this.moveStick(e.clientX, r.width)
    })
    stick.addEventListener('pointermove', e => {
      if (e.pointerId !== this.stickId) return
      this.moveStick(e.clientX, stick.getBoundingClientRect().width)
    })
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return
      this.stickId = -1
      this.stickX = 0
      this.input.setTouchSteer(0)
      this.knob.style.transform = 'translate(-50%, -50%)'
    }
    stick.addEventListener('pointerup', release)
    stick.addEventListener('pointercancel', release)
    for (const btn of this.el.querySelectorAll<HTMLElement>('[data-a]')) {
      const action = btn.dataset.a ?? ''
      const down = (e: PointerEvent) => {
        e.preventDefault()
        btn.setPointerCapture(e.pointerId)
        btn.classList.add('down')
        if (action === 'steerLeft') this.input.setTouchSteer(-1); else if (action === 'steerRight') this.input.setTouchSteer(1); else this.input.setTouchButton(action as Action, true)
      }
      const up = () => {
        btn.classList.remove('down')
        if (action === 'steerLeft' || action === 'steerRight') this.input.setTouchSteer(0); else this.input.setTouchButton(action as Action, false)
      }
      btn.addEventListener('pointerdown', down)
      btn.addEventListener('pointerup', up)
      btn.addEventListener('pointercancel', up)
      btn.addEventListener('contextmenu', e => e.preventDefault())
    }
    this.relabel()
    i18n.onChange(() => this.relabel())
    const coarse = matchMedia('(pointer: coarse)')
    const mark = () => document.body.classList.toggle('touch-device', coarse.matches || this.input.method === 'touch')
    mark()
    coarse.addEventListener?.('change', mark)
    window.addEventListener('touchstart', () => document.body.classList.add('touch-device'), { passive: true })
    const tick = () => {
      this.el.classList.toggle('on', this.active())
      requestAnimationFrame(tick)
    }
    tick()
  }

  private relabel(): void {
    for (const el of this.el.querySelectorAll<HTMLElement>('[data-l]')) el.textContent = this.i18n.t(el.dataset.l!)
  }

  private moveStick(clientX: number, width: number): void {
    const half = width / 2 - 20
    const dx = Math.max(-half, Math.min(half, clientX - this.stickCenter))
    // Small dead zone, then a slightly eased response for fine corrections.
    const raw = dx / half
    const mag = Math.max(0, Math.abs(raw) - 0.08) / 0.92
    this.stickX = Math.sign(raw) * Math.pow(mag, 1.25)
    this.input.setTouchSteer(this.stickX)
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), -50%)`
  }
}
