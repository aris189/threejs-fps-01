// Keyboard + mouse input behind pointer lock. The game reads a plain input
// snapshot each fixed step; the DOM never leaks into the simulation.
export function createInput(canvas, callbacks) {
  const keys = new Set();
  let locked = false;
  let mouseDX = 0;
  let mouseDY = 0;
  let mouseDown = false;
  let firePresses = 0; // queued rising edges, so quick clicks are never lost between steps

  function onKeyDown(e) {
    if (e.code === 'Tab') e.preventDefault();
    keys.add(e.code);
    if (callbacks.onKey) callbacks.onKey(e.code, true);
  }
  function onKeyUp(e) {
    keys.delete(e.code);
    if (callbacks.onKey) callbacks.onKey(e.code, false);
  }
  function onMouseMove(e) {
    if (!locked) return;
    mouseDX += e.movementX;
    mouseDY += e.movementY;
  }
  function onMouseDown(e) {
    if (e.button !== 0) return;
    if (!locked) {
      if (callbacks.onUnlockedClick) callbacks.onUnlockedClick();
      return;
    }
    mouseDown = true;
    firePresses = Math.min(3, firePresses + 1);
    if (callbacks.onFireDown) callbacks.onFireDown();
  }
  function onMouseUp(e) {
    if (e.button !== 0) return;
    mouseDown = false;
    if (callbacks.onFireUp) callbacks.onFireUp();
  }
  function onLockChange() {
    locked = document.pointerLockElement === canvas;
    if (callbacks.onLockChange) callbacks.onLockChange(locked);
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLockChange);

  function requestLock() {
    canvas.requestPointerLock();
  }
  function exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // Consume the accumulated mouse delta (called once per fixed step).
  function consumeMouse() {
    const dx = mouseDX;
    const dy = mouseDY;
    mouseDX = 0;
    mouseDY = 0;
    return { dx, dy };
  }

  function snapshot() {
    const forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    return {
      forward,
      strafe,
      sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
      crouch: keys.has('ControlLeft') || keys.has('KeyC'),
      jump: keys.has('Space'),
      firing: mouseDown,
      // The queued edges are NOT cleared here: the weapon clears one only
      // when it actually fires, so clicks during the cooldown queue up.
      // The clear function rides along so the weapon can consume the edge.
      firePressed: firePresses > 0,
      clearFirePressed,
    };
  }

  function clearFirePressed() {
    firePresses = Math.max(0, firePresses - 1);
  }

  function isDown(code) {
    return keys.has(code);
  }

  return { requestLock, exitLock, consumeMouse, snapshot, clearFirePressed, isDown, get locked() { return locked; } };
}
