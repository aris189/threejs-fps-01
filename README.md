# Site Breach — a three.js tactical FPS

[![make.fun](https://make.fun/badge/threejs-fps-01.svg)](https://make.fun/bounty/threejs-fps-01)
[![rank](https://make.fun/badge/threejs-fps-01/aris189/threejs-fps-01/rank.svg)](https://make.fun/bounty/threejs-fps-01)
[![reward](https://make.fun/badge/threejs-fps-01/aris189/threejs-fps-01/reward.svg)](https://make.fun/bounty/threejs-fps-01)

A round-based tactical first-person shooter in the style Counter-Strike made
famous, built on three.js 0.187.0 (vendored under `game/vendor/three/`) and
playable in desktop Chrome from static files — no build step, no network.

## The game

**Halcyon Depot** is an original three-lane map: attackers spawn south, and
two bomb sites wait north — Site A (west) and Site B (east) — split by a cross
wall with one gap per lane. Four defenders hold the sites, patrol the lanes,
investigate gunfire, and rush to defuse a planted spike.

- **First-person combat** — pointer-lock mouse look, WASD with acceleration,
  sprint, crouch, jump, and collision with the map.
- **Gunplay that rewards stopping to aim** — four weapons (sidearm, SMG,
  carbine, DMR) with recoil, spread that grows while moving and firing,
  reloads, and running out of ammunition; headshots pay double.
- **Tactics** — plant the spike (hold E inside a site), defend it while it
  ticks, earn money for kills, plants and round wins, and spend it in the buy
  menu (B) on weapons, frag grenades (G) and Kevlar.
- **Rounds and a match** — 100-second rounds, first to 5 takes the match;
  rounds end by elimination, detonation, defuse, or the clock, and restart
  from the round screen.
- **HUD** — health and armor, ammunition, round timer, score, money, a
  minimap, crosshair spread, hitmarkers, killfeed, and plant/defuse progress.

## Play it

```sh
node serve.ts
# open http://localhost:8080
```

## Screenshots

`shots.json` lists the three deterministic captures (`?shot=start|play|end`),
taken with Playwright from the game's own code:

1. `1-start.jpg` — title screen over the depot
2. `2-play.jpg` — mid-round firefight with the HUD
3. `3-end.jpg` — round won, spike detonated

## Layout

- `game/index.html` — page, import map, HUD
- `game/src/main.js` — boot, fixed-step loop, shooting, tracers, grenades
- `game/src/world.js` — the Halcyon Depot map, colliders, bot nav graph
- `game/src/player.js` — movement, crouch, jump, collision
- `game/src/weapons.js` — weapon definitions, fire/reload/spread, grenades
- `game/src/bots.js` — defender AI: hold, patrol, investigate, engage, defuse
- `game/src/rounds.js` — buy phase, plant/defuse, money, match score
- `game/src/hud.js` — HUD, overlays, buy menu, minimap
- `game/src/audio.js` — synthesized WebAudio sound effects
- `game/src/input.js` — keyboard + pointer-lock mouse
- `main.ts` — the entry program: copies `game/` and `screenshots/` to
  `/output` and writes `dossier.json` with the kit's library

## License

MIT — see [LICENSE](LICENSE).
