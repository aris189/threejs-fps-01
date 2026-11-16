// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. ?shot=start|play|end with &seed=N sets up a deterministic
// frame for a capture, renders it twice, then freezes it and sets
// window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { clamp, mulberry32 } from './util.js';
import { createWorld, SITES } from './world.js';
import { createPlayer } from './player.js';
import { createInput } from './input.js';
import { WEAPONS, WEAPON_ORDER, createWeaponState, updateWeapon, startReload, buyWeapon, switchWeapon, createGrenades, throwGrenade } from './weapons.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.fog, 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

scene.add(new THREE.HemisphereLight(0x8fa3c0, 0x2a2419, 1.05));
const sun = new THREE.DirectionalLight(0xffe0b0, 1.6);
sun.position.set(18, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
scene.add(sun);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud();
const player = createPlayer();
const rounds = createRounds();
const weaponState = createWeaponState();
const grenades = createGrenades();
const bots = createBots(scene, seed);
const input = createInput(renderer.domElement, {
  onLockChange(locked) {
    if (shot) return;
    if (locked) {
      hud.showOverlay(null);
      audio.unlock();
    } else if (rounds.state.phase !== 'over' && rounds.state.phase !== 'match') {
      hud.showOverlay('paused');
      overlayOpen = true;
    }
  },
  onUnlockedClick() {
    if (shot) return;
    if (rounds.state.phase === 'over' || rounds.state.phase === 'match') return;
    input.requestLock();
  },
});

const raycaster = new THREE.Raycaster();
const clock = { last: performance.now(), acc: 0 };
let elapsed = 0;
let frozen = false;
let overlayOpen = true; // title overlay up until the first lock
let buyOpen = false;
let shake = 0;
let flash = 0;

// ---- Viewmodel: a simple rifle the player carries ----
const viewGun = new THREE.Group();
{
  const dark = new THREE.MeshLambertMaterial({ color: 0x22262c });
  const mid = new THREE.MeshLambertMaterial({ color: 0x3a414b });
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.5), mid);
  viewGun.add(receiver);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.34, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.38);
  viewGun.add(barrel);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.08), dark);
  sight.position.set(0, 0.1, -0.05);
  viewGun.add(sight);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.1), dark);
  mag.position.set(0, -0.12, 0.05);
  mag.rotation.x = 0.15;
  viewGun.add(mag);
  viewGun.position.set(0.28, -0.26, -0.55);
  camera.add(viewGun);
}
const muzzleLight = new THREE.PointLight(PALETTE.muzzle, 0, 9, 2);
muzzleLight.position.set(0.3, -0.2, -0.7);
camera.add(muzzleLight);
const explosionLight = new THREE.PointLight(0xff9a3c, 0, 22, 1.6);
scene.add(explosionLight);

// ---- Tracers: a pool of fading lines, no per-frame allocation ----
const tracers = [];
for (let i = 0; i < 24; i++) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const mat = new THREE.LineBasicMaterial({ color: PALETTE.tracer, transparent: true, opacity: 0 });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
function spawnTracer(from, to, color) {
  let best = tracers[0];
  for (const t of tracers) if (t.life <= 0) { best = t; break; }
  const pos = best.line.geometry.attributes.position.array;
  pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
  pos[3] = to.x; pos[4] = to.y; pos[5] = to.z;
  best.line.geometry.attributes.position.needsUpdate = true;
  best.line.material.color.setHex(color || PALETTE.tracer);
  best.line.material.opacity = 0.9;
  best.life = 0.09;
}

// ---- Grenade meshes: a small pool ----
const grenadeMeshes = [];
for (let i = 0; i < 4; i++) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0x2e4a2e }),
  );
  mesh.visible = false;
  scene.add(mesh);
  grenadeMeshes.push(mesh);
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();

// Hitscan fire: raycast the world and the bots, nearest hit wins.
function fireRay(origin, dir, range) {
  raycaster.set(origin, dir);
  raycaster.far = range;
  const botHits = raycaster.intersectObjects(bots.allHitMeshes(), false);
  const worldHits = raycaster.intersectObjects(world.shootables, false);
  const botHit = botHits.length > 0 ? botHits[0] : null;
  const worldHit = worldHits.length > 0 ? worldHits[0] : null;
  if (botHit && (!worldHit || botHit.distance < worldHit.distance)) {
    return { hit: 'bot', bot: botHit.object.userData.bot, part: botHit.object.userData.part, point: botHit.point, distance: botHit.distance };
  }
  if (worldHit) {
    return { hit: 'world', point: worldHit.point, distance: worldHit.distance };
  }
  _v1.copy(origin).addScaledVector(dir, range);
  return { hit: null, point: _v1.clone(), distance: range };
}

function applyShotResult(def, result) {
  muzzleLight.intensity = 22;
  shake = Math.min(0.5, shake + 0.12);
  const from = _v2.set(
    player.state.position.x - Math.sin(player.state.yaw) * 0.3,
    player.state.position.y + player.state.eye - 0.12,
    player.state.position.z - Math.cos(player.state.yaw) * 0.3,
  );
  spawnTracer(from, result.point, def.tracer);
  audio.shot(def.kind);
  bots.hearShot(player.state.position.x, player.state.position.z, elapsed);
  if (result.hit === 'bot') {
    const dmg = def.damage * (result.part === 'head' ? def.headMult : 1);
    const killed = bots.damage(result.bot, dmg, result.part);
    hud.flashHit(result.part === 'head');
    if (result.part === 'head') audio.headshot();
    else audio.hit();
    if (killed) {
      rounds.onKill();
      hud.killfeed(`You eliminated ${result.bot.name} ${result.part === 'head' ? '— headshot' : ''}`, true);
      audio.kill();
    }
  }
}

function explodeGrenade(g) {
  const pos = g.pos;
  explosionLight.position.copy(pos);
  explosionLight.intensity = 60;
  audio.explosion();
  shake = 1;
  spawnTracer(pos, _v1.set(pos.x, pos.y + 0.1, pos.z), 0xff9a3c);
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = Math.hypot(bot.pos.x - pos.x, bot.pos.z - pos.z);
    if (d < 6) {
      const killed = bots.damage(bot, 120 * (1 - d / 6), 'body');
      if (killed) {
        rounds.onKill();
        hud.killfeed(`You eliminated ${bot.name} with a grenade`, true);
      }
    }
  }
  const pd = Math.hypot(player.state.position.x - pos.x, player.state.position.z - pos.z);
  if (pd < 5 && player.state.alive) {
    player.damage(60 * (1 - pd / 5) * 0.5);
    flash = 0.7;
    audio.hurt();
  }
}

function updateGrenades(dt) {
  for (let i = grenades.live.length - 1; i >= 0; i--) {
    const g = grenades.live[i];
    g.vel.y -= 12 * dt;
    g.pos.addScaledVector(g.vel, dt);
    if (g.pos.y < 0.13) {
      g.pos.y = 0.13;
      g.vel.y = -g.vel.y * 0.45;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
    }
    g.fuse -= dt;
    const mesh = grenadeMeshes[i];
    if (mesh) {
      mesh.visible = true;
      mesh.position.copy(g.pos);
    }
    if (g.fuse <= 0) {
      explodeGrenade(g);
      if (mesh) mesh.visible = false;
      grenades.live.splice(i, 1);
      grenades.pool.push(g);
    }
  }
}

// ---- Round wiring ----
const roundEvents = {
  onRoundStart(round) {
    bots.reset();
    player.reset();
    refillMags();
    hud.showMessage(`ROUND ${round} — plant the spike at A or B`, 3);
    hud.showOverlay(null);
    overlayOpen = false;
  },
  onLive() {
    hud.showMessage('Round live — go!', 2);
  },
  onPlant(site) {
    hud.showMessage(`SPIKE PLANTED AT ${site.id} — defend it!`, 3);
    hud.killfeed(`Spike planted at ${site.id}`, true);
    audio.plantBeep(true);
  },
  onRoundEnd(winner, reason) {
    if (winner === 'you') audio.roundWin();
    else audio.roundLose();
    hud.showOverlay('round', {
      winner, reason,
      you: rounds.state.scoreYou, them: rounds.state.scoreThem,
      matchOver: rounds.state.scoreYou >= 5 || rounds.state.scoreThem >= 5,
    });
    overlayOpen = true;
    input.exitLock();
  },
  onMatchEnd(winner) {
    hud.showOverlay('match', {
      winner, you: rounds.state.scoreYou, them: rounds.state.scoreThem, kills: rounds.state.kills,
    });
    overlayOpen = true;
    input.exitLock();
  },
};

function refillMags() {
  for (const id of Object.keys(weaponState.mag)) {
    if (!weaponState.owned[id]) continue;
    const def = WEAPONS[id];
    const need = def.magSize - weaponState.mag[id];
    const take = Math.min(need, weaponState.reserve[id]);
    weaponState.mag[id] += take;
    weaponState.reserve[id] -= take;
  }
}

function buyItem(key) {
  const st = rounds.state;
  if (st.phase !== 'buy') return;
  if (key === 'grenade') {
    if (st.money >= 300) {
      st.money -= 300;
      weaponState.grenades += 1;
      audio.buy();
      hud.showMessage('Frag grenade bought', 1.5);
    }
    return;
  }
  if (key === 'armor') {
    if (rounds.buyArmor(player)) {
      audio.buy();
      hud.showMessage('Kevlar armor bought', 1.5);
    }
    return;
  }
  const res = buyWeapon(weaponState, key, st.money);
  if (res.ok) {
    st.money = res.money;
    audio.buy();
    hud.showMessage(`${WEAPONS[key].name} bought`, 1.5);
    hud.setWeapon(key);
  } else if (!weaponState.owned[key]) {
    hud.showMessage('Not enough money', 1.5);
  } else {
    switchWeapon(weaponState, key);
    hud.setWeapon(key);
  }
  if (buyOpen) hud.buildBuyMenu(st.money, weaponState, buyItem);
}

const prevKeys = new Set();
function edgeKey(code) {
  const down = input.isDown(code);
  const was = prevKeys.has(code);
  if (down && !was) prevKeys.add(code);
  if (!down && was) prevKeys.delete(code);
  return down && !was;
}

function step(dt, snapOverride) {
  elapsed += dt;
  const st = rounds.state;
  const timeScale = st.phase === 'planted' && !player.state.alive ? 4 : 1;
  const sdt = dt * timeScale;

  // Mouse look.
  const mouse = input.consumeMouse();
  if (input.locked || shot) {
    player.state.yaw -= mouse.dx * 0.0021;
    player.state.pitch = clamp(player.state.pitch - mouse.dy * 0.0021, -1.5, 1.5);
  }

  // One-shot keys.
  if (edgeKey('KeyR')) startReload(weaponState, { onReloadStart: () => audio.reload() });
  if (edgeKey('KeyB') && (st.phase === 'buy' || buyOpen)) {
    buyOpen = !buyOpen;
    if (buyOpen) {
      hud.buildBuyMenu(st.money, weaponState, buyItem);
      input.exitLock();
    } else {
      hud.hideBuyMenu();
      if (!shot) input.requestLock();
    }
  }
  if (edgeKey('KeyG') && weaponState.grenades > 0 && (st.phase === 'live' || st.phase === 'planted')) {
    weaponState.grenades -= 1;
    throwGrenade(grenades, player, audio);
    audio.shot('pistol');
  }
  if (edgeKey('KeyQ')) {
    const idx = WEAPON_ORDER.indexOf(weaponState.current);
    for (let k = 1; k <= WEAPON_ORDER.length; k++) {
      const next = WEAPON_ORDER[(idx + k) % WEAPON_ORDER.length];
      if (weaponState.owned[next]) {
        switchWeapon(weaponState, next);
        hud.setWeapon(next);
        break;
      }
    }
  }
  for (let i = 0; i < WEAPON_ORDER.length; i++) {
    if (edgeKey(`Digit${i + 1}`)) {
      const id = WEAPON_ORDER[i];
      if (buyOpen) buyItem(id);
      else if (switchWeapon(weaponState, id)) hud.setWeapon(id);
    }
  }
  if (buyOpen) {
    if (edgeKey('Digit5')) buyItem('grenade');
    if (edgeKey('Digit6')) buyItem('armor');
    if (edgeKey('Escape')) {
      buyOpen = false;
      hud.hideBuyMenu();
      if (!shot) input.requestLock();
    }
  }

  const playing = !overlayOpen && (st.phase === 'buy' || st.phase === 'live' || st.phase === 'planted');
  const snap = snapOverride || input.snapshot();
  snap.plantHeld = snapOverride ? snapOverride.plantHeld : input.isDown('KeyE');

  if (playing) {
    player.update(sdt, snap);
    // The weapon fires in the buy phase too (test your aim at the walls);
    // the bots only wake up once the round goes live.
    if (st.phase === 'buy' || st.phase === 'live' || st.phase === 'planted') {
      updateWeapon(weaponState, sdt, snap, player, fireRay, {
        onShot: (def, result) => applyShotResult(def, result),
        onDryFire: () => {
          audio.dryFire();
          startReload(weaponState, { onReloadStart: () => audio.reload() });
        },
        onReloadDone: () => {},
      });
    }
    if (st.phase === 'live' || st.phase === 'planted') {
      updateGrenades(sdt);
      bots.update(sdt, {
        playerPos: player.state.position,
        playerAlive: player.state.alive,
        playerMoving: player.state.moving,
        playerCrouched: player.state.crouched,
        spikePlanted: st.phase === 'planted',
        spikeSite: st.plantedSite,
        onBotShot: (bot, from, hit, damageAmount, headshot) => {
          audio.enemyShot(Math.hypot(from.x - player.state.position.x, from.z - player.state.position.z));
          _origin.set(from.x, from.y, from.z);
          const target = hit
            ? _v1.set(player.state.position.x, player.state.position.y + player.state.eye - 0.2, player.state.position.z)
            : _v1.set(
              player.state.position.x + (random() - 0.5) * 3,
              player.state.position.y + player.state.eye + (random() - 0.5) * 2,
              player.state.position.z + (random() - 0.5) * 3,
            );
          spawnTracer(_origin, target, 0xff7a5c);
          if (hit && player.state.alive) {
            player.damage(damageAmount);
            flash = 0.8;
            audio.hurt();
            if (!player.state.alive) hud.showMessage('ELIMINATED', 3);
          }
        },
      }, elapsed);
    }
  }

  rounds.update(sdt, { player, bots, input: snap, events: roundEvents });

  // The spike device sits on the planted site and blinks while it ticks.
  if (st.plantedSite) {
    world.spike.visible = true;
    world.spike.position.set(st.plantedSite.x, 0, st.plantedSite.z);
    world.spikeLight.intensity = 9;
  } else {
    world.spike.visible = false;
    world.spikeLight.intensity = 0;
  }

  // Site marker pulse; the planted site flashes white.
  for (const m of world.siteMarkers) {
    m.pulse += dt;
    const planted = st.plantedSite && st.plantedSite.id === m.site.id;
    const base = planted ? 0.6 + 0.4 * Math.sin(m.pulse * 6) : 0.55 + 0.2 * Math.sin(m.pulse * 2);
    m.ring.material.opacity = base;
    if (planted) m.ring.material.color.setHex(0xffffff);
    else m.ring.material.color.setHex(m.site.color);
  }

  // HUD.
  const def = WEAPONS[weaponState.current];
  hud.setAmmo(weaponState.mag[weaponState.current], weaponState.reserve[weaponState.current], weaponState.grenades);
  hud.setHealth(player.state.health, player.state.armor);
  hud.setTimer(st.phase === 'planted' ? st.spikeTimer : st.phaseTime, st.phase);
  hud.setScore(st.round, st.scoreYou, st.scoreThem, st.money, st.kills);
  hud.setCrosshairGap(6 + weaponState.spread * 900);
  hud.showPlant(st.plantProgress / 3, st.planting, st.plantedSite ? st.plantedSite.label : '');
  hud.showDefuseWarning(Boolean(st.defuser), st.defuser ? st.defuser.name : '');
  hud.tick(dt);
  if (playing) hud.drawMinimap(player.state.position, player.state.yaw, bots.bots, SITES, st.plantedSite ? st.plantedSite.id : null);

  // Decay effects.
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 260);
  explosionLight.intensity = Math.max(0, explosionLight.intensity - dt * 140);
  flash = Math.max(0, flash - dt * 1.6);
  shake = Math.max(0, shake - dt * 1.8);
  for (const t of tracers) {
    if (t.life > 0) {
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
    }
  }
}

function syncCamera() {
  const p = player.state;
  camera.position.set(p.position.x, p.position.y + p.eye, p.position.z);
  camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  if (shake > 0) {
    camera.position.x += (random() - 0.5) * shake * 0.14;
    camera.position.y += (random() - 0.5) * shake * 0.14;
  }
  // Viewmodel bob and recoil kick.
  const bob = p.moving && p.onGround ? Math.sin(elapsed * 11) * 0.008 : 0;
  viewGun.position.y = -0.26 + bob;
  viewGun.position.z = -0.55 + weaponState.cooldown * 0.12;
  document.getElementById('damage-flash').style.opacity = flash > 0 ? String(flash * 0.55) : '0';
}

function frame(now) {
  if (frozen) return;
  requestAnimationFrame(frame);
  let dt = (now - clock.last) / 1000;
  clock.last = now;
  if (dt > 0.1) dt = 0.1;
  clock.acc += dt;
  let steps = 0;
  while (clock.acc >= FIXED_STEP && steps < 5) {
    step(FIXED_STEP);
    clock.acc -= FIXED_STEP;
    steps += 1;
  }
  syncCamera();
  renderer.render(scene, camera);
}

function aimAt(tx, ty, tz) {
  const p = player.state;
  const dx = tx - p.position.x;
  const dz = tz - p.position.z;
  const d = Math.hypot(dx, dz);
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(ty - (p.position.y + p.eye), d);
}

// ---- Deterministic screenshot setups ----
function setupShot() {
  frozen = false;
  if (shot === 'start') {
    rounds.startMatch();
    hud.showOverlay('start');
    overlayOpen = true;
    player.state.position.x = 0;
    player.state.position.y = 0;
    player.state.position.z = 17;
    player.state.yaw = 0.12;
    player.state.pitch = 0.02;
    weaponState.current = 'rifle';
    weaponState.owned.rifle = true;
    weaponState.mag.rifle = 25;
    weaponState.reserve.rifle = 100;
    hud.setWeapon('rifle');
  } else if (shot === 'play') {
    rounds.startMatch();
    const st = rounds.state;
    st.phase = 'live';
    st.phaseTime = 62;
    st.round = 4;
    st.scoreYou = 2;
    st.scoreThem = 1;
    st.money = 1250;
    st.kills = 3;
    weaponState.current = 'rifle';
    weaponState.owned.rifle = true;
    weaponState.owned.smg = true;
    weaponState.mag.rifle = 25;
    weaponState.reserve.rifle = 100;
    weaponState.mag.smg = 30;
    weaponState.reserve.smg = 120;
    hud.setWeapon('rifle');
    hud.showOverlay(null);
    overlayOpen = false;
    // Stage the fight: KODA holds the mid gap in view; VEX stays on Site A,
    // out of earshot of the mid-lane gunfire (28 m > hear range), so the
    // frame keeps one clean duel instead of a defender in the lens.
    player.state.position.x = -2;
    player.state.position.y = 0;
    player.state.position.z = 6;
    bots.bots[2].pos.x = 0.5;
    bots.bots[2].pos.z = -4.5;
    bots.bots[2].state = 'engage';
    bots.bots[2].aimTime = 1;
    bots.bots[0].pos.x = -22;
    bots.bots[0].pos.z = -14;
    bots.bots[0].state = 'hold';
    bots.bots[0].aimTime = 0;
    // Scripted 2.5 s: aim at KODA's chest and fire in bursts.
    const koda = bots.bots[2];
    for (let i = 0; i < 150; i++) {
      aimAt(koda.pos.x, 1.3, koda.pos.z);
      const snap = { forward: 0, strafe: 0, sprint: false, crouch: false, jump: false, firing: i > 20 && i < 110, plantHeld: false };
      step(FIXED_STEP, snap);
      // Keep the scripted input by re-aiming after each step.
      if (!koda.alive) {
        aimAt(bots.bots[0].pos.x, 1.3, bots.bots[0].pos.z);
      }
    }
    hud.showMessage('SPIKE CARRIER — push mid', 2.5);
  } else if (shot === 'end') {
    rounds.startMatch();
    const st = rounds.state;
    st.phase = 'over';
    st.phaseTime = 4;
    st.round = 5;
    st.scoreYou = 3;
    st.scoreThem = 1;
    st.kills = 5;
    st.money = 1850;
    st.roundWinner = 'you';
    st.roundReason = 'The spike detonated';
    st.plantedSite = SITES[0];
    weaponState.current = 'rifle';
    weaponState.owned.rifle = true;
    weaponState.mag.rifle = 11;
    weaponState.reserve.rifle = 75;
    hud.setWeapon('rifle');
    hud.showOverlay('round', { winner: 'you', reason: 'The spike detonated', you: 3, them: 1, matchOver: false });
    overlayOpen = true;
    player.state.position.x = -20;
    player.state.position.y = 0;
    player.state.position.z = -10;
    // Stand inside Site A and look down past the spike: the ring, the
    // blinking spike and the fallen defender sit right of centre, beside
    // the round-end panel instead of behind it.
    aimAt(-24, 0.1, -16);
    bots.bots[0].alive = false;
    bots.bots[0].state = 'dead';
    bots.bots[0].fallT = 1;
    bots.bots[0].mesh.group.rotation.x = -Math.PI / 2;
    bots.bots[0].mesh.group.position.set(-20, -0.25, -12);
  }
  // One zero-length step syncs the HUD (ammo, timer, score, money) with the
  // staged state, so the screenshots show the same numbers the game holds.
  step(0);
  hud.drawMinimap(player.state.position, player.state.yaw, bots.bots, SITES, rounds.state.plantedSite ? rounds.state.plantedSite.id : null);
  syncCamera();
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  frozen = true;
  window.__shotReady = true;
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (rounds.state.phase === 'over') {
    // Advance to the next round (or the match screen); onRoundStart resets
    // the world and hides the overlay.
    rounds.nextRound(roundEvents);
    if (rounds.state.phase === 'match') return;
    input.requestLock();
    return;
  }
  if (rounds.state.phase === 'match') {
    rounds.startMatch();
    bots.reset();
    player.reset();
    weaponState.mag = { pistol: 12, smg: 0, rifle: 0, dmr: 0 };
    weaponState.reserve = { pistol: 48, smg: 0, rifle: 0, dmr: 0 };
    weaponState.owned = { pistol: true };
    weaponState.current = 'pistol';
    weaponState.grenades = 0;
    hud.setWeapon('pistol');
    hud.showOverlay(null);
    overlayOpen = false;
    input.requestLock();
    return;
  }
  hud.showOverlay(null);
  overlayOpen = false;
  input.requestLock();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start: buy phase of round 1 behind the title overlay.
rounds.startMatch();
hud.showOverlay('start');
hud.setWeapon('pistol');
if (shot) setupShot();
else requestAnimationFrame(frame);
