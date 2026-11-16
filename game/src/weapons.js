// Weapons: definitions, fire/reload state, spread and recoil. Hits are
// hitscan raycasts against bot bodies (headshots pay double) and the map.
// A grenade is a ballistic projectile with a timed fuse.
import * as THREE from 'three';
import { clamp } from './util.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P7 Sidearm', kind: 'pistol', price: 0,
    damage: 26, headMult: 2, magSize: 12, reserveMax: 48,
    fireInterval: 0.22, auto: false, reloadTime: 1.1,
    spreadBase: 0.011, spreadMove: 0.02, spreadPerShot: 0.006, spreadMax: 0.05,
    recoil: 0.011, range: 60, tracer: 0xffd27a,
  },
  smg: {
    id: 'smg', name: 'VK-9 Ripper', kind: 'smg', price: 700,
    damage: 22, headMult: 2, magSize: 30, reserveMax: 120,
    fireInterval: 0.085, auto: true, reloadTime: 1.5,
    spreadBase: 0.016, spreadMove: 0.026, spreadPerShot: 0.005, spreadMax: 0.06,
    recoil: 0.008, range: 55, tracer: 0xffe9b0,
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Carbine', kind: 'rifle', price: 1200,
    damage: 34, headMult: 2, magSize: 25, reserveMax: 100,
    fireInterval: 0.13, auto: true, reloadTime: 1.9,
    spreadBase: 0.008, spreadMove: 0.022, spreadPerShot: 0.007, spreadMax: 0.055,
    recoil: 0.014, range: 80, tracer: 0xffd27a,
  },
  dmr: {
    id: 'dmr', name: 'Longshot DMR', kind: 'dmr', price: 1800,
    damage: 80, headMult: 2, magSize: 8, reserveMax: 32,
    fireInterval: 0.85, auto: false, reloadTime: 2.4,
    spreadBase: 0.002, spreadMove: 0.03, spreadPerShot: 0.02, spreadMax: 0.05,
    recoil: 0.045, range: 100, tracer: 0x9fd8ff,
  },
};
export const WEAPON_ORDER = ['rifle', 'smg', 'dmr', 'pistol'];
export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 400;

export function createWeaponState() {
  return {
    current: 'pistol',
    owned: { pistol: true },
    mag: { pistol: 12, smg: 0, rifle: 0, dmr: 0 },
    reserve: { pistol: 48, smg: 0, rifle: 0, dmr: 0 },
    grenades: 0,
    cooldown: 0,
    reloading: 0,
    spread: 0,
    triggerHeld: false,
    fired: false, // set true on the step a shot leaves the barrel
  };
}

export function buyWeapon(state, id, money) {
  const def = WEAPONS[id];
  if (!def || state.owned[id]) return { ok: false, money };
  if (money < def.price) return { ok: false, money };
  state.owned[id] = true;
  state.mag[id] = def.magSize;
  state.reserve[id] = def.reserveMax;
  state.current = id;
  return { ok: true, money: money - def.price };
}

export function switchWeapon(state, id) {
  if (!state.owned[id] || state.current === id) return false;
  state.current = id;
  state.reloading = 0;
  state.spread = 0;
  return true;
}

// One fixed step of weapon logic. fire is the raycast callback:
//   fire(origin, direction) -> {hit: 'bot'|'world'|null, bot?, part?, point?, distance?}
// events: {onShot, onDryFire, onReloadStart, onReloadDone, onEmpty}
export function updateWeapon(state, dt, input, player, fire, events) {
  const def = WEAPONS[state.current];
  state.fired = false;
  if (state.cooldown > 0) state.cooldown -= dt;
  if (state.reloading > 0) {
    state.reloading -= dt;
    if (state.reloading <= 0) {
      const need = def.magSize - state.mag[state.current];
      const take = Math.min(need, state.reserve[state.current]);
      state.mag[state.current] += take;
      state.reserve[state.current] -= take;
      if (events.onReloadDone) events.onReloadDone();
    }
    return;
  }
  // Spread recovers when not firing; moving widens it.
  const moveSpread = player.state.moving ? def.spreadMove : 0;
  const targetSpread = def.spreadBase + moveSpread + (player.state.crouched ? -0.004 : 0);
  state.spread += (Math.max(0, targetSpread) - state.spread) * Math.min(1, dt * 6);
  state.spread = clamp(state.spread, 0, def.spreadMax);

  const pressed = !def.auto && input.firePressed;
  const wantFire = def.auto ? input.firing : (input.firing && !state.triggerHeld) || pressed;
  state.triggerHeld = input.firing;
  if (!wantFire || state.cooldown > 0) return;
  // The click is consumed only now that the weapon can act on it.
  if (pressed && input.clearFirePressed) input.clearFirePressed();
  if (state.mag[state.current] <= 0) {
    state.cooldown = 0.25;
    if (events.onDryFire) events.onDryFire();
    return;
  }
  state.mag[state.current] -= 1;
  state.cooldown = def.fireInterval;
  state.spread = Math.min(def.spreadMax, state.spread + def.spreadPerShot);
  state.fired = true;

  const origin = new THREE.Vector3(
    player.state.position.x,
    player.state.position.y + player.state.eye,
    player.state.position.z,
  );
  const dir = new THREE.Vector3();
  dir.set(
    -Math.sin(player.state.yaw) * Math.cos(player.state.pitch),
    Math.sin(player.state.pitch),
    -Math.cos(player.state.yaw) * Math.cos(player.state.pitch),
  );
  // Spread: random cone around the aim direction, tighter while crouched.
  const spread = state.spread * (player.state.crouched ? 0.7 : 1) * (player.state.moving ? 1.6 : 1);
  dir.x += (Math.random() * 2 - 1) * spread;
  dir.y += (Math.random() * 2 - 1) * spread;
  dir.z += (Math.random() * 2 - 1) * spread;
  dir.normalize();
  // Recoil kicks the view up; the player compensates by pulling down.
  player.state.pitch = clamp(player.state.pitch + def.recoil, -1.5, 1.5);
  const result = fire(origin, dir, def.range);
  if (events.onShot) events.onShot(def, result);
}

export function startReload(state, events) {
  const def = WEAPONS[state.current];
  if (state.reloading > 0) return false;
  if (state.mag[state.current] >= def.magSize) return false;
  if (state.reserve[state.current] <= 0) return false;
  state.reloading = def.reloadTime;
  if (events.onReloadStart) events.onReloadStart();
  return true;
}

// ---- Grenades ----
export function createGrenades() {
  return { live: [], pool: [] };
}

// Throw from the player's eye along the aim direction.
export function throwGrenade(grens, player, audio) {
  const g = grens.pool.pop() || { pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0, mesh: null };
  const yaw = player.state.yaw;
  const pitch = player.state.pitch;
  g.pos.set(
    player.state.position.x - Math.sin(yaw) * 0.5,
    player.state.position.y + player.state.eye - 0.1,
    player.state.position.z - Math.cos(yaw) * 0.5,
  );
  g.vel.set(
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch) + 0.35,
    -Math.cos(yaw) * Math.cos(pitch),
  ).multiplyScalar(16);
  g.fuse = 1.6;
  grens.live.push(g);
  return g;
}
