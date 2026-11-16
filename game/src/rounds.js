// Round and match state: buy phase, live round, planted spike, round end,
// and the first-to-5 match. Money is earned for kills, plants and round wins
// and spent in the buy menu. All numbers are the game's own economy.
import { SITES, SITE_RADIUS } from './world.js';
import { dist2D } from './util.js';
import { WEAPONS, GRENADE_PRICE, ARMOR_PRICE, buyWeapon } from './weapons.js';

export const ROUND_TIME = 100;
export const BUY_TIME = 10;
export const SPIKE_TIME = 35;
export const PLANT_TIME = 3;
export const ROUNDS_TO_WIN = 5;
export const START_MONEY = 800;
export const WIN_MONEY = 600;
export const LOSS_MONEY = 400;
export const KILL_MONEY = 150;
export const PLANT_MONEY = 300;

export function createRounds() {
  const state = {
    phase: 'buy', // buy | live | planted | over | match
    phaseTime: BUY_TIME,
    round: 1,
    scoreYou: 0,
    scoreThem: 0,
    kills: 0,
    deaths: 0,
    money: START_MONEY,
    plantedSite: null,
    plantProgress: 0,
    planting: false,
    spikeTimer: SPIKE_TIME,
    defuser: null,
    roundWinner: null, // 'you' | 'them' | null
    roundReason: '',
    matchWinner: null,
    overAt: 0,
  };

  function startRound() {
    state.phase = 'buy';
    state.phaseTime = BUY_TIME;
    state.plantedSite = null;
    state.plantProgress = 0;
    state.planting = false;
    state.spikeTimer = SPIKE_TIME;
    state.defuser = null;
    state.roundWinner = null;
    state.roundReason = '';
  }

  function startMatch() {
    state.round = 1;
    state.scoreYou = 0;
    state.scoreThem = 0;
    state.kills = 0;
    state.deaths = 0;
    state.money = START_MONEY;
    state.matchWinner = null;
    startRound();
  }

  function endRound(winner, reason, events) {
    if (state.phase === 'over' || state.phase === 'match') return;
    state.roundWinner = winner;
    state.roundReason = reason;
    state.phase = 'over';
    state.phaseTime = 5;
    if (winner === 'you') {
      state.scoreYou += 1;
      state.money += WIN_MONEY;
    } else {
      state.scoreThem += 1;
      state.money += LOSS_MONEY;
    }
    if (events.onRoundEnd) events.onRoundEnd(winner, reason);
    if (state.scoreYou >= ROUNDS_TO_WIN || state.scoreThem >= ROUNDS_TO_WIN) {
      state.matchWinner = winner;
    }
  }

  function nextRound(events) {
    if (state.matchWinner) {
      state.phase = 'match';
      state.phaseTime = 0;
      if (events.onMatchEnd) events.onMatchEnd(state.matchWinner);
      return;
    }
    state.round += 1;
    startRound();
    if (events.onRoundStart) events.onRoundStart(state.round);
  }

  // Fixed-step update. ctx: {player, bots, input, plantHeld, now, events}.
  function update(dt, ctx) {
    const { player, bots, input } = ctx;
    if (state.phase === 'buy') {
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) {
        state.phase = 'live';
        state.phaseTime = ROUND_TIME;
        if (ctx.events.onLive) ctx.events.onLive();
      }
      return;
    }
    if (state.phase === 'over') {
      // The round-end screen waits for the player to press Next round.
      state.phaseTime = Math.max(0, state.phaseTime - dt);
      return;
    }
    if (state.phase === 'match') return;

    // Planting: hold the plant key inside a site while alive.
    const alive = player.state.alive;
    let nearSite = null;
    if (alive && !state.plantedSite) {
      for (const site of SITES) {
        if (dist2D(player.state.position.x, player.state.position.z, site.x, site.z) < SITE_RADIUS) {
          nearSite = site;
          break;
        }
      }
    }
    state.planting = Boolean(nearSite && input.plantHeld && alive);
    if (state.planting) {
      state.plantProgress += dt;
      if (state.plantProgress >= PLANT_TIME) {
        state.plantedSite = nearSite;
        state.phase = 'planted';
        state.spikeTimer = SPIKE_TIME;
        state.money += PLANT_MONEY;
        state.plantProgress = 0;
        if (ctx.events.onPlant) ctx.events.onPlant(nearSite);
      }
    } else {
      state.plantProgress = Math.max(0, state.plantProgress - dt * 2);
    }

    if (state.phase === 'live') {
      state.phaseTime -= dt;
      if (bots.aliveCount() === 0) {
        endRound('you', 'All defenders eliminated', ctx.events);
        return;
      }
      if (!alive) {
        state.deaths += 1;
        endRound('them', 'You were eliminated', ctx.events);
        return;
      }
      if (state.phaseTime <= 0) {
        endRound('them', 'Time expired — the spike was never planted', ctx.events);
        return;
      }
    }

    if (state.phase === 'planted') {
      state.spikeTimer -= dt;
      // A bot channeling the defuse for the full time wins the round.
      const defuser = bots.bots.find((b) => b.alive && b.state === 'defuse');
      state.defuser = defuser || null;
      if (defuser && defuser.defuseProgress >= 5) {
        endRound('them', `${defuser.name} defused the spike`, ctx.events);
        return;
      }
      if (!alive && bots.aliveCount() === 0) {
        endRound('you', 'The spike detonated', ctx.events);
        return;
      }
      // When you are down with the spike ticking, main.js runs the world at
      // 4x speed, so the nearest bot's real walk + 5 s defuse channel decides
      // the round against the spike timer — no scripted outcome here.
      if (state.spikeTimer <= 0) {
        endRound('you', 'The spike detonated', ctx.events);
        return;
      }
    }
  }

  function onKill() {
    state.kills += 1;
    state.money += KILL_MONEY;
  }

  function tryBuy(id) {
    const def = WEAPONS[id];
    if (!def) return false;
    if (state.phase !== 'buy') return false;
    return true;
  }

  function buyGrenade() {
    if (state.phase !== 'buy') return false;
    if (state.money < GRENADE_PRICE) return false;
    state.money -= GRENADE_PRICE;
    return true;
  }

  function buyArmor(player) {
    if (state.phase !== 'buy') return false;
    if (player.state.armor >= 100) return false;
    if (state.money < ARMOR_PRICE) return false;
    state.money -= ARMOR_PRICE;
    player.state.armor = 100;
    return true;
  }

  return {
    state, startRound, startMatch, endRound, nextRound, update, onKill,
    tryBuy, buyGrenade, buyArmor,
  };
}
