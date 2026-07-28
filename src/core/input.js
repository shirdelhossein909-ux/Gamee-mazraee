/* =========================================================
   input.js — keyboard / mouse / pointer-lock manager.
   Uses event.code (physical keys) so it works on any
   keyboard layout, including Persian.
   ========================================================= */
(function (G) {
  'use strict';

  const I = {
    keys: Object.create(null),
    _pressed: Object.create(null),
    _released: Object.create(null),
    mx: 0, my: 0,          // pointer position in px (when unlocked)
    dx: 0, dy: 0,          // pointer delta this frame
    wheel: 0,
    buttons: [false, false, false],
    _clicked: [false, false, false],
    locked: false,
    enabled: true,         // false while a UI panel owns the cursor
    sensitivity: 1.2,
    canvas: null,

    init: function (canvas) {
      this.canvas = canvas;
      const self = this;

      addEventListener('keydown', function (e) {
        if (e.repeat) return;
        // let the browser handle typing inside inputs
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        self.keys[e.code] = true;
        self._pressed[e.code] = true;
        if (['Space', 'Tab', 'F1', 'F2', 'F3', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) e.preventDefault();
      });
      addEventListener('keyup', function (e) {
        self.keys[e.code] = false;
        self._released[e.code] = true;
      });
      addEventListener('blur', function () {
        for (const k in self.keys) self.keys[k] = false;
        self.buttons[0] = self.buttons[1] = self.buttons[2] = false;
      });

      canvas.addEventListener('mousedown', function (e) {
        if (!self.enabled) return;
        self.buttons[e.button] = true;
        self._clicked[e.button] = true;
        if (!self.locked && e.button === 0) self.lock();
        e.preventDefault();
      });
      addEventListener('mouseup', function (e) { self.buttons[e.button] = false; });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());

      addEventListener('mousemove', function (e) {
        if (self.locked) {
          self.dx += e.movementX || 0;
          self.dy += e.movementY || 0;
        } else {
          const r = canvas.getBoundingClientRect();
          self.mx = e.clientX - r.left;
          self.my = e.clientY - r.top;
          // right-drag orbits the camera when the pointer is not locked
          if (self.buttons[2]) { self.dx += e.movementX || 0; self.dy += e.movementY || 0; }
        }
      });

      canvas.addEventListener('wheel', function (e) {
        if (!self.enabled) return;
        self.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      }, { passive: false });

      document.addEventListener('pointerlockchange', function () {
        self.locked = document.pointerLockElement === canvas;
        if (!self.locked) G.Bus && G.Bus.emit('pointerunlock');
      });

      // touch: simple virtual look-drag so the demo is testable on tablets
      let tid = null, tx = 0, ty = 0;
      canvas.addEventListener('touchstart', function (e) {
        const t = e.changedTouches[0]; tid = t.identifier; tx = t.clientX; ty = t.clientY;
      }, { passive: true });
      canvas.addEventListener('touchmove', function (e) {
        for (const t of e.changedTouches) {
          if (t.identifier !== tid) continue;
          self.dx += (t.clientX - tx) * 1.4; self.dy += (t.clientY - ty) * 1.4;
          tx = t.clientX; ty = t.clientY;
        }
      }, { passive: true });
      canvas.addEventListener('touchend', function () { tid = null; }, { passive: true });
    },

    lock: function () {
      if (this.canvas && this.canvas.requestPointerLock && !this.locked) {
        const p = this.canvas.requestPointerLock();
        if (p && p.catch) p.catch(function () { /* user gesture / browser refusal — ignore */ });
      }
    },
    unlock: function () { if (document.exitPointerLock) document.exitPointerLock(); },

    down: function (code) { return this.enabled && !!this.keys[code]; },
    /** true only on the frame the key went down (works even while UI is open) */
    pressed: function (code) { return !!this._pressed[code]; },
    /** true only on the frame the key went down, and only in gameplay */
    gpressed: function (code) { return this.enabled && !!this._pressed[code]; },
    clicked: function (b) { return this.enabled && !!this._clicked[b || 0]; },
    held: function (b) { return this.enabled && !!this.buttons[b || 0]; },

    /** movement axes from WASD + arrows, in local screen space */
    axis: function () {
      let x = 0, y = 0;
      if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
      if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
      if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
      if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      return { x: x, y: y };
    },

    endFrame: function () {
      this.dx = 0; this.dy = 0; this.wheel = 0;
      this._pressed = Object.create(null);
      this._released = Object.create(null);
      this._clicked[0] = this._clicked[1] = this._clicked[2] = false;
    }
  };

  G.Input = I;
})(window.GAME = window.GAME || {});
