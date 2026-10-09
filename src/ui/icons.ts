import type { ItemKind } from '../game/config'

/** Original item icons (inline SVG, 64×64). Thick ink outlines match the UI style. */
const INK = '#2b1633'

export const ITEM_ICONS: Record<ItemKind, string> = {
  shield: `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="gb" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#e9fdff"/><stop offset=".55" stop-color="#8fe8ff"/><stop offset="1" stop-color="#d59cff"/></radialGradient></defs><circle cx="32" cy="33" r="25" fill="url(#gb)" stroke="${INK}" stroke-width="4"/><path d="M18 27a15 15 0 0 1 12-11" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/><circle cx="45" cy="45" r="3.5" fill="#fff" opacity=".9"/><circle cx="24" cy="44" r="2" fill="#fff" opacity=".7"/></svg>`,
  pepper: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 40c4-3 8-3 10-1M8 48c5-1 9 0 11 2M14 31c3 0 6 2 7 4" fill="none" stroke="#ffb13b" stroke-width="4" stroke-linecap="round"/><path d="M22 44c4 10 22 12 30 1 6-8 5-22-1-28-5 7-10 11-17 13-7 2-14 5-12 14z" fill="#ff4b3a" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M30 33c5-1 10-4 14-9" fill="none" stroke="#ff9a8a" stroke-width="4" stroke-linecap="round"/><path d="M50 17c1-5 4-8 8-9" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M50 17c1-5 4-8 8-9" fill="none" stroke="#58d36b" stroke-width="3.5" stroke-linecap="round"/><path d="M44 19c3-3 8-4 12 0" fill="#58d36b" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/></svg>`,
  taffy: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M9 44c-2-9 6-14 11-14 1-9 11-15 19-11 7-5 17 1 16 10 6 3 5 12-1 15l-1 7c0 4-5 4-5 0v-4H20c-6 0-10-1-11-3z" fill="#7ef0c0" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M20 38c4-7 12-6 14-1 2-6 11-8 14 0" fill="none" stroke="#ff8fc0" stroke-width="5" stroke-linecap="round"/><ellipse cx="25" cy="28" rx="4" ry="2.5" fill="#fff" opacity=".85"/></svg>`,
  bee: `<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="22" cy="18" rx="10" ry="7" fill="#e8fbff" stroke="${INK}" stroke-width="3.5" transform="rotate(-25 22 18)"/><ellipse cx="38" cy="15" rx="10" ry="7" fill="#e8fbff" stroke="${INK}" stroke-width="3.5" transform="rotate(20 38 15)"/><ellipse cx="30" cy="38" rx="20" ry="15" fill="#ffd23f" stroke="${INK}" stroke-width="4"/><path d="M24 24c-4 8-4 20 0 28M36 24c-4 8-4 20 0 28" fill="none" stroke="${INK}" stroke-width="6"/><circle cx="48" cy="34" r="8" fill="${INK}"/><circle cx="50" cy="32" r="2.4" fill="#fff"/><path d="M9 40l-6 2 6 2" fill="${INK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M50 26c1-4 4-6 7-6" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/></svg>`,
}

/** Small glyph for a key or button prompt. */
export function keyCap(label: string, wide = false): string {
  return `<kbd class="cap${wide ? ' wide' : ''}">${label}</kbd>`
}

export const PAD_GLYPH: Record<string, string> = {
  A: '<kbd class="cap pad pad-a">A</kbd>',
  B: '<kbd class="cap pad pad-b">B</kbd>',
  X: '<kbd class="cap pad pad-x">X</kbd>',
  Y: '<kbd class="cap pad pad-y">Y</kbd>',
  RT: '<kbd class="cap pad wide">RT</kbd>',
  LT: '<kbd class="cap pad wide">LT</kbd>',
  RB: '<kbd class="cap pad wide">RB</kbd>',
  LS: '<kbd class="cap pad wide">L-stick</kbd>',
  START: '<kbd class="cap pad wide">☰</kbd>',
}

export const ICON = {
  pause: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>`,
  trophy: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v3a5 5 0 0 1-10 0z" /><path d="M7 5H4v1a3 3 0 0 0 3 3M17 5h3v1a3 3 0 0 1-3 3" fill="none" stroke="currentColor" stroke-width="2"/><rect x="10.5" y="11" width="3" height="5"/><rect x="7" y="16" width="10" height="3" rx="1"/></svg>`,
  flag: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="2" height="18" rx="1"/><path d="M6 4h13l-3 4 3 4H6z"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.4 4.6-1.8.4a7 7 0 0 1-.7 1.7l1 1.6-1.9 1.9-1.6-1a7 7 0 0 1-1.7.7l-.4 1.8h-2.6l-.4-1.8a7 7 0 0 1-1.7-.7l-1.6 1-1.9-1.9 1-1.6a7 7 0 0 1-.7-1.7l-1.8-.4v-2.6l1.8-.4a7 7 0 0 1 .7-1.7l-1-1.6 1.9-1.9 1.6 1a7 7 0 0 1 1.7-.7l.4-1.8h2.6l.4 1.8a7 7 0 0 1 1.7.7l1.6-1 1.9 1.9-1 1.6a7 7 0 0 1 .7 1.7l1.8.4z"/></svg>`,
}
