// The player body: acceleration-based movement with crouching, jumping and
// axis-separated collision against the map. The simulation owns this state;
// rendering only reads it.
import { clamp } from './util.js';
import { moveWithCollision } from './world.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.05;
export const RADIUS = 0.38;
export const HEIGHT = 1.7;

const WALK_SPEED = 4.6;
const SPRINT_SPEED = 6.4;
const CROUCH_SPEED = 2.4;
const ACCEL = 42;
const FRICTION = 11;
const GRAVITY = 15;
const JUMP_SPEED = 5.4;

export function createPlayer() {
  const state = {
    position: { x: 0, y: 0, z: 18 }, // ground position (feet)
    velocity: { x: 0, z: 0 },
    vy: 0,
    yaw: 0, // facing -z (north, toward the sites)
    pitch: 0,
    eye: EYE_STAND,
    crouched: false,
    onGround: true,
    moving: false,
    sprinting: false,
    health: 100,
    armor: 0,
    alive: true,
  };

  // Fixed-step update. input: {forward, strafe, sprint, crouch, jump}.
  // Returns nothing; state is mutated in place.
  function update(dt, input) {
    const speed = input.crouch ? CROUCH_SPEED : input.sprint ? SPRINT_SPEED : WALK_SPEED;
    state.crouched = input.crouch;
    state.sprinting = input.sprint && input.forward > 0 && !input.crouch;
    const targetEye = state.crouched ? EYE_CROUCH : EYE_STAND;
    state.eye += (targetEye - state.eye) * Math.min(1, dt * 12);

    const sin = Math.sin(state.yaw);
    const cos = Math.cos(state.yaw);
    // Camera yaw 0 faces -z; forward is (-sin, -cos), right is (cos, -sin).
    let wishX = (-sin * input.forward + cos * input.strafe) * speed;
    let wishZ = (-cos * input.forward - sin * input.strafe) * speed;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > speed) {
      wishX = (wishX / wishLen) * speed;
      wishZ = (wishZ / wishLen) * speed;
    }
    state.moving = wishLen > 0.1;

    // Accelerate toward the wish velocity, friction when no input.
    const rate = wishLen > 0.1 ? ACCEL : FRICTION;
    state.velocity.x += clamp(wishX - state.velocity.x, -rate * dt, rate * dt);
    state.velocity.z += clamp(wishZ - state.velocity.z, -rate * dt, rate * dt);

    moveWithCollision(state.position, RADIUS, state.velocity.x * dt, state.velocity.z * dt);
    state.position.x = clamp(state.position.x, -31.5, 31.5);
    state.position.z = clamp(state.position.z, -21.5, 21.5);

    if (input.jump && state.onGround) {
      state.vy = JUMP_SPEED;
      state.onGround = false;
    }
    if (!state.onGround) {
      state.vy -= GRAVITY * dt;
      state.position.y += state.vy * dt;
      if (state.position.y <= 0) {
        state.position.y = 0;
        state.vy = 0;
        state.onGround = true;
      }
    }
  }

  function reset() {
    state.position.x = 0;
    state.position.y = 0;
    state.position.z = 18;
    state.velocity.x = 0;
    state.velocity.z = 0;
    state.vy = 0;
    state.yaw = 0;
    state.pitch = 0;
    state.eye = EYE_STAND;
    state.health = 100;
    state.armor = 0;
    state.alive = true;
    state.onGround = true;
  }

  // Damage with armor soaking half of it while armor lasts.
  function damage(amount) {
    if (!state.alive) return;
    let rest = amount;
    if (state.armor > 0) {
      const soaked = Math.min(state.armor, rest * 0.5);
      state.armor -= soaked;
      rest -= soaked;
    }
    state.health -= rest;
    if (state.health <= 0) {
      state.health = 0;
      state.alive = false;
    }
  }

  return { state, update, reset, damage };
}
