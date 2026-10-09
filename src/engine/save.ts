/**
 * Versioned local save. Everything the player keeps between sessions lives in one JSON record so
 * it is easy to migrate. Corrupt or foreign data falls back to defaults instead of crashing.
 */
export type Locale = 'en' | 'zh-CN' | 'tr'
export type Quality = 'low' | 'medium' | 'high'
/** One finished race on the local leaderboard (sorted by total time). */
export type RaceEntry = { name: string; character: string; time: number; place: number; bestLap: number; at: number }

export type SaveData = {
  version: 2
  /** '' = never chosen; the game follows the browser language until the player picks one. */
  locale: Locale | ''
  musicVolume: number
  sfxVolume: number
  muted: boolean
  /** Steering sensitivity multiplier (0.5..2). */
  sensitivity: number
  quality: Quality
  reducedMotion: boolean
  /** Touch play: accelerate automatically. */
  autoGas: boolean
  tutorialDone: boolean
  playerName: string
  character: string
  leaderboard: RaceEntry[]
}

export const SAVE_KEY = 'critterkart.save'
export const LEADERBOARD_SIZE = 10

export function defaultSave(): SaveData {
  return {
    version: 2,
    locale: '',
    musicVolume: 0.7,
    sfxVolume: 0.8,
    muted: false,
    sensitivity: 1,
    quality: 'high',
    reducedMotion: false,
    autoGas: true,
    tutorialDone: false,
    playerName: 'PLAYER',
    character: 'hamster',
    leaderboard: [],
  }
}

const clamp01 = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback)
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** Parse untrusted stored JSON into a valid SaveData (pure; unit tested). */
export function parseSave(raw: string | null): SaveData {
  const base = defaultSave()
  if (!raw) return base
  let data: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base
    data = parsed as Record<string, unknown>
  } catch {
    return base
  }
  if (data.version !== 2) return base
  const board = Array.isArray(data.leaderboard) ? data.leaderboard : []
  return {
    version: 2,
    locale: data.locale === 'en' || data.locale === 'zh-CN' || data.locale === 'tr' ? data.locale : '',
    musicVolume: clamp01(data.musicVolume, base.musicVolume),
    sfxVolume: clamp01(data.sfxVolume, base.sfxVolume),
    muted: data.muted === true,
    sensitivity: typeof data.sensitivity === 'number' && data.sensitivity >= 0.5 && data.sensitivity <= 2 ? data.sensitivity : base.sensitivity,
    quality: data.quality === 'low' || data.quality === 'medium' || data.quality === 'high' ? data.quality : base.quality,
    reducedMotion: data.reducedMotion === true,
    autoGas: data.autoGas !== false,
    tutorialDone: data.tutorialDone === true,
    playerName: typeof data.playerName === 'string' && data.playerName.trim() ? data.playerName.trim().slice(0, 16) : base.playerName,
    character: typeof data.character === 'string' && /^[a-z]{2,16}$/.test(data.character) ? data.character : base.character,
    leaderboard: board
      .filter((e): e is RaceEntry => !!e && typeof e === 'object' && typeof (e as RaceEntry).name === 'string' && Number.isFinite((e as RaceEntry).time) && (e as RaceEntry).time > 0)
      .map(e => ({
        name: e.name.slice(0, 16),
        character: typeof e.character === 'string' ? e.character.slice(0, 16) : 'hamster',
        time: e.time,
        place: Math.max(1, Math.min(6, Math.floor(num(e.place, 6)))),
        bestLap: num(e.bestLap, 0),
        at: num(e.at, 0),
      }))
      .sort(compareEntries)
      .slice(0, LEADERBOARD_SIZE),
  }
}

/** Faster total time first, then better place, then earlier. */
export function compareEntries(a: RaceEntry, b: RaceEntry): number {
  return a.time - b.time || a.place - b.place || a.at - b.at
}

/** Insert a race into the bounded leaderboard. `rank` is -1 when it did not make the cut. */
export function insertEntry(board: RaceEntry[], entry: RaceEntry): { board: RaceEntry[]; rank: number } {
  const next = [...board, entry].sort(compareEntries).slice(0, LEADERBOARD_SIZE)
  return { board: next, rank: next.indexOf(entry) }
}

export class SaveStore {
  data: SaveData

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage) {
    let raw: string | null = null
    try {
      raw = this.storage?.getItem(SAVE_KEY) ?? null
    } catch {
      raw = null
    }
    this.data = parseSave(raw)
  }

  update(patch: Partial<SaveData>): void {
    this.data = { ...this.data, ...patch }
    try {
      this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data))
    } catch {
      // Private browsing or quota: the game keeps working with in-memory settings.
    }
  }
}
