// Defenders: four bots that hold the sites, patrol the lanes, investigate
// gunfire, shoot back in bursts, and rush to defuse a planted spike.
// AI thinks at 10 Hz; movement runs every fixed step. One seeded RNG keeps
// a screenshot replay deterministic.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { clamp, dist2D, mulberry32 } from './util.js';
import { findPath, losBlocked, moveWithCollision, NAV_NODES } from './world.js';

const BOT_NAMES = ['VEX', 'ORIN', 'KODA', 'MIRA'];
const BOT_SPEED = 3.4;
const BOT_RUSH_SPEED = 4.4;
const BOT_RADIUS = 0.38;
const EYE = 1.55;
const ENGAGE_RANGE = 38;
const HEAR_RANGE = 26;
const DEFUSE_TIME = 5;

const HOLDS = [
  { home: 7, patrol: [7, 10, 14] }, // VEX holds Site A
  { home: 8, patrol: [8, 11, 15] }, // ORIN holds Site B
  { home: 9, patrol: [9, 5, 12, 13] }, // KODA holds mid
  { home: 1, patrol: [1, 2, 3, 5] }, // MIRA roams south
];

function makeBotMesh(scene, name) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: PALETTE.enemy });
  const darkMat = new THREE.MeshLambertMaterial({ color: PALETTE.enemyDark });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.8, 6, 12), bodyMat);
  body.position.y = 1.0;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), darkMat);
  head.position.y = 1.66;
  head.castShadow = true;
  group.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.1), new THREE.MeshBasicMaterial({ color: PALETTE.accent }));
  visor.position.set(0, 1.68, 0.22);
  group.add(visor);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85), darkMat);
  gun.position.set(0.28, 1.15, 0.35);
  group.add(gun);
  const padL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.34), darkMat);
  padL.position.set(-0.36, 1.42, 0);
  group.add(padL);
  const padR = padL.clone();
  padR.position.x = 0.36;
  group.add(padR);
  scene.add(group);
  return { group, body, head, gun };
}

export function createBots(scene, seed = 1) {
  const random = mulberry32(seed);
  const bots = [];
  for (let i = 0; i < 4; i++) {
    const hold = HOLDS[i];
    const home = NAV_NODES[hold.home];
    const mesh = makeBotMesh(scene, BOT_NAMES[i]);
    const bot = {
      id: i,
      name: BOT_NAMES[i],
      pos: { x: home[0], z: home[1] },
      yaw: 0, // face south, toward the attackers (mesh forward is +z)
      health: 100,
      alive: true,
      state: 'hold',
      patrolIndex: 0,
      patrol: hold.patrol,
      home: hold.home,
      path: [],
      pathIndex: 0,
      aimTime: 0,
      burstLeft: 0,
      burstTimer: 0,
      fireCooldown: 1 + random() * 0.8,
      lastSeen: null,
      hearPos: null,
      hearAt: -99,
      strafeDir: 1,
      strafeTimer: 0,
      defuseProgress: 0,
      fallT: 0,
      mesh,
      hitMeshes: [],
    };
    mesh.body.userData = { bot, part: 'body' };
    mesh.head.userData = { bot, part: 'head' };
    bot.hitMeshes = [mesh.body, mesh.head];
    bot.mesh.group.position.set(home[0], 0, home[1]);
    bots.push(bot);
  }

  let aiTimer = 0;

  function reset() {
    for (const bot of bots) {
      const home = NAV_NODES[bot.home];
      bot.pos.x = home[0];
      bot.pos.z = home[1];
      bot.yaw = 0;
      bot.health = 100;
      bot.alive = true;
      bot.state = 'hold';
      bot.patrolIndex = 0;
      bot.path = [];
      bot.pathIndex = 0;
      bot.aimTime = 0;
      bot.burstLeft = 0;
      bot.burstTimer = 0;
      bot.fireCooldown = 1 + random() * 0.8;
      bot.lastSeen = null;
      bot.hearPos = null;
      bot.defuseProgress = 0;
      bot.fallT = 0;
      bot.mesh.group.visible = true;
      bot.mesh.group.rotation.x = 0;
      bot.mesh.group.position.set(home[0], 0, home[1]);
      bot.mesh.group.scale.set(1, 1, 1);
    }
  }

  function setPath(bot, tx, tz) {
    bot.path = findPath(bot.pos.x, bot.pos.z, tx, tz);
    bot.pathIndex = 0;
  }

  function stepAlongPath(bot, dt, speed) {
    if (bot.pathIndex >= bot.path.length) return true;
    const [tx, tz] = bot.path[bot.pathIndex];
    const dx = tx - bot.pos.x;
    const dz = tz - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) {
      bot.pathIndex += 1;
      return bot.pathIndex >= bot.path.length;
    }
    const vx = (dx / d) * speed;
    const vz = (dz / d) * speed;
    const before = { x: bot.pos.x, z: bot.pos.z };
    moveWithCollision(bot.pos, BOT_RADIUS, vx * dt, vz * dt);
    const moved = dist2D(before.x, before.z, bot.pos.x, bot.pos.z);
    if (moved < 0.01) {
      // Stuck on a corner: sidestep and re-path once.
      bot.pathIndex += 1;
    }
    bot.yaw = Math.atan2(dx, dz); // mesh forward is +z: face the direction of travel
    return false;
  }

  // The 10 Hz brain: pick a state and a destination.
  function think(bot, ctx, now) {
    const p = ctx.playerPos;
    const dist = dist2D(bot.pos.x, bot.pos.z, p.x, p.z);
    const canSee = ctx.playerAlive && dist < ENGAGE_RANGE &&
      !losBlocked(bot.pos.x, bot.pos.z, p.x, p.z);
    if (canSee) {
      bot.lastSeen = { x: p.x, z: p.z, at: now };
      bot.state = 'engage';
      bot.aimTime += 0.1;
      return;
    }
    bot.aimTime = Math.max(0, bot.aimTime - 0.2);
    if (ctx.spikePlanted && bot.alive) {
      const site = ctx.spikeSite;
      const dSite = dist2D(bot.pos.x, bot.pos.z, site.x, site.z);
      if (bot.state !== 'defuse' && dSite > 1.2) {
        bot.state = 'rush';
        setPath(bot, site.x, site.z);
      } else if (dSite <= 1.2) {
        bot.state = 'defuse';
      }
      return;
    }
    // Fresh gunfire nearby: go look.
    if (bot.hearPos && now - bot.hearAt < 4) {
      if (bot.state !== 'investigate') {
        bot.state = 'investigate';
        setPath(bot, bot.hearPos.x, bot.hearPos.z);
      }
      return;
    }
    // A stale last-seen position is worth one check.
    if (bot.lastSeen && now - bot.lastSeen.at < 6 && bot.state !== 'investigate') {
      bot.state = 'investigate';
      setPath(bot, bot.lastSeen.x, bot.lastSeen.z);
      return;
    }
    if (bot.state === 'investigate' && bot.pathIndex >= bot.path.length) {
      bot.state = 'patrol';
      bot.lastSeen = null;
      bot.hearPos = null;
    }
    if (bot.state === 'hold' || bot.state === 'patrol') {
      if (bot.state === 'hold' && now - (bot.holdSince || 0) > 6 + bot.id) {
        bot.state = 'patrol';
        bot.patrolIndex = 0;
      }
      if (bot.state === 'patrol' && bot.pathIndex >= bot.path.length) {
        bot.patrolIndex = (bot.patrolIndex + 1) % bot.patrol.length;
        const node = NAV_NODES[bot.patrol[bot.patrolIndex]];
        setPath(bot, node[0], node[1]);
      }
    }
  }

  function damage(bot, amount, part) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.state = 'dead';
      bot.fallT = 0.0001;
      return true;
    }
    // Being shot makes a bot turn toward the shooter.
    return false;
  }

  // Fixed-step update for all bots.
  function update(dt, ctx, now) {
    aiTimer += dt;
    const thinkNow = aiTimer >= 0.1;
    if (thinkNow) aiTimer = 0;
    for (const bot of bots) {
      if (!bot.alive) {
        if (bot.fallT > 0 && bot.fallT < 1) {
          bot.fallT = Math.min(1, bot.fallT + dt * 2.5);
          bot.mesh.group.rotation.x = -bot.fallT * Math.PI * 0.5;
          bot.mesh.group.position.y = -bot.fallT * 0.25;
        }
        continue;
      }
      if (thinkNow) think(bot, ctx, now);
      const p = ctx.playerPos;
      const dist = dist2D(bot.pos.x, bot.pos.z, p.x, p.z);

      if (bot.state === 'engage' && ctx.playerAlive) {
        // Face the player, strafe a little, and fire in bursts.
        const wantYaw = Math.atan2(p.x - bot.pos.x, p.z - bot.pos.z);
        let dy = wantYaw - bot.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        bot.yaw += clamp(dy, -3.2 * dt, 3.2 * dt);
        bot.strafeTimer -= dt;
        if (bot.strafeTimer <= 0) {
          bot.strafeDir = random() < 0.5 ? -1 : 1;
          bot.strafeTimer = 0.7 + random() * 0.9;
        }
        const strafeX = Math.cos(bot.yaw) * bot.strafeDir * BOT_SPEED * 0.45;
        const strafeZ = -Math.sin(bot.yaw) * bot.strafeDir * BOT_SPEED * 0.45;
        moveWithCollision(bot.pos, BOT_RADIUS, strafeX * dt, strafeZ * dt);
        // Fire bursts once the bot has aimed for a beat.
        bot.fireCooldown -= dt;
        if (bot.burstLeft > 0) {
          bot.burstTimer -= dt;
          if (bot.burstTimer <= 0) {
            bot.burstTimer = 0.13;
            bot.burstLeft -= 1;
            fireAt(bot, ctx, dist);
          }
        } else if (bot.fireCooldown <= 0 && bot.aimTime > 0.25) {
          bot.burstLeft = 3 + Math.floor(random() * 3);
          bot.fireCooldown = 0.9 + random() * 0.7;
        }
      } else if (bot.state === 'defuse') {
        // Channel the defuse; the round logic watches defuseProgress.
        bot.defuseProgress += dt;
        bot.yaw += dt * 0.4;
      } else if (bot.state === 'rush') {
        const arrived = stepAlongPath(bot, dt, BOT_RUSH_SPEED);
        if (arrived) bot.state = 'defuse';
      } else if (bot.state === 'investigate' || bot.state === 'patrol') {
        stepAlongPath(bot, dt, BOT_SPEED);
      } else {
        // hold: scan the lane slowly.
        bot.yaw += Math.sin(now * 0.5 + bot.id * 2) * dt * 0.35;
      }

      bot.mesh.group.position.set(bot.pos.x, bot.mesh.group.position.y, bot.pos.z);
      bot.mesh.group.rotation.y = bot.yaw;
    }
  }

  function fireAt(bot, ctx, dist) {
    // Hit chance falls with distance and with a moving, crouched target.
    let chance = 0.55 - dist * 0.01;
    if (ctx.playerMoving) chance -= 0.12;
    if (ctx.playerCrouched) chance -= 0.1;
    chance = clamp(chance, 0.08, 0.65);
    const hit = random() < chance;
    const from = { x: bot.pos.x, y: EYE, z: bot.pos.z };
    let damageAmount = 0;
    let headshot = false;
    if (hit) {
      damageAmount = 8 + random() * 5;
      if (random() < 0.12) {
        headshot = true;
        damageAmount *= 1.5;
      }
    }
    if (ctx.onBotShot) ctx.onBotShot(bot, from, hit, damageAmount, headshot);
  }

  function hearShot(x, z, now) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      if (dist2D(bot.pos.x, bot.pos.z, x, z) < HEAR_RANGE) {
        bot.hearPos = { x, z };
        bot.hearAt = now;
      }
    }
  }

  function aliveCount() {
    let n = 0;
    for (const bot of bots) if (bot.alive) n += 1;
    return n;
  }

  function allHitMeshes() {
    const out = [];
    for (const bot of bots) if (bot.alive) out.push(...bot.hitMeshes);
    return out;
  }

  return { bots, reset, update, damage, hearShot, aliveCount, allHitMeshes };
}
