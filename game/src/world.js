// Halcyon Depot: an original three-lane map built for Site Breach.
// Attackers spawn south. Site A sits north-west, Site B north-east, and a cross
// wall at z = -4 splits the map into a south half and a north half, with one gap
// per lane (west, mid, east). Bots navigate on a small hand-placed node graph;
// every edge was checked to run through open ground.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { segmentHitsRect, mulberry32 } from './util.js';

// Each collider is an axis-aligned box: centre (x, z), half extents (hw, hd),
// height h. Walls taller than 1.5 m also block line of sight.
export const COLLIDERS = [
  // Outer walls
  { x: 0, z: -22.5, hw: 32, hd: 0.5, h: 4 },
  { x: 0, z: 22.5, hw: 32, hd: 0.5, h: 4 },
  { x: -32.5, z: 0, hw: 0.5, hd: 22, h: 4 },
  { x: 32.5, z: 0, hw: 0.5, hd: 22, h: 4 },
  // Cross wall at z = -4, one gap per lane
  { x: -28, z: -4, hw: 4, hd: 0.5, h: 3.4 },
  { x: -10, z: -4, hw: 6, hd: 0.5, h: 3.4 },
  { x: 10, z: -4, hw: 6, hd: 0.5, h: 3.4 },
  { x: 28, z: -4, hw: 4, hd: 0.5, h: 3.4 },
  // Site pocket walls (leave a corridor into each site from the north plaza)
  { x: -14, z: -16, hw: 0.5, hd: 6, h: 3.4 },
  { x: 14, z: -16, hw: 0.5, hd: 6, h: 3.4 },
  // Plaza pillars
  { x: -6, z: -14, hw: 0.8, hd: 0.8, h: 4 },
  { x: 6, z: -14, hw: 0.8, hd: 0.8, h: 4 },
  // Crates (full cover)
  { x: -26, z: -18, hw: 1, hd: 1, h: 1.2 },
  { x: -18, z: -18, hw: 1, hd: 1, h: 1.2 },
  { x: -26, z: -10, hw: 1, hd: 1, h: 1.2 },
  { x: 26, z: -18, hw: 1, hd: 1, h: 1.2 },
  { x: 18, z: -18, hw: 1, hd: 1, h: 1.2 },
  { x: 26, z: -10, hw: 1, hd: 1, h: 1.2 },
  { x: -10, z: 12, hw: 1.2, hd: 1.2, h: 1.2 },
  { x: 10, z: 12, hw: 1.2, hd: 1.2, h: 1.2 },
  { x: 0, z: 11, hw: 1, hd: 1, h: 1.2 },
  { x: -6, z: 18, hw: 1, hd: 1, h: 1.2 },
  { x: 6, z: 18, hw: 1, hd: 1, h: 1.2 },
  // Low cover walls (shoot over them from standing eye height)
  { x: -20, z: 4, hw: 3, hd: 0.5, h: 1.1 },
  { x: 20, z: 4, hw: 3, hd: 0.5, h: 1.1 },
  { x: 0, z: -8, hw: 2, hd: 0.5, h: 1.1 },
];

// Bomb sites: name, centre, marker colour.
export const SITES = [
  { id: 'A', x: -22, z: -14, color: PALETTE.siteA, label: 'SITE A' },
  { id: 'B', x: 22, z: -14, color: PALETTE.siteB, label: 'SITE B' },
];
export const SITE_RADIUS = 3.5;

// Bot navigation graph: node positions and adjacency. Edges run through open
// ground only (checked against COLLIDERS when the module loads in dev; the
// list below is the hand-verified result).
export const NAV_NODES = [
  [0, 18], // 0 spawn
  [0, 8], // 1 mid south
  [-20, 2], // 2 west lane south
  [20, 2], // 3 east lane south
  [-20, -4], // 4 west gap
  [0, -4], // 5 mid gap
  [20, -4], // 6 east gap
  [-22, -14], // 7 site A
  [22, -14], // 8 site B
  [0, -14], // 9 north plaza
  [-28, -16], // 10 A corner
  [28, -16], // 11 B corner
  [-12, -12], // 12 A approach
  [12, -12], // 13 B approach
  [-20, -10], // 14 A approach south
  [20, -10], // 15 B approach south
];
export const NAV_EDGES = [
  [0, 1], [1, 2], [1, 3], [1, 5], [1, 4], [1, 6],
  [2, 4], [3, 6], [2, 14], [3, 15],
  [4, 14], [14, 7], [14, 12], [12, 7], [7, 10],
  [6, 15], [15, 8], [15, 13], [13, 8], [8, 11],
  [5, 9], [5, 12], [5, 13], [12, 9], [9, 13],
];

const NAV_ADJ = NAV_NODES.map(() => []);
for (const [a, b] of NAV_EDGES) {
  NAV_ADJ[a].push(b);
  NAV_ADJ[b].push(a);
}

// Breadth-first path between two ground points, via the nearest graph nodes.
// Returns an array of [x, z] waypoints (excluding the start point).
export function findPath(fromX, fromZ, toX, toZ) {
  let start = 0;
  let goal = 0;
  let best = Infinity;
  for (let i = 0; i < NAV_NODES.length; i++) {
    const dx = NAV_NODES[i][0] - fromX;
    const dz = NAV_NODES[i][1] - fromZ;
    const d = dx * dx + dz * dz;
    if (d < best) { best = d; start = i; }
  }
  best = Infinity;
  for (let i = 0; i < NAV_NODES.length; i++) {
    const dx = NAV_NODES[i][0] - toX;
    const dz = NAV_NODES[i][1] - toZ;
    const d = dx * dx + dz * dz;
    if (d < best) { best = d; goal = i; }
  }
  const prev = new Array(NAV_NODES.length).fill(-1);
  const queue = [start];
  prev[start] = start;
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === goal) break;
    for (const next of NAV_ADJ[cur]) {
      if (prev[next] === -1) {
        prev[next] = cur;
        queue.push(next);
      }
    }
  }
  const path = [];
  let cur = goal;
  if (prev[cur] === -1) return [[toX, toZ]];
  while (cur !== start) {
    path.push(NAV_NODES[cur]);
    cur = prev[cur];
  }
  path.reverse();
  path.push([toX, toZ]);
  return path;
}

// True when a tall collider stands between two ground points.
export function losBlocked(x1, z1, x2, z2) {
  for (const c of COLLIDERS) {
    if (c.h < 1.5) continue;
    if (segmentHitsRect(x1, z1, x2, z2, c.x, c.z, c.hw, c.hd)) return true;
  }
  return false;
}

// Axis-separated AABB movement: move x, resolve, then move z, resolve.
// pos is {x, z}; radius is the body's half-width. Returns true if it hit a wall.
export function moveWithCollision(pos, radius, dx, dz) {
  let hit = false;
  let nx = pos.x + dx;
  for (const c of COLLIDERS) {
    if (nx + radius > c.x - c.hw && nx - radius < c.x + c.hw &&
        pos.z + radius > c.z - c.hd && pos.z - radius < c.z + c.hd) {
      nx = dx > 0 ? c.x - c.hw - radius : c.x + c.hw + radius;
      hit = true;
    }
  }
  pos.x = nx;
  let nz = pos.z + dz;
  for (const c of COLLIDERS) {
    if (pos.x + radius > c.x - c.hw && pos.x - radius < c.x + c.hw &&
        nz + radius > c.z - c.hd && nz - radius < c.z + c.hd) {
      nz = dz > 0 ? c.z - c.hd - radius : c.z + c.hd + radius;
      hit = true;
    }
  }
  pos.z = nz;
  return hit;
}

export function createWorld(scene) {
  const shootables = [];
  const lambert = (color) => new THREE.MeshLambertMaterial({ color });

  // Ground: a concrete tile texture generated at runtime (no external asset).
  // 512 px canvas = 4x4 tiles; repeated so each tile is ~2 m on the floor.
  const groundTex = (() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#8a8d84';
    g.fillRect(0, 0, 512, 512);
    const shades = ['#8f9289', '#85887f', '#93968d', '#82857c'];
    for (let ty = 0; ty < 4; ty++) {
      for (let tx = 0; tx < 4; tx++) {
        g.fillStyle = shades[(tx + ty * 3) % 4];
        g.fillRect(tx * 128 + 2, ty * 128 + 2, 124, 124);
      }
    }
    // Speckles for a worn-concrete read (seeded, so every load looks the same).
    const rnd = mulberry32(7);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
      g.fillRect(rnd() * 512, rnd() * 512, 2, 2);
    }
    // Tile seams.
    g.strokeStyle = 'rgba(40,44,48,0.55)';
    g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 512); g.stroke();
      g.beginPath(); g.moveTo(0, i * 128); g.lineTo(512, i * 128); g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 6);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(66, 46),
    new THREE.MeshLambertMaterial({ map: groundTex }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  shootables.push(ground);

  // Painted lane guides on the floor: thin strips that read as a map at a glance.
  const stripeMat = new THREE.MeshBasicMaterial({ color: PALETTE.groundLine });
  for (const [x, z, w, d] of [[-20, 8, 0.5, 26], [0, 8, 0.5, 26], [20, 8, 0.5, 26], [0, -13, 44, 0.5]]) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(w, d), stripeMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(x, 0.01, z);
    scene.add(stripe);
  }

  const wallMat = lambert(PALETTE.wall);
  const wallDarkMat = lambert(PALETTE.wallDark);
  const wallTopMat = lambert(PALETTE.wallTop);
  // Per-area tones: the north (site) half reads cool steel blue, the south
  // (spawn) half warm sand — the map reads at a glance without moving a collider.
  const wallNorthMat = lambert(0x7d8aa0);
  const wallSouthMat = lambert(0x9a938a);
  const crateMat = lambert(PALETTE.crate);
  const crateDarkMat = lambert(PALETTE.crateDark);
  for (const c of COLLIDERS) {
    const isLow = c.h <= 1.2 && c.hw + c.hd <= 4 && !(c.hw >= 4 || c.hd >= 4);
    const isCrate = c.h === 1.2 && c.hw <= 1.2 && c.hd <= 1.2;
    const geo = new THREE.BoxGeometry(c.hw * 2, c.h, c.hd * 2);
    const mat = isCrate ? crateMat : isLow ? crateDarkMat : (c.z < -4 ? wallNorthMat : wallSouthMat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(c.x, c.h / 2, c.z);
    mesh.castShadow = c.h > 1.5;
    mesh.receiveShadow = true;
    scene.add(mesh);
    shootables.push(mesh);
    if (c.h > 1.5) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(c.hw * 2 + 0.12, 0.12, c.hd * 2 + 0.12), wallTopMat);
      cap.position.set(c.x, c.h + 0.06, c.z);
      scene.add(cap);
    } else if (isCrate) {
      // Crates get a darker lid so they read as containers, not grey blocks.
      const lid = new THREE.Mesh(new THREE.BoxGeometry(c.hw * 2 + 0.08, 0.08, c.hd * 2 + 0.08), crateDarkMat);
      lid.position.set(c.x, c.h + 0.04, c.z);
      scene.add(lid);
    }
  }

  // Sodium lamp posts: warm pools of light down the three lanes.
  const lampPositions = [[-20, 10], [0, 10], [20, 10], [-20, -8], [0, -8], [20, -8], [-22, -18], [22, -18]];
  const poleMat = lambert(0x22262c);
  const bulbMat = new THREE.MeshBasicMaterial({ color: PALETTE.accent });
  for (const [x, z] of lampPositions) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.6, 8), poleMat);
    pole.position.set(x, 2.3, z);
    scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), bulbMat);
    bulb.position.set(x, 4.7, z);
    scene.add(bulb);
    const light = new THREE.PointLight(PALETTE.accent, 14, 16, 1.8);
    light.position.set(x, 4.4, z);
    scene.add(light);
  }

  // Site markers: a glowing ring on the floor and a floating hologram letter.
  const siteMarkers = [];
  for (const site of SITES) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(SITE_RADIUS - 0.25, SITE_RADIUS, 40),
      new THREE.MeshBasicMaterial({ color: site.color, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.03, site.z);
    scene.add(ring);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(SITE_RADIUS - 0.3, 32),
      new THREE.MeshBasicMaterial({ color: site.color, transparent: true, opacity: 0.1, side: THREE.DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(site.x, 0.025, site.z);
    scene.add(disc);
    siteMarkers.push({ site, ring, disc, pulse: 0 });
  }

  // The spike device: a small blinking charge, hidden until a plant lands.
  const spike = new THREE.Group();
  const spikeBody = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.55), lambert(0x22262c));
  spikeBody.position.y = 0.16;
  spikeBody.castShadow = true;
  spike.add(spikeBody);
  const spikeLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 10, 8),
    new THREE.MeshBasicMaterial({ color: PALETTE.accent }),
  );
  spikeLamp.position.y = 0.4;
  spike.add(spikeLamp);
  const spikeLight = new THREE.PointLight(PALETTE.accent, 0, 12, 1.8);
  spikeLight.position.y = 1;
  spike.add(spikeLight);
  spike.visible = false;
  scene.add(spike);

  return { shootables, siteMarkers, spike, spikeLight };
}
