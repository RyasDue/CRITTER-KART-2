# Drift Kart TR

A 3D item kart racer for the browser, built with three.js and Rapier. Pick one of six original
critter drivers and race five AI rivals over three laps of **Frosting Loop Valley**, a single
hand-tuned circuit with a caramel shortcut, a jump ramp and boost strips.

```bash
pnpm install
pnpm dev      # dev server
pnpm build    # typecheck + production build + bundle budget
pnpm test     # unit tests (race rules, spline, i18n)
```

## Controls

| Action | Keyboard | Gamepad | Touch (landscape) |
| --- | --- | --- | --- |
| Throttle | W / ↑ | RT (or A) | Automatic |
| Brake / reverse | S / ↓ | LT (or B) | Brake button |
| Steer | A / D or ← / → | Left stick / d-pad | Steering slider |
| Drift (hold, release to boost) | Shift | RB / LB | Drift button |
| Use item | Space / E | X / Y | Item button |
| Look back | C | R3 | — |
| Pause | Esc / P | Start | Pause button |

A drift charges through three spark tiers. Releasing it gives a boost that lasts longer the
higher the tier. Tap drift in mid-air off the ramp to do a trick boost. Hold throttle just
before GO to get a start boost; holding it too early stalls the engine.

## Items (all original)

Drive through a candy gift box to get a random item. The odds depend on your place.

- **Bubble Shield**: blocks the next hit.
- **Pepper Jet**: a short burst of speed; it also blasts through the sticky patch on the shortcut.
- **Sticky Taffy**: dropped behind you. Karts that drive over it get stuck and slow down.
- **Homing Bee**: follows the track to the racer directly in front of you and spins them out.

## Reusable engine components

| Path | Role |
| --- | --- |
| `src/engine/kart.ts` | `KartController`: an arcade kart on a Rapier ball. Handles ground-ray snapping, the grip/drift model, drift charge tiers, boosts, stun and spin, wall glancing, and emits events for FX and audio. It is configured by a `KartSpec` plus a surface provider and knows nothing about any specific track or game. |
| `src/engine/splineAi.ts` | `SplineDriver`: follows any `TrackSpline` using pure pursuit with a curvature-limited look-ahead. Covers the racing line, corner speed control, drifting, obstacle avoidance, and edge and stuck recovery. It outputs the same `KartInput` the player produces. |
| `src/engine/spline.ts` | `TrackSpline`: an arc-length-parameterised closed or open spline with closest-point queries, lateral offsets, curvature and heading look-ahead. |
| `src/engine/particles.ts`, `src/engine/trail.ts` | Pooled particles drawn in a single call, and ribbon trails. |
| `src/engine/loop.ts`, `input.ts`, `physics.ts`, `renderer.ts`, `audio.ts`, `save.ts`, `i18n.ts` | Fixed-step loop, unified input (keyboard, gamepad, touch), Rapier world, quality tiers, audio buses and step sequencer, versioned save with local leaderboard, en / zh-CN text. |

Gameplay code is in `src/game/` (`track.ts`, `racer.ts`, `items.ts`, `game.ts`, …). All tuning
values are in `src/game/config.ts`. The UI is HTML/CSS in `src/ui/` and `src/styles/main.css`,
and every visible string is an i18n key in both `src/i18n/en.json` and `src/i18n/zh-CN.json`.

All models, music and sound effects are generated procedurally at runtime.

## Credits

Fonts: Sora, Figtree and Noto Sans SC, under the SIL Open Font License 1.1 (see `public/fonts/*-OFL.txt`).
Libraries: three.js (MIT), Rapier (Apache-2.0).
