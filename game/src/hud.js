// The HUD: every DOM element the game shows, updated from simulation state.
// The HUD never owns game state — it only renders it.
import { PALETTE } from './palette.js';
import { WEAPONS } from './weapons.js';
import { SITES } from './world.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    healthFill: $('health-fill'),
    healthNum: $('health-num'),
    armorFill: $('armor-fill'),
    armorRow: $('armor-row'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    ammoBox: $('ammo'),
    weaponName: $('weapon-name'),
    timer: $('timer'),
    roundLabel: $('round-label'),
    scoreYou: $('score-you'),
    scoreThem: $('score-them'),
    money: $('money'),
    kills: $('kills'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    killfeed: $('killfeed'),
    message: $('message'),
    plantBar: $('plant-bar'),
    plantFill: $('plant-fill'),
    plantLabel: $('plant-label'),
    defuseWarn: $('defuse-warn'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    playBtn: $('play'),
    buyMenu: $('buy-menu'),
    buyList: $('buy-list'),
    minimap: $('minimap'),
    grenades: $('grenades'),
  };
  const mapCtx = els.minimap ? els.minimap.getContext('2d') : null;

  let messageTimer = 0;
  let hitTimer = 0;

  function setAmmo(mag, reserve, grenades) {
    els.ammoMag.textContent = String(mag);
    els.ammoReserve.textContent = `/ ${reserve}`;
    els.ammoBox.classList.toggle('empty', mag === 0);
    els.grenades.textContent = grenades > 0 ? `◉ ${grenades}` : '';
  }

  function setHealth(health, armor) {
    els.healthNum.textContent = String(Math.ceil(health));
    els.healthFill.style.width = `${Math.max(0, health)}%`;
    els.healthFill.style.background = health > 50 ? '#4ecb71' : health > 25 ? '#f0a830' : '#e5484d';
    els.armorRow.style.display = armor > 0 ? 'flex' : 'none';
    els.armorFill.style.width = `${Math.max(0, armor)}%`;
  }

  function setTimer(seconds, phase) {
    const s = Math.max(0, Math.ceil(seconds));
    els.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    els.timer.classList.toggle('danger', seconds < 15 && (phase === 'live' || phase === 'planted'));
    els.timer.classList.toggle('planted', phase === 'planted');
  }

  function setScore(round, you, them, money, kills) {
    els.roundLabel.textContent = `ROUND ${round}`;
    els.scoreYou.textContent = String(you);
    els.scoreThem.textContent = String(them);
    els.money.textContent = `$${money}`;
    els.kills.textContent = `☠ ${kills}`;
  }

  function setWeapon(id) {
    els.weaponName.textContent = WEAPONS[id].name;
  }

  function setCrosshairGap(px) {
    els.crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
  }

  function flashHit(headshot) {
    els.hitmarker.classList.add('on');
    els.hitmarker.classList.toggle('head', headshot);
    hitTimer = 0.12;
  }

  function killfeed(text, good) {
    const line = document.createElement('div');
    line.className = `feed-line${good ? ' good' : ''}`;
    line.textContent = text;
    els.killfeed.prepend(line);
    while (els.killfeed.children.length > 4) els.killfeed.lastChild.remove();
    setTimeout(() => line.remove(), 6000);
  }

  function showMessage(text, seconds = 2.5) {
    els.message.textContent = text;
    els.message.classList.remove('hidden');
    messageTimer = seconds;
  }

  function tick(dt) {
    if (messageTimer > 0) {
      messageTimer -= dt;
      if (messageTimer <= 0) els.message.classList.add('hidden');
    }
    if (hitTimer > 0) {
      hitTimer -= dt;
      if (hitTimer <= 0) els.hitmarker.classList.remove('on', 'head');
    }
  }

  function showPlant(progress, planting, siteLabel) {
    if (planting || progress > 0) {
      els.plantBar.classList.remove('hidden');
      els.plantFill.style.width = `${Math.min(100, progress * 100)}%`;
      els.plantLabel.textContent = planting ? `PLANTING SPIKE — ${siteLabel}` : 'PLANT INTERRUPTED';
    } else {
      els.plantBar.classList.add('hidden');
    }
  }

  function showDefuseWarning(on, name) {
    els.defuseWarn.classList.toggle('hidden', !on);
    if (on) els.defuseWarn.textContent = `⚠ ${name} IS DEFUSING THE SPIKE`;
  }

  // Overlays: 'start' | 'paused' | 'round' | 'match' | null (hidden).
  function showOverlay(kind, data = {}) {
    if (!kind) {
      els.overlay.hidden = true;
      return;
    }
    els.overlay.hidden = false;
    els.buyMenu.classList.add('hidden');
    const t = els.overlayTitle;
    const c = els.overlayCopy;
    const btn = els.playBtn;
    if (kind === 'start') {
      t.textContent = 'SITE BREACH';
      c.innerHTML = 'Halcyon Depot. Four defenders hold two sites. Plant the spike at A or B — or drop them all. First to 5 rounds takes the match.<br><br><b>Buy phase:</b> press B to open the buy menu before the round starts.';
      btn.textContent = 'Click to play';
      btn.style.display = '';
    } else if (kind === 'paused') {
      t.textContent = 'PAUSED';
      c.textContent = 'Click to resume. Your round is waiting.';
      btn.textContent = 'Resume';
      btn.style.display = '';
    } else if (kind === 'round') {
      t.textContent = data.winner === 'you' ? 'ROUND WON' : 'ROUND LOST';
      c.textContent = `${data.reason} — ${data.you} : ${data.them}`;
      btn.textContent = data.matchOver ? 'See match result' : 'Next round';
      btn.style.display = '';
    } else if (kind === 'match') {
      t.textContent = data.winner === 'you' ? 'MATCH WON' : 'MATCH LOST';
      c.textContent = `Final score ${data.you} : ${data.them} — ${data.kills} eliminations. The depot is ${data.winner === 'you' ? 'yours' : 'still theirs'}.`;
      btn.textContent = 'Play again';
      btn.style.display = '';
    }
  }

  function buildBuyMenu(money, weaponState, onBuy) {
    const list = els.buyList;
    list.innerHTML = '';
    const rows = [
      ...Object.values(WEAPONS).map((w) => ({
        key: w.id, label: `${w.name} — $${w.price}`, price: w.price,
        owned: weaponState.owned[w.id], disabled: weaponState.owned[w.id] || money < w.price,
      })),
      { key: 'grenade', label: `Frag Grenade — $300`, price: 300, owned: false, disabled: money < 300 },
      { key: 'armor', label: `Kevlar Armor — $400`, price: 400, owned: false, disabled: money < 400 },
    ];
    for (const row of rows) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'buy-row';
      b.disabled = row.disabled;
      b.textContent = row.owned ? `${row.label} ✓ OWNED` : row.label;
      b.addEventListener('click', () => onBuy(row.key));
      list.appendChild(b);
    }
    els.buyMenu.classList.remove('hidden');
  }

  function hideBuyMenu() {
    els.buyMenu.classList.add('hidden');
  }

  // Top-down minimap: walls, sites, player arrow, defender dots.
  function drawMinimap(playerPos, yaw, bots, sites, spikeSite) {
    if (!mapCtx) return;
    const W = 168;
    const H = 120;
    const sx = (x) => ((x + 33) / 66) * W;
    const sz = (z) => ((z + 23) / 46) * H;
    mapCtx.clearRect(0, 0, W, H);
    mapCtx.fillStyle = 'rgba(20, 24, 30, 0.85)';
    mapCtx.fillRect(0, 0, W, H);
    mapCtx.fillStyle = '#4a525e';
    // Cross wall with its three gaps.
    for (const [x, w] of [[-28, 8], [-10, 12], [10, 12], [28, 8]]) {
      mapCtx.fillRect(sx(x - w / 2), sz(-4.5), (w / 66) * W, 2);
    }
    mapCtx.fillRect(sx(-32.5), sz(-22.5), W, 2);
    mapCtx.fillRect(sx(-32.5), sz(22), W, 2);
    mapCtx.fillRect(sx(-32.5), sz(-22.5), 2, H);
    mapCtx.fillRect(sx(32), sz(-22.5), 2, H);
    for (const site of sites) {
      const flashing = spikeSite === site.id;
      mapCtx.fillStyle = flashing ? '#ffffff' : `#${site.color.toString(16).padStart(6, '0')}`;
      mapCtx.font = 'bold 13px monospace';
      mapCtx.fillText(site.id, sx(site.x) - 4, sz(site.z) + 4);
    }
    for (const bot of bots) {
      if (!bot.alive) continue;
      mapCtx.fillStyle = '#d23c2e';
      mapCtx.beginPath();
      mapCtx.arc(sx(bot.pos.x), sz(bot.pos.z), 3.5, 0, Math.PI * 2);
      mapCtx.fill();
    }
    // Player arrow.
    mapCtx.save();
    mapCtx.translate(sx(playerPos.x), sz(playerPos.z));
    mapCtx.rotate(Math.atan2(Math.sin(yaw), -Math.cos(yaw)) + Math.PI);
    mapCtx.fillStyle = '#35c4e8';
    mapCtx.beginPath();
    mapCtx.moveTo(0, -6);
    mapCtx.lineTo(4.5, 5);
    mapCtx.lineTo(-4.5, 5);
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.restore();
  }

  return {
    setAmmo, setHealth, setTimer, setScore, setWeapon, setCrosshairGap,
    flashHit, killfeed, showMessage, tick, showPlant, showDefuseWarning,
    showOverlay, buildBuyMenu, hideBuyMenu, drawMinimap,
    onPlay(cb) { els.playBtn.addEventListener('click', cb); },
    els,
  };
}
