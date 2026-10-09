import type { Audio } from '../engine/audio'
import type { I18n } from '../engine/i18n'
import type { Input } from '../engine/input'
import { insertEntry, type Locale, type Quality, type SaveData, type SaveStore } from '../engine/save'
import { ROSTER, characterById } from '../game/characters'
import { ITEM_KINDS, RACE_LEVELS, ROUTES, type ItemKind } from '../game/config'
import type { Hint, HudState, RaceResult } from '../game/game'
import { formatTime, ordinalSuffix } from '../game/rules'
import { ICON, ITEM_ICONS, PAD_GLYPH, keyCap } from './icons'

export type Screen = 'boot' | 'title' | 'select' | 'hud' | 'pause' | 'settings' | 'leaderboard' | 'results'

export type UiActions = {
  race(): void
  selectChanged(id: string): void
  startRace(id: string, route: number, level: number): void
  backToTitle(): void
  resume(): void
  restart(): void
  quit(): void
  again(): void
  change(): void
  skipIntro(): void
  settings(patch: Partial<SaveData>): void
}

type Outline = { main: [number, number][]; short: [number, number][] }

const h = (html: string): HTMLElement => {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild as HTMLElement
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export class Ui {
  screen: Screen = 'boot'
  private readonly root: HTMLElement
  private readonly screens = new Map<Screen, HTMLElement>()
  private portraits = new Map<string, string>()
  private selected: string
  private selectedRoute = 0
  private selectedLevel = 0
  private settingsReturn: Screen = 'title'
  private outline?: Outline
  private mapBounds = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }
  private mapCanvas!: HTMLCanvasElement
  private mapBase?: HTMLCanvasElement
  private navCooldown = 0
  private rouletteTimer = 0
  private rouletteIndex = 0
  private lastPlace = 0
  private hintKey: Hint = 'none'
  private toastTimer = 0
  private result?: RaceResult
  private resultSaved = false
  private tutorialShown = false
  private lastHud?: HudState

  constructor(
    root: HTMLElement,
    private readonly i18n: I18n,
    private readonly save: SaveStore,
    private readonly audio: Audio,
    private readonly input: Input,
    private readonly actions: UiActions,
  ) {
    this.root = root
    this.selected = characterById(save.data.character).id
    this.build()
    i18n.onChange(() => this.relabel())
    window.addEventListener('keydown', e => this.onKey(e))
    this.root.addEventListener('pointerover', e => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-nav]')
      if (el && el !== document.activeElement && this.current().contains(el) && !(el instanceof HTMLInputElement && el.type === 'text')) el.focus({ preventScroll: true })
    })
  }

  private t(key: string, vars?: Record<string, string | number>): string {
    return this.i18n.t(key, vars)
  }

  // ─── structure ───────────────────────────────────────────────────

  private build(): void {
    this.root.innerHTML = ''
    const add = (name: Screen, el: HTMLElement) => {
      el.classList.add('screen', `screen-${name}`)
      el.dataset.screen = name
      this.screens.set(name, el)
      this.root.appendChild(el)
    }
    add('boot', h(`<section><div class="logo boot-logo"><span class="logo-main" data-i18n="game.title"></span></div><div class="boot-bar"><i></i></div><p class="boot-label" data-i18n="boot.loading"></p></section>`))
    add(
      'title',
      h(`<section>
        <div class="title-wrap">
          <div class="logo"><span class="logo-kicker" data-i18n="game.subtitle"></span><span class="logo-main" data-i18n="game.title"></span><span class="logo-sub">DRIFT KART TR</span></div>
          <p class="tagline" data-i18n="game.tagline"></p>
          <nav class="menu">
            <button class="btn btn-primary btn-big" data-nav data-act="race">${ICON.flag}<span data-i18n="menu.race"></span></button>
            <button class="btn" data-nav data-act="leaderboard">${ICON.trophy}<span data-i18n="menu.leaderboard"></span></button>
            <button class="btn" data-nav data-act="settings">${ICON.gear}<span data-i18n="menu.settings"></span></button>
          </nav>
          <p class="best" data-best></p>
        </div>
        <footer class="prompts" data-prompts></footer>
        <p class="credits" data-i18n="credits.fonts"></p>
      </section>`),
    )
    add(
      'select',
      h(`<section>
        <div class="select-left panel">
          <h2 class="panel-title" data-i18n="select.title"></h2>
          <div class="cards" data-cards></div>
          <div class="race-options"><label><span data-i18n="select.route"></span><select data-route data-nav>${ROUTES.map((r, i) => `<option value="${i}">${r.label}</option>`).join('')}</select></label><label><span data-i18n="select.level"></span><select data-level data-nav>${RACE_LEVELS.map((r, i) => `<option value="${i}">${r.label}</option>`).join('')}</select></label></div><p class="select-hint" data-select-hint></p>
        </div>
        <div class="select-info panel" data-info></div>
        <div class="select-actions">
          <button class="btn" data-nav data-act="back"><span data-i18n="menu.back"></span></button>
          <button class="btn btn-primary btn-big" data-nav data-act="start">${ICON.flag}<span data-i18n="menu.start"></span></button>
        </div>
      </section>`),
    )
    add(
      'hud',
      h(`<section>
        <div class="speedlines" data-speedlines></div>
        <div class="vignette" data-vignette></div>
        <div class="hud-tl">
          <div class="place" data-place><b data-place-num>1</b><span data-place-suf></span></div>
          <div class="lapbox"><span class="lap-label" data-i18n="hud.lap"></span><b data-lap>1/3</b></div>
          <div class="timebox" data-time>0:00.00</div>
        </div>
        <div class="hud-tr">
          <div class="itemslot" data-itemslot><div class="item-icon" data-item-icon></div></div>
          <div class="item-name" data-item-name></div>
          <div class="item-key" data-item-key></div>
        </div>
        <button class="pausebtn" data-act="pause" aria-label="pause">${ICON.pause}</button>
        <div class="hud-bl"><canvas class="minimap" data-minimap width="220" height="220"></canvas></div>
        <div class="hud-br"><b data-speed>0</b><span>km/h</span></div>
        <div class="drift" data-drift><i></i><i></i><i></i></div>
        <div class="warn" data-warn></div>
        <div class="center"><div class="count" data-count></div><div class="banner" data-banner></div></div>
        <div class="toast" data-toast></div>
        <div class="hint" data-hint></div>
        <div class="tutorial panel" data-tutorial></div>
        <div class="skip" data-skip></div>
      </section>`),
    )
    add(
      'pause',
      h(`<section><div class="panel modal">
        <h2 class="panel-title big" data-i18n="menu.paused"></h2>
        <nav class="menu">
          <button class="btn btn-primary" data-nav data-act="resume"><span data-i18n="menu.resume"></span></button>
          <button class="btn" data-nav data-act="restart"><span data-i18n="menu.restart"></span></button>
          <button class="btn" data-nav data-act="settings"><span data-i18n="menu.settings"></span></button>
          <button class="btn" data-nav data-act="quit"><span data-i18n="menu.quit"></span></button>
        </nav></div></section>`),
    )
    add('settings', h(`<section><div class="panel modal wide" data-settings></div></section>`))
    add('leaderboard', h(`<section><div class="panel modal wide"><h2 class="panel-title" data-i18n="board.title"></h2><div data-board></div><div class="modal-actions"><button class="btn" data-nav data-act="back"><span data-i18n="menu.back"></span></button></div></div></section>`))
    add('results', h(`<section><div class="results" data-results></div></section>`))
    this.root.appendChild(h(`<div class="rotate"><div class="panel"><h2 class="panel-title" data-i18n="rotate.title"></h2><p data-i18n="rotate.body"></p></div></div>`))

    this.root.addEventListener('click', e => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')
      if (!el) return
      this.audio.unlock()
      this.act(el.dataset.act!, el)
    })
    this.mapCanvas = this.q('hud', '[data-minimap]') as HTMLCanvasElement
    this.buildCards()
    this.buildSettings()
    this.relabel()
  }

  private q(screen: Screen, sel: string): HTMLElement {
    return this.screens.get(screen)!.querySelector(sel) as HTMLElement
  }

  private current(): HTMLElement {
    return this.screens.get(this.screen)!
  }

  private act(name: string, el: HTMLElement): void {
    const sfx = name === 'back' ? 'uiBack' : 'uiSelect'
    switch (name) {
      case 'race':
        this.audio.play(sfx)
        this.actions.race()
        break
      case 'leaderboard':
        this.audio.play(sfx)
        this.renderBoard()
        this.show('leaderboard')
        break
      case 'settings':
        this.audio.play(sfx)
        this.settingsReturn = this.screen
        this.show('settings')
        break
      case 'back':
        this.audio.play(sfx)
        this.back()
        break
      case 'start':
        this.audio.play('go')
        this.actions.startRace(this.selected, this.selectedRoute, this.selectedLevel)
        break
      case 'pick':
        this.pick(el.dataset.id!)
        break
      case 'resume':
        this.audio.play(sfx)
        this.actions.resume()
        break
      case 'restart':
        this.audio.play(sfx)
        this.actions.restart()
        break
      case 'quit':
        this.audio.play('uiBack')
        this.actions.quit()
        break
      case 'again':
        this.audio.play(sfx)
        this.actions.again()
        break
      case 'change':
        this.audio.play(sfx)
        this.actions.change()
        break
      case 'title':
        this.audio.play('uiBack')
        this.actions.quit()
        break
      case 'pause':
        window.dispatchEvent(new Event('game:pause'))
        break
      case 'save-name':
        this.saveResult()
        break
      case 'skip':
        this.actions.skipIntro()
        break
    }
  }

  private back(): void {
    switch (this.screen) {
      case 'settings':
        this.show(this.settingsReturn)
        break
      case 'leaderboard':
        this.show('title')
        break
      case 'select':
        this.actions.backToTitle()
        break
      case 'pause':
        this.actions.resume()
        break
    }
  }

  show(screen: Screen): void {
    this.screen = screen
    for (const [name, el] of this.screens) el.classList.toggle('active', name === screen)
    document.body.dataset.screen = screen
    if (screen === 'title') this.refreshTitle()
    if (screen === 'settings') this.refreshSettings()
    if (screen === 'select') this.pick(this.selected, true)
    if (screen === 'hud') {
      this.lastPlace = 0
      this.q('hud', '[data-banner]').className = 'banner'
    }
    requestAnimationFrame(() => {
      const first = this.current().querySelector<HTMLElement>('.btn-primary[data-nav], [data-nav]')
      if (screen !== 'hud' && first && !(first instanceof HTMLInputElement)) first.focus({ preventScroll: true })
      if (screen === 'select') this.current().querySelector<HTMLElement>(`[data-id="${this.selected}"]`)?.focus({ preventScroll: true })
    })
  }

  setBootProgress(p: number): void {
    ;(this.q('boot', '.boot-bar i') as HTMLElement).style.width = `${Math.round(p * 100)}%`
  }

  setPortraits(map: Map<string, string>): void {
    this.portraits = map
    this.buildCards()
  }

  setTrackOutline(outline: Outline): void {
    this.outline = outline
    const all = [...outline.main, ...outline.short]
    const xs = all.map(p => p[0])
    const zs = all.map(p => p[1])
    this.mapBounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
    this.mapBase = undefined
  }

  // ─── labels ──────────────────────────────────────────────────────

  private relabel(): void {
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = this.t(el.dataset.i18n!)
    document.title = `${this.t('game.title')} · Drift Kart TR`
    this.buildCards()
    this.buildSettings()
    this.refreshTitle()
    if (this.screen === 'select') this.pick(this.selected, true)
    if (this.screen === 'leaderboard') this.renderBoard()
    if (this.screen === 'results' && this.result) this.renderResults(this.result)
    this.prompts()
    this.hintKey !== 'none' && this.hint(this.hintKey)
  }

  private refreshTitle(): void {
    const best = this.save.data.leaderboard[0]
    const el = this.q('title', '[data-best]')
    el.textContent = best ? this.t('menu.best', { time: formatTime(best.time) }) : ''
    this.prompts()
  }

  private prompts(): void {
    const m = this.input.method
    const ok = m === 'gamepad' ? PAD_GLYPH.A : keyCap('Enter', true)
    const back = m === 'gamepad' ? PAD_GLYPH.B : keyCap('Esc', true)
    const html = m === 'touch' ? '' : `<span>${ok} ${esc(this.t('prompt.select'))}</span><span>${back} ${esc(this.t('prompt.back'))}</span>`
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-prompts]')) el.innerHTML = html
    const hint = this.screens.get('select')?.querySelector<HTMLElement>('[data-select-hint]')
    if (hint) hint.innerHTML = m === 'touch' ? '' : this.t('select.hint', { prev: m === 'gamepad' ? '◀' : keyCap('←'), next: m === 'gamepad' ? '▶' : keyCap('→'), ok })
  }

  // ─── character select ────────────────────────────────────────────

  private buildCards(): void {
    const wrap = this.screens.get('select')?.querySelector<HTMLElement>('[data-cards]')
    if (!wrap) return
    wrap.innerHTML = ROSTER.map(c => {
      const img = this.portraits.get(c.id)
      return `<button class="card${c.id === this.selected ? ' on' : ''}" data-nav data-act="pick" data-id="${c.id}" style="--c:${c.ui}">
        <span class="card-art">${img ? `<img src="${img}" alt="">` : ''}</span>
        <span class="card-name">${esc(this.t(`char.${c.id}.name`))}</span>
      </button>`
    }).join('')
    wrap.querySelectorAll<HTMLElement>('.card').forEach(card => card.addEventListener('focus', () => this.pick(card.dataset.id!)))
  }

  private pick(id: string, force = false): void {
    if (id === this.selected && !force) return
    if (id !== this.selected) this.audio.play('uiMove')
    this.selected = id
    const c = characterById(id)
    this.screens.get('select')!.querySelectorAll<HTMLElement>('.card').forEach(el => el.classList.toggle('on', el.dataset.id === id))
    const bar = (key: string, v: number) => `<div class="stat"><span>${esc(this.t(key))}</span><div class="pips">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= v ? 'on' : ''}"></i>`).join('')}</div></div>`
    this.q('select', '[data-info]').innerHTML = `
      <div class="info-head" style="--c:${c.ui}"><h3>${esc(this.t(`char.${id}.name`))}</h3><span class="tag">${esc(this.t(`char.${id}.species`))}</span></div>
      <p class="blurb">${esc(this.t(`char.${id}.blurb`))}</p>
      ${bar('stat.speed', c.stats.speed)}${bar('stat.accel', c.stats.accel)}${bar('stat.handling', c.stats.handling)}${bar('stat.weight', c.stats.weight)}`
    this.save.update({ character: id })
    this.actions.selectChanged(id)
  }

  // ─── settings ────────────────────────────────────────────────────

  private buildSettings(): void {
    const el = this.screens.get('settings')?.querySelector<HTMLElement>('[data-settings]')
    if (!el) return
    const d = this.save.data
    const range = (key: keyof SaveData, label: string, min: number, max: number, step: number) =>
      `<label class="row"><span>${esc(this.t(label))}</span><input type="range" data-nav data-key="${key}" min="${min}" max="${max}" step="${step}" value="${d[key] as number}"><output>${fmtRange(key, d[key] as number)}</output></label>`
    const toggle = (key: keyof SaveData, label: string) => `<label class="row"><span>${esc(this.t(label))}</span><button class="switch${d[key] ? ' on' : ''}" data-nav data-toggle="${key}" role="switch" aria-checked="${!!d[key]}"><i></i></button></label>`
    const seg = (key: string, label: string, opts: [string, string][], value: string) =>
      `<div class="row"><span>${esc(label)}</span><div class="seg">${opts.map(([v, l]) => `<button class="opt${v === value ? ' on' : ''}" data-nav data-seg="${key}" data-v="${v}">${esc(l)}</button>`).join('')}</div></div>`
    el.innerHTML = `
      <h2 class="panel-title" data-i18n="settings.title">${esc(this.t('settings.title'))}</h2>
      <div class="settings-grid">
        <div><h4>${esc(this.t('settings.audio'))}</h4>
          ${range('musicVolume', 'settings.music', 0, 1, 0.05)}
          ${range('sfxVolume', 'settings.sfx', 0, 1, 0.05)}
          ${toggle('muted', 'settings.mute')}
          <h4>${esc(this.t('settings.controls'))}</h4>
          ${range('sensitivity', 'settings.sensitivity', 0.5, 2, 0.1)}
          ${toggle('autoGas', 'settings.autoGas')}
        </div>
        <div><h4>${esc(this.t('settings.display'))}</h4>
          ${seg('quality', this.t('settings.quality'), (['low', 'medium', 'high'] as Quality[]).map(q => [q, this.t(`settings.quality.${q}`)]), d.quality)}
          ${toggle('reducedMotion', 'settings.shake')}
          <h4>${esc(this.t('settings.language'))}</h4>
          ${seg('locale', this.t('settings.language'), [['tr', 'Türkçe'], ['en', 'English'], ['zh-CN', '中文']], this.i18n.locale)}
          <div class="row"><span>${esc(this.t('settings.tutorial'))}</span><button class="btn btn-small${d.tutorialDone ? '' : ' done'}" data-nav data-tutorial-reset>↺</button></div>
        </div>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" data-nav data-act="back"><span>${esc(this.t('menu.back'))}</span></button></div>`
    el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(inp =>
      inp.addEventListener('input', () => {
        const key = inp.dataset.key as keyof SaveData
        const v = Number(inp.value)
        inp.nextElementSibling!.textContent = fmtRange(key, v)
        this.actions.settings({ [key]: v } as Partial<SaveData>)
        if (key === 'sfxVolume') this.audio.play('uiMove')
      }),
    )
    el.querySelectorAll<HTMLElement>('[data-toggle]').forEach(btn =>
      btn.addEventListener('click', () => {
        const key = btn.dataset.toggle as keyof SaveData
        const v = !this.save.data[key]
        this.actions.settings({ [key]: v } as Partial<SaveData>)
        btn.classList.toggle('on', v)
        btn.setAttribute('aria-checked', String(v))
        this.audio.play('uiMove')
      }),
    )
    el.querySelectorAll<HTMLElement>('[data-seg]').forEach(btn =>
      btn.addEventListener('click', () => {
        const key = btn.dataset.seg!
        const v = btn.dataset.v!
        this.audio.play('uiMove')
        if (key === 'locale') this.actions.settings({ locale: v as Locale })
        else this.actions.settings({ quality: v as Quality })
        btn.parentElement!.querySelectorAll('.opt').forEach(o => o.classList.toggle('on', o === btn))
        if (key === 'locale') requestAnimationFrame(() => this.current().querySelector<HTMLElement>(`[data-seg="locale"][data-v="${v}"]`)?.focus())
      }),
    )
    this.screens.get('select')?.querySelector<HTMLSelectElement>('[data-route]')?.addEventListener('change', e => { this.selectedRoute = Number((e.target as HTMLSelectElement).value) })
    this.screens.get('select')?.querySelector<HTMLSelectElement>('[data-level]')?.addEventListener('change', e => { this.selectedLevel = Number((e.target as HTMLSelectElement).value) })
    el.querySelector<HTMLElement>('[data-tutorial-reset]')?.addEventListener('click', e => {
      this.actions.settings({ tutorialDone: false })
      ;(e.currentTarget as HTMLElement).classList.add('done')
      this.audio.play('uiSelect')
    })
  }

  refreshSettings(): void {
    const focused = document.activeElement as HTMLElement | null
    const sel = focused?.dataset.key ? `[data-key="${focused.dataset.key}"]` : focused?.dataset.toggle ? `[data-toggle="${focused.dataset.toggle}"]` : ''
    this.buildSettings()
    if (sel && this.screen === 'settings') this.current().querySelector<HTMLElement>(sel)?.focus()
  }

  // ─── leaderboard ─────────────────────────────────────────────────

  private renderBoard(): void {
    const board = this.save.data.leaderboard
    const el = this.q('leaderboard', '[data-board]')
    if (!board.length) {
      el.innerHTML = `<p class="empty">${esc(this.t('board.empty'))}</p>`
      return
    }
    el.innerHTML = `<table class="table"><thead><tr><th>${esc(this.t('board.rank'))}</th><th>${esc(this.t('board.name'))}</th><th>${esc(this.t('board.place'))}</th><th>${esc(this.t('board.time'))}</th></tr></thead><tbody>${board
      .map((e, i) => `<tr class="${i < 3 ? `top top${i + 1}` : ''}"><td class="rank">${i + 1}</td><td class="who">${this.avatar(e.character)}<span>${esc(e.name)}</span></td><td>${esc(this.placeText(e.place))}</td><td class="mono">${formatTime(e.time)}</td></tr>`)
      .join('')}</tbody></table>`
  }

  private avatar(id: string): string {
    const img = this.portraits.get(id)
    const c = characterById(id)
    return `<span class="avatar" style="--c:${c.ui}">${img ? `<img src="${img}" alt="">` : ''}</span>`
  }

  private placeText(place: number): string {
    return this.t(`hud.place.${place}`)
  }

  // ─── results ─────────────────────────────────────────────────────

  showResults(result: RaceResult): void {
    this.result = result
    this.resultSaved = false
    this.renderResults(result)
    this.show('results')
    requestAnimationFrame(() => this.current().querySelector<HTMLElement>('[data-act="again"]')?.focus())
  }

  private renderResults(r: RaceResult): void {
    const head = r.place === 1 ? this.t('results.win') : r.place <= 3 ? this.t('results.podium') : this.t('results.place', { place: this.placeText(r.place) })
    const el = this.q('results', '[data-results]')
    const rows = r.rows
      .map(
        (row, i) =>
          `<li class="${row.me ? 'me' : ''}" style="--i:${i};--c:${characterById(row.character).ui}"><b class="pos p${row.place}">${row.place}</b>${this.avatar(row.character)}<span class="nm">${esc(this.t(`char.${row.character}.name`))}${row.me ? ` <em>${esc(this.save.data.playerName)}</em>` : ''}</span><span class="mono">${row.estimated ? `<small>${esc(this.t('results.estimated'))}</small> ` : ''}${formatTime(row.time)}</span></li>`,
      )
      .join('')
    el.innerHTML = `
      <div class="panel res-main place-${Math.min(4, r.place)}">
        <div class="res-badge"><b>${r.place}</b><span>${esc(this.i18n.locale === 'en' ? ordinalSuffix(r.place) : '')}</span></div>
        <h2 class="res-head">${esc(head)}</h2>
        <div class="res-stats"><div><span>${esc(this.t('results.time'))}</span><b class="mono">${formatTime(r.time)}</b></div><div><span>${esc(this.t('results.bestLap'))}</span><b class="mono">${r.bestLap ? formatTime(r.bestLap) : '—'}</b></div></div>
        <div class="res-save" data-save>
          <label><span>${esc(this.t('results.name'))}</span><input type="text" maxlength="16" data-nav data-name value="${esc(this.save.data.playerName)}"></label>
          <button class="btn btn-small" data-nav data-act="save-name">${esc(this.t('results.save'))}</button>
        </div>
        <p class="res-rank" data-rank></p>
        <div class="res-actions">
          <button class="btn btn-primary" data-nav data-act="again"><span>${esc(this.t('menu.again'))}</span></button>
          <button class="btn" data-nav data-act="change"><span>${esc(this.t('menu.change'))}</span></button>
          <button class="btn" data-nav data-act="title"><span>${esc(this.t('menu.title'))}</span></button>
        </div>
      </div>
      <div class="panel res-table"><h3 class="panel-title">${esc(this.t('results.title'))}</h3><ol>${rows}</ol></div>`
    const name = el.querySelector<HTMLInputElement>('[data-name]')!
    name.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.saveResult()
      }
      e.stopPropagation()
    })
    if (this.resultSaved) this.markSaved()
  }

  private saveResult(): void {
    if (!this.result || this.resultSaved) return
    const input = this.current().querySelector<HTMLInputElement>('[data-name]')
    const name = (input?.value.trim() || 'PLAYER').slice(0, 16)
    const r = this.result
    const { board, rank } = insertEntry(this.save.data.leaderboard, { name, character: r.character, time: r.time, place: r.place, bestLap: r.bestLap, at: Date.now() })
    this.save.update({ leaderboard: board, playerName: name })
    this.resultSaved = true
    this.savedRank = rank
    this.audio.play(rank >= 0 ? 'lap' : 'uiSelect')
    this.markSaved()
    this.current().querySelector<HTMLElement>('[data-act="again"]')?.focus()
  }

  private savedRank = -1

  private markSaved(): void {
    const box = this.current().querySelector<HTMLElement>('[data-save]')
    if (box) box.innerHTML = `<span class="saved">✓ ${esc(this.t('results.saved'))}</span>`
    const rank = this.current().querySelector<HTMLElement>('[data-rank]')
    if (rank) rank.textContent = this.savedRank >= 0 ? this.t('results.rank', { rank: this.savedRank + 1 }) : this.t('results.norank')
  }

  // ─── HUD ─────────────────────────────────────────────────────────

  updateHud(s: HudState, dt: number): void {
    this.lastHud = s
    const scr = this.screens.get('hud')!
    // Place.
    if (s.place !== this.lastPlace) {
      const num = this.q('hud', '[data-place-num]')
      const suf = this.q('hud', '[data-place-suf]')
      num.textContent = String(s.place)
      suf.textContent = this.i18n.locale === 'en' ? ordinalSuffix(s.place) : '名'
      const place = this.q('hud', '[data-place]')
      place.dataset.p = String(Math.min(4, s.place))
      place.classList.toggle('zh', this.i18n.locale !== 'en')
      if (this.lastPlace) retrigger(place, 'pop')
      this.lastPlace = s.place
    }
    this.q('hud', '[data-lap]').textContent = `${s.lap}/${s.laps}`
    this.q('hud', '[data-time]').textContent = formatTime(s.time)
    this.q('hud', '[data-speed]').textContent = String(Math.round(s.speed * 3.6))
    // Item slot + roulette.
    const slot = this.q('hud', '[data-itemslot]')
    const icon = this.q('hud', '[data-item-icon]')
    const name = this.q('hud', '[data-item-name]')
    const key = this.q('hud', '[data-item-key]')
    if (s.rolling) {
      this.rouletteTimer -= dt
      if (this.rouletteTimer <= 0) {
        this.rouletteTimer = 0.07
        this.rouletteIndex = (this.rouletteIndex + 1) % ITEM_KINDS.length
        icon.innerHTML = ITEM_ICONS[ITEM_KINDS[this.rouletteIndex]]
        this.audio.play('tick')
      }
      slot.className = 'itemslot rolling'
      name.textContent = ''
      key.innerHTML = ''
    } else if (s.item) {
      if (slot.dataset.item !== s.item || !slot.classList.contains('ready')) {
        icon.innerHTML = ITEM_ICONS[s.item]
        slot.className = 'itemslot ready'
        retrigger(slot, 'pop')
        name.textContent = this.t(`item.${s.item}`)
      }
      key.innerHTML = this.input.method === 'touch' ? '' : this.t('hud.useItem', { key: this.input.method === 'gamepad' ? PAD_GLYPH.X : keyCap('Space', true) })
    } else if (slot.dataset.item || slot.classList.contains('ready') || slot.classList.contains('rolling')) {
      icon.innerHTML = ''
      slot.className = 'itemslot'
      name.textContent = ''
      key.innerHTML = ''
    }
    slot.dataset.item = s.rolling ? '' : (s.item ?? '')
    slot.classList.toggle('shielded', s.shield > 0)
    // Drift meter.
    const drift = this.q('hud', '[data-drift]')
    drift.classList.toggle('on', s.drifting)
    drift.dataset.tier = String(s.driftTier)
    const bars = drift.querySelectorAll<HTMLElement>('i')
    bars.forEach((b, i) => b.style.setProperty('--f', String(Math.max(0, Math.min(1, s.driftCharge - i)))))
    // Speed lines + warnings.
    const lines = this.q('hud', '[data-speedlines]')
    lines.style.opacity = s.boost ? '0.85' : s.speed > 26 ? String(Math.min(0.35, (s.speed - 26) / 20)) : '0'
    const warn = this.q('hud', '[data-warn]')
    const w = s.wrongWay ? this.t('hud.wrongWay') : s.beeWarning ? this.t('hud.beeWarning') : ''
    if (warn.textContent !== w) warn.textContent = w
    warn.classList.toggle('on', !!w)
    warn.classList.toggle('bee', !s.wrongWay && s.beeWarning)
    // Tutorial card during the intro/countdown.
    const tut = this.q('hud', '[data-tutorial]')
    const showTut = this.tutorialShown && (s.phase === 'intro' || s.phase === 'countdown')
    tut.classList.toggle('on', showTut)
    const skip = this.q('hud', '[data-skip]')
    const skipOn = s.phase === 'intro'
    skip.classList.toggle('on', skipOn)
    if (skipOn && !skip.innerHTML) skip.innerHTML = `<button class="btn btn-small" data-act="skip">${this.t('hint.skip', { ok: this.input.method === 'gamepad' ? PAD_GLYPH.A : this.input.method === 'touch' ? '▶' : keyCap('Enter', true) })}</button>`
    if (!skipOn && skip.innerHTML) skip.innerHTML = ''
    // Toast timer.
    if (this.toastTimer > 0) {
      this.toastTimer -= dt
      if (this.toastTimer <= 0) this.q('hud', '[data-toast]').classList.remove('on')
    }
    this.drawMap(s)
    scr.classList.toggle('done', s.finished)
  }

  private drawMap(s: HudState): void {
    if (!this.outline) return
    const c = this.mapCanvas
    const W = c.width
    const pad = 16
    const b = this.mapBounds
    const scale = (W - pad * 2) / Math.max(b.maxX - b.minX, b.maxZ - b.minZ)
    const ox = pad + ((W - pad * 2) - (b.maxX - b.minX) * scale) / 2
    const oz = pad + ((W - pad * 2) - (b.maxZ - b.minZ) * scale) / 2
    // World +X points right on screen when looking from above with +Z down; flip X so the map matches the 3D view from the start.
    const px = (x: number) => W - (ox + (x - b.minX) * scale)
    const pz = (z: number) => oz + (z - b.minZ) * scale
    if (!this.mapBase) {
      const base = document.createElement('canvas')
      base.width = base.height = W
      const g = base.getContext('2d')!
      const path = (pts: [number, number][], close: boolean) => {
        g.beginPath()
        pts.forEach(([x, z], i) => (i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z))))
        if (close) g.closePath()
      }
      g.lineJoin = g.lineCap = 'round'
      for (const [pts, close, w1, w2, col] of [
        [this.outline.short, false, 11, 6, '#ffd1ec'],
        [this.outline.main, true, 15, 9, '#fff6ec'],
      ] as [[number, number][], boolean, number, number, string][]) {
        path(pts, close)
        g.strokeStyle = '#2b1633'
        g.lineWidth = w1
        g.stroke()
        g.strokeStyle = col
        g.lineWidth = w2
        g.stroke()
      }
      const [sx, sz] = this.outline.main[0]
      g.fillStyle = '#2b1633'
      g.fillRect(px(sx) - 7, pz(sz) - 2.5, 14, 5)
      g.fillStyle = '#fff'
      g.fillRect(px(sx) - 6, pz(sz) - 1.5, 5, 3)
      g.fillRect(px(sx) + 1, pz(sz) - 1.5, 5, 3)
      this.mapBase = base
    }
    const g = c.getContext('2d')!
    g.clearRect(0, 0, W, W)
    g.drawImage(this.mapBase, 0, 0)
    const dots = [...s.map].sort((a, b2) => Number(a.me) - Number(b2.me) || b2.place - a.place)
    for (const d of dots) {
      const r = d.me ? 8 : 6
      g.beginPath()
      g.arc(px(d.x), pz(d.z), r, 0, Math.PI * 2)
      g.fillStyle = d.color
      g.fill()
      g.lineWidth = d.me ? 3.5 : 2.5
      g.strokeStyle = d.me ? '#ffffff' : '#2b1633'
      g.stroke()
    }
  }

  countdown(n: number): void {
    const el = this.q('hud', '[data-count]')
    el.textContent = n > 0 ? String(n) : ''
    el.dataset.n = String(n)
    if (n > 0) retrigger(el, 'go')
  }

  banner(kind: 'lap' | 'final' | 'go' | 'finish' | 'wrong', vars: Record<string, string | number> = {}): void {
    const el = this.q('hud', '[data-banner]')
    const text = kind === 'go' ? this.t('hud.go') : kind === 'lap' ? this.t('hud.lapBanner', vars) : kind === 'final' ? this.t('hud.finalLap') : kind === 'finish' ? this.t('hud.finish') : this.t('hud.wrongWay')
    el.textContent = text
    el.className = `banner k-${kind}`
    retrigger(el, 'show')
  }

  toast(key: string, vars: Record<string, string | number> = {}): void {
    const v: Record<string, string | number> = {}
    for (const [k, val] of Object.entries(vars)) v[k] = typeof val === 'string' && val.startsWith('char.') ? this.t(val) : val
    const el = this.q('hud', '[data-toast]')
    el.textContent = this.t(key, v)
    retrigger(el, 'on')
    this.toastTimer = 1.6
  }

  hurt(kind: 'bee' | 'taffy' | 'blocked'): void {
    const v = this.q('hud', '[data-vignette]')
    v.dataset.kind = kind
    retrigger(v, 'on')
    if (kind === 'blocked') this.toast('toast.blocked')
  }

  placeChange(up: boolean): void {
    if (up) this.toast('toast.overtake')
  }

  itemReady(_kind: ItemKind): void {
    // The slot pop animation already signals it.
  }

  hint(hint: Hint): void {
    this.hintKey = hint
    const el = this.q('hud', '[data-hint]')
    if (hint === 'none') {
      el.classList.remove('on')
      return
    }
    const m = this.input.method
    const caps = {
      up: m === 'keyboard' ? `${keyCap('W')}/${keyCap('↑')}` : '',
      left: keyCap('A'),
      right: keyCap('D'),
      shift: keyCap('Shift', true),
      space: keyCap('Space', true),
      rt: PAD_GLYPH.RT,
      lt: PAD_GLYPH.LT,
      rb: PAD_GLYPH.RB,
      x: PAD_GLYPH.X,
      stick: PAD_GLYPH.LS,
    }
    const perMethod = hint === 'drive' || hint === 'drift' || hint === 'item'
    const key = perMethod ? `hint.${hint}.${m}` : `hint.${hint}`
    el.innerHTML = this.t(key, caps)
    retrigger(el, 'on')
  }

  /** First-run control card shown during the flyover/countdown. */
  showTutorial(on: boolean): void {
    this.tutorialShown = on
    if (!on) return
    const m = this.input.method
    const rows: [string, string][] =
      m === 'gamepad'
        ? [
            ['tutorial.steer', PAD_GLYPH.LS],
            ['tutorial.gas', PAD_GLYPH.RT],
            ['tutorial.brake', PAD_GLYPH.LT],
            ['tutorial.drift', PAD_GLYPH.RB],
            ['tutorial.item', PAD_GLYPH.X],
            ['tutorial.pause', PAD_GLYPH.START],
          ]
        : m === 'touch'
          ? [
              ['tutorial.steer', '<kbd class="cap wide">◀ ▶</kbd>'],
              ['tutorial.drift', `<kbd class="cap wide">${this.t('touch.drift')}</kbd>`],
              ['tutorial.item', `<kbd class="cap wide">${this.t('touch.item')}</kbd>`],
              ['tutorial.brake', `<kbd class="cap wide">${this.t('touch.brake')}</kbd>`],
            ]
          : [
              ['tutorial.steer', `${keyCap('A')}${keyCap('D')} / ${keyCap('←')}${keyCap('→')}`],
              ['tutorial.gas', `${keyCap('W')} / ${keyCap('↑')}`],
              ['tutorial.brake', `${keyCap('S')} / ${keyCap('↓')}`],
              ['tutorial.drift', keyCap('Shift', true)],
              ['tutorial.item', keyCap('Space', true)],
              ['tutorial.pause', keyCap('Esc', true)],
            ]
    this.q('hud', '[data-tutorial]').innerHTML = `<h3 class="panel-title">${esc(this.t('tutorial.title'))}</h3><ul>${rows.map(([k, v]) => `<li><span>${esc(this.t(k))}</span><span class="keys">${v}</span></li>`).join('')}</ul><p class="tip">${esc(this.t('tutorial.tip1'))}</p><p class="tip">${esc(this.t('tutorial.tip2'))}</p><p class="tip">${esc(this.t('hint.startBoost'))}</p>`
  }

  resetHud(): void {
    const hud = this.screens.get('hud')!
    for (const sel of ['[data-count]', '[data-banner]', '[data-toast]', '[data-hint]']) {
      const el = hud.querySelector<HTMLElement>(sel)!
      el.classList.remove('on', 'show', 'go')
      if (sel === '[data-count]') el.textContent = ''
    }
    this.hintKey = 'none'
    this.lastPlace = 0
    const slot = this.q('hud', '[data-itemslot]')
    slot.className = 'itemslot'
    slot.dataset.item = ''
    this.q('hud', '[data-item-icon]').innerHTML = ''
    this.q('hud', '[data-item-name]').textContent = ''
    hud.classList.remove('done')
  }

  // ─── navigation ──────────────────────────────────────────────────

  /** Per-frame: gamepad navigation for menus. */
  frame(dt: number): void {
    this.navCooldown -= dt
    if (this.screen === 'hud' || this.screen === 'boot') return
    const m = this.input.move
    if (Math.abs(m.x) < 0.5 && Math.abs(m.y) < 0.5) this.navCooldown = Math.min(this.navCooldown, 0)
    if (this.navCooldown <= 0 && this.input.method === 'gamepad') {
      if (m.y > 0.6) this.nav('up')
      else if (m.y < -0.6) this.nav('down')
      else if (m.x > 0.6) this.nav('right')
      else if (m.x < -0.6) this.nav('left')
      else return this.padButtons()
      this.navCooldown = 0.2
    }
    this.padButtons()
  }

  private padButtons(): void {
    if (this.input.method !== 'gamepad') return
    if (this.input.consume('confirm')) {
      const el = document.activeElement as HTMLElement | null
      if (el && this.current().contains(el)) el.click()
    }
    if (this.input.consume('back')) this.back()
    if (this.screen === 'pause' && this.input.consume('pause')) this.actions.resume()
  }

  private onKey(e: KeyboardEvent): void {
    if (this.screen === 'hud' || this.screen === 'boot') return
    const target = e.target as HTMLElement
    const typing = target instanceof HTMLInputElement && target.type === 'text'
    if (e.key === 'Escape' || (e.key === 'Backspace' && !typing)) {
      if (this.screen === 'pause') return // main handles pause toggle
      e.preventDefault()
      this.back()
      return
    }
    if (typing) return
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' }[e.code] as 'up' | 'down' | 'left' | 'right' | undefined
    if (dir) {
      e.preventDefault()
      this.nav(dir)
    }
    if ((e.code === 'Space' || e.code === 'Enter') && target?.matches?.('[data-nav]')) {
      e.preventDefault()
      target.click()
    }
  }

  private nav(dir: 'up' | 'down' | 'left' | 'right'): void {
    const scr = this.current()
    const items = [...scr.querySelectorAll<HTMLElement>('[data-nav]')].filter(el => el.offsetParent !== null)
    if (!items.length) return
    const active = document.activeElement as HTMLElement
    const idx = items.indexOf(active)
    if (idx < 0) {
      items[0].focus()
      return
    }
    // Sliders and segmented options consume left/right.
    if ((dir === 'left' || dir === 'right') && active instanceof HTMLInputElement && active.type === 'range') {
      const step = Number(active.step) || 0.1
      active.value = String(Number(active.value) + (dir === 'right' ? step : -step))
      active.dispatchEvent(new Event('input'))
      return
    }
    // Spatial navigation: nearest element in the pressed direction.
    const r0 = active.getBoundingClientRect()
    const cx = r0.left + r0.width / 2
    const cy = r0.top + r0.height / 2
    let best: HTMLElement | null = null
    let bestScore = Infinity
    for (const el of items) {
      if (el === active) continue
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      const dx = x - cx
      const dy = y - cy
      const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx
      const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy)
      if (along <= 4) continue
      const score = along + across * 2.2
      if (score < bestScore) {
        bestScore = score
        best = el
      }
    }
    if (best) {
      best.focus({ preventScroll: true })
      this.audio.play('uiMove')
    }
  }

  get hud(): HudState | undefined {
    return this.lastHud
  }
}

function fmtRange(key: keyof SaveData, v: number): string {
  return key === 'sensitivity' ? `${v.toFixed(1)}×` : `${Math.round(v * 100)}%`
}

function retrigger(el: HTMLElement, cls: string): void {
  el.classList.remove(cls)
  void el.offsetWidth
  el.classList.add(cls)
}
