/*
 * Illustrated scene engine for The Last Question.
 *
 * The story text is split into "beats": short passages anchored to an exact phrase.
 * Every beat names a SET (a reusable illustrated environment) and the parameters that
 * shape it, so what is drawn tracks what the narrator is reading. Sets crossfade when
 * a beat switches environments; numeric parameters ease between beats of the same set.
 */
(function () {
  "use strict";

  const TAU = Math.PI * 2;
  const noise = (n) => ((Math.sin(n * 91.345) * 47453.5453) % 1 + 1) % 1;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (v) => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };
  const ease = (v) => 1 - Math.pow(1 - clamp(v, 0, 1), 3);
  const mix = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a, 0, 1)})`;

  /* Palette: saturated flat colour over a deep night base. */
  const P = {
    black: [4, 5, 14], deep: [8, 10, 34], navy: [14, 20, 60], indigo: [36, 32, 112], violet: [82, 52, 170],
    purple: [124, 70, 214], magenta: [226, 72, 160], pink: [255, 128, 176], rose: [255, 94, 118], red: [232, 66, 72],
    orange: [255, 138, 58], amber: [255, 186, 70], yellow: [255, 226, 112], cream: [255, 244, 220], white: [255, 255, 255],
    teal: [42, 208, 196], cyan: [96, 222, 255], sky: [124, 178, 255], blue: [58, 112, 255], green: [72, 198, 122],
    lime: [164, 228, 96], grey: [126, 136, 168], slate: [60, 68, 100], dark: [22, 26, 52], rock: [46, 38, 62], rock2: [30, 24, 44],
    steel: [96, 110, 150], steel2: [66, 76, 112], skin: [255, 214, 190], skin2: [214, 160, 128], skin3: [150, 104, 78]
  };
  const FONT = "\"IBM Plex Mono\", monospace";

  let g = null, main = null, offCanvas = null, offCtx = null;
  let W = 0, H = 0, T = 0, PX = .5, PY = .5, POS = 0;
  /* The transcript strip and transport cover the bottom of the canvas; scenes stand on this line. */
  const STAGE = .7;

  /* ------------------------------------------------------------------ primitives */
  function fillCircle(x, y, r, color, alpha = 1) {
    if (r <= 0) return;
    g.fillStyle = rgba(color, alpha);
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  function strokeCircle(x, y, r, color, alpha = 1, width = 1) {
    if (r <= 0) return;
    g.strokeStyle = rgba(color, alpha); g.lineWidth = width; g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
  }
  function rect(x, y, w, h, color, alpha = 1) { g.fillStyle = rgba(color, alpha); g.fillRect(x, y, w, h); }
  function roundRect(x, y, w, h, r, color, alpha = 1) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.fillStyle = rgba(color, alpha);
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();
  }
  function seg(x1, y1, x2, y2, color, width = 2, alpha = 1) {
    g.strokeStyle = rgba(color, alpha); g.lineWidth = width; g.lineCap = "round"; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  }
  function sky(top, bottom, midColor = null, midStop = .5) {
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, rgba(top)); if (midColor) grad.addColorStop(midStop, rgba(midColor)); grad.addColorStop(1, rgba(bottom));
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
  }
  function glow(x, y, r, color, alpha = .5, inner = 0) {
    if (r <= 0 || alpha <= 0) return;
    const grad = g.createRadialGradient(x, y, r * inner, x, y, r);
    grad.addColorStop(0, rgba(color, alpha)); grad.addColorStop(.5, rgba(color, alpha * .35)); grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function lighter(fn) { g.save(); g.globalCompositeOperation = "lighter"; fn(); g.restore(); }
  function text(str, x, y, size, color, { align = "center", weight = 500, spacing = 0, alpha = 1 } = {}) {
    g.fillStyle = rgba(color, alpha); g.font = `${weight} ${size}px ${FONT}`; g.textAlign = align; g.textBaseline = "middle";
    if (spacing && "letterSpacing" in g) g.letterSpacing = `${spacing}px`;
    g.fillText(str, x, y);
    if (spacing && "letterSpacing" in g) g.letterSpacing = "0px";
  }
  function vignette(strength = .35, color = P.black) {
    const grad = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.max(W, H) * .78);
    grad.addColorStop(0, rgba(color, 0)); grad.addColorStop(1, rgba(color, strength));
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
  }

  /* Star field: deterministic positions, ordered so a "dead" fraction extinguishes the same stars every time. */
  const STARS = Array.from({ length: 520 }, (_, i) => ({
    x: noise(i * 2.71 + 1), y: noise(i * 7.31 + 2), z: noise(i * 11.7 + 3), d: noise(i * 5.9 + 4), tw: noise(i * 3.3) * TAU,
    s: i % 29 === 0 ? 2.6 : i % 7 === 0 ? 1.7 : 1.1, c: i % 11 === 0 ? P.cyan : i % 13 === 0 ? P.amber : i % 17 === 0 ? P.pink : P.white
  }));
  function stars({ alpha = 1, density = 1, dead = 0, parallax = 1, twinkle = 1, streak = 0, scroll = 0, yMax = 1, big = 1 } = {}) {
    if (alpha <= 0) return;
    for (let i = 0; i < STARS.length; i++) {
      const s = STARS[i];
      if (s.d > density) continue;
      const dying = s.d < dead ? clamp((dead - s.d) * 14, 0, 1) : 0;
      if (dying >= 1) continue;
      const x = ((s.x * W - scroll * (.2 + s.z) + (PX - .5) * parallax * (8 + s.z * 26)) % (W + 40) + W + 40) % (W + 40) - 20;
      const y = s.y * H * yMax + (PY - .5) * parallax * (4 + s.z * 10);
      const a = alpha * (.45 + .55 * (Math.sin(T * (1.3 + s.z * 2) * twinkle + s.tw) * .5 + .5)) * (1 - dying);
      fillCircle(x, y, s.s * big * (1 - dying * .6), s.c, a);
      if (s.s > 2 && big >= 1) glow(x, y, s.s * 5, s.c, a * .35);
      if (streak) seg(x, y, x - streak * (1 + s.z * 4), y, s.c, s.s * .8, a * .5);
    }
  }
  function nebula(x, y, r, color, alpha) { lighter(() => glow(x, y, r, color, alpha)); }

  /* Spiral galaxy point cloud in unit space, drawn through a transform. */
  const GALAXY = Array.from({ length: 460 }, (_, i) => {
    const arm = i % 2, tt = noise(i * 1.7) * 3.2, r = .09 + tt * .27 + noise(i * 4.1) * .05;
    const a = tt * 2.4 + arm * Math.PI + (noise(i * 9.3) - .5) * .5;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, s: .6 + noise(i * 2.2) * 1.4, b: noise(i * 6.6) };
  });
  function galaxy(x, y, r, angle, { tint = P.sky, core = P.cream, alpha = 1, tilt = .45, spin = 0, arms = true } = {}) {
    if (r < 2 || alpha <= 0) return;
    g.save(); g.translate(x, y); g.rotate(angle); g.scale(1, tilt); g.rotate(spin);
    lighter(() => { glow(0, 0, r * 1.1, tint, alpha * .35); glow(0, 0, r * .4, core, alpha * .7); });
    if (arms && r > 12) {
      const step = r < 40 ? 3 : 1;
      for (let i = 0; i < GALAXY.length; i += step) {
        const p = GALAXY[i]; if (p.b > r / 60) continue;
        fillCircle(p.x * r * 2.4, p.y * r * 2.4, clamp(p.s * r * .007, 1, 2.4), i % 5 ? core : tint, alpha * (.55 + p.b * .45));
      }
    }
    lighter(() => glow(0, 0, r * .3, P.white, alpha * .8));
    fillCircle(0, 0, r * .06, P.white, alpha * .9);
    g.restore();
  }

  function planet(x, y, r, { color = P.blue, shade = P.deep, light = [-.6, -.5], bands = 0, rings = 0, ringColor = P.cream, spots = 0, atmo = null, craters = 0, alpha = 1 } = {}) {
    if (r <= 0 || alpha <= 0) return;
    g.save(); g.globalAlpha *= alpha;
    if (atmo) lighter(() => glow(x, y, r * 1.35, atmo, .55, .68));
    if (rings) { g.save(); g.translate(x, y); g.rotate(-.35); g.strokeStyle = rgba(ringColor, .8); g.lineWidth = r * .16 * rings; g.beginPath(); g.ellipse(0, 0, r * 1.75, r * .48, 0, Math.PI, TAU); g.stroke(); g.restore(); }
    g.save(); g.beginPath(); g.arc(x, y, r, 0, TAU); g.clip();
    fillCircle(x, y, r, color);
    for (let i = 0; i < bands; i++) { const yy = y - r * .7 + i * (r * 1.4 / bands); rect(x - r, yy, r * 2, r * .18, mix(color, P.white, .12), i % 2 ? .35 : .18); }
    for (let i = 0; i < spots; i++) fillCircle(x + (noise(i * 3.1 + r) - .5) * r * 1.7, y + (noise(i * 5.7 + r) - .5) * r * 1.7, r * (.06 + noise(i * 2.3) * .16), mix(color, P.white, .16), .5);
    for (let i = 0; i < craters; i++) { const cx = x + (noise(i * 4.4 + 9) - .5) * r * 1.6, cy = y + (noise(i * 8.1 + 9) - .5) * r * 1.6, cr = r * (.05 + noise(i * 1.9) * .1); fillCircle(cx, cy, cr, mix(color, P.black, .35), .6); fillCircle(cx - cr * .25, cy - cr * .25, cr * .7, mix(color, P.white, .08), .5); }
    const grad = g.createRadialGradient(x + light[0] * r * .6, y + light[1] * r * .6, r * .1, x + light[0] * r * .2, y + light[1] * r * .2, r * 1.65);
    grad.addColorStop(0, rgba(P.white, .18)); grad.addColorStop(.42, rgba(shade, 0)); grad.addColorStop(1, rgba(shade, .92));
    g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2);
    g.restore();
    if (rings) { g.save(); g.translate(x, y); g.rotate(-.35); g.strokeStyle = rgba(ringColor, .9); g.lineWidth = r * .16 * rings; g.beginPath(); g.ellipse(0, 0, r * 1.75, r * .48, 0, 0, Math.PI); g.stroke(); g.restore(); }
    g.restore();
  }

  /* Earth with drifting continents; `molten` melts it into a drop of liquid iron. */
  const CONTINENTS = [];
  for (let k = 0; k < 11; k++) {
    const a0 = noise(k * 3.7 + 2) * TAU, y0 = (noise(k * 5.1 + 2) - .5) * 1.7, n = 4 + Math.floor(noise(k * 9.1) * 5);
    for (let j = 0; j < n; j++) CONTINENTS.push({ a: a0 + (noise(k * 13 + j * 2.3) - .5) * .5, y: y0 + (noise(k * 17 + j * 4.1) - .5) * .32, r: .035 + noise(k * 7.7 + j * 1.9) * .06 });
  }
  function earth(x, y, r, rot = 0, { night = 0, molten = 0, alpha = 1, lights = 0 } = {}) {
    if (r <= 0) return;
    const ocean = mix(P.blue, P.orange, molten), land = mix(P.green, P.red, molten);
    planet(x, y, r, { color: ocean, shade: mix(P.deep, P.red, molten * .4), atmo: mix(P.cyan, P.amber, molten), alpha });
    g.save(); g.globalAlpha *= alpha; g.beginPath(); g.arc(x, y, r, 0, TAU); g.clip();
    for (const c of CONTINENTS) {
      const a = c.a + rot; const lat = clamp(c.y, -.92, .92), ring = Math.sqrt(1 - lat * lat);
      const depth = Math.sin(a); if (depth < -.1) continue;
      const sx = x + Math.cos(a) * ring * r * .97, sy = y + lat * r * .97;
      const squash = .35 + depth * .65;
      g.save(); g.translate(sx, sy); g.scale(squash, 1); fillCircle(0, 0, c.r * r, land, .92); g.restore();
      if (lights && depth > .2) fillCircle(sx + c.r * r * .3 * squash, sy - c.r * r * .2, Math.max(1.2, c.r * r * .1), P.yellow, lights * .85);
    }
    if (night) { const grad = g.createLinearGradient(x + r * .5, y - r * .7, x - r * .8, y + r * .6); grad.addColorStop(0, rgba(P.deep, 0)); grad.addColorStop(.5, rgba(P.deep, night * .2)); grad.addColorStop(1, rgba(P.deep, night * .92)); g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2); }
    if (molten > .05) {
      for (let i = 0; i < 40; i++) { const a = noise(i * 2.9) * TAU, d = noise(i * 4.3); fillCircle(x + Math.cos(a) * d * r, y + Math.sin(a) * d * r, r * (.02 + noise(i) * .07), P.yellow, molten * .7 * (.4 + .6 * Math.sin(T * 3 + i))); }
    }
    g.restore();
    if (molten > .3) {
      const k = smooth((molten - .3) / .7);
      lighter(() => glow(x, y, r * 1.8, P.orange, k * .5));
      for (let i = 0; i < 5; i++) { const dx = (i - 2) * r * .28, len = r * (.2 + noise(i * 7.1) * .6) * k * (1 + Math.sin(T + i) * .1); roundRect(x + dx - r * .05, y + r * .85, r * .1, len, r * .05, P.orange, k); fillCircle(x + dx, y + r * .85 + len, r * .07, P.yellow, k); }
    }
  }

  function sun(x, y, r, { core = P.yellow, corona = P.orange, rays = 12, alpha = 1, spin = 0 } = {}) {
    if (r <= 0 || alpha <= 0) return;
    lighter(() => { glow(x, y, r * 3.2, corona, alpha * .35); glow(x, y, r * 1.8, core, alpha * .45); });
    if (rays) { g.save(); g.translate(x, y); g.rotate(T * .05 + spin); g.fillStyle = rgba(core, alpha * .22); for (let i = 0; i < rays; i++) { g.rotate(TAU / rays); g.beginPath(); g.moveTo(r * 1.1, -r * .12); g.lineTo(r * (1.7 + (i % 2) * .35), 0); g.lineTo(r * 1.1, r * .12); g.fill(); } g.restore(); }
    fillCircle(x, y, r, corona, alpha); fillCircle(x, y, r * .86, core, alpha); fillCircle(x - r * .25, y - r * .25, r * .4, mix(core, P.white, .4), alpha * .6);
  }

  function hills(baseY, amp, freq, color, seed, scroll = 0, alpha = 1) {
    g.fillStyle = rgba(color, alpha); g.beginPath(); g.moveTo(0, H + 2);
    for (let x = 0; x <= W + 24; x += 12) { const wx = x + scroll; g.lineTo(x, baseY - Math.sin(wx * freq + seed) * amp - Math.sin(wx * freq * 2.7 + seed * 3) * amp * .35 - noise(Math.floor(wx / 60) + seed) * amp * .25); }
    g.lineTo(W + 24, H + 2); g.closePath(); g.fill();
  }
  function cloud(x, y, s, color = P.white, alpha = .9) {
    const blobs = [[0, 0, 22], [-20, 6, 15], [22, 5, 16], [-6, -9, 15], [12, -7, 13]];
    for (const b of blobs) fillCircle(x + b[0] * s, y + b[1] * s, b[2] * s, color, alpha);
    roundRect(x - 34 * s, y + 3 * s, 68 * s, 16 * s, 8 * s, color, alpha);
  }
  function tree(x, y, s, { leaf = P.green, trunk = P.rock, burn = 0, alpha = 1 } = {}) {
    const canopy = mix(mix(leaf, P.orange, clamp(burn * 2, 0, 1)), P.slate, clamp(burn * 2 - 1, 0, 1));
    roundRect(x - 3 * s, y - 24 * s, 6 * s, 26 * s, 3 * s, mix(trunk, P.black, burn * .6), alpha);
    if (burn < .95) { const k = 1 - clamp(burn * 1.15 - .1, 0, 1) * .8; fillCircle(x, y - 34 * s, 16 * s * k, canopy, alpha); fillCircle(x - 12 * s, y - 26 * s, 12 * s * k, canopy, alpha); fillCircle(x + 12 * s, y - 27 * s, 12 * s * k, canopy, alpha); fillCircle(x - 4 * s, y - 44 * s, 10 * s * k, mix(canopy, P.white, .1), alpha); }
  }

  /* Round little birds: an egg of colour with a beak, two dot eyes and stick legs. The feet stand on y. */
  function bird(x, y, s, { color = P.sky, skin = null, pose = "stand", eyes = 1, closed = 0, look = 0, hair = null, slim = 0, phase = 0, alpha = 1 } = {}) {
    g.save(); g.globalAlpha *= alpha;
    const rx = (9 - slim * 1.5) * s, ry = (11 + slim * 4) * s, legH = pose === "sit" ? 0 : 5 * s;
    const belly = skin || mix(color, P.cream, .45), dark = mix(color, P.black, .45), beak = P.amber;
    const bob = pose === "run" ? Math.abs(Math.sin(phase * 12)) * 2 * s : 0;
    const dir = look >= 0 ? 1 : -1;
    if (pose === "lie") {
      /* Asleep in a pod: the egg lies on its side, eyes shut. */
      g.save(); g.translate(x, y - ry * .75); g.rotate(-Math.PI / 2 * dir);
      g.fillStyle = rgba(color); g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.fill();
      g.fillStyle = rgba(belly); g.beginPath(); g.ellipse(rx * .1, ry * .25, rx * .55, ry * .5, 0, 0, TAU); g.fill();
      seg(-rx * .45, -ry * .35, -rx * .15, -ry * .35, dark, s * .9); seg(rx * .15, -ry * .35, rx * .45, -ry * .35, dark, s * .9);
      g.fillStyle = rgba(beak); g.beginPath(); g.moveTo(-rx * .2, -ry * .15); g.lineTo(rx * .2, -ry * .15); g.lineTo(0, -ry * .1 + 3.5 * s); g.fill();
      g.restore(); g.restore(); return;
    }
    const cy = y - legH - ry - bob;
    /* Legs */
    if (legH) {
      const spread = pose === "run" ? Math.sin(phase * 12) * 5 * s : 0;
      seg(x - 3 * s, cy + ry * .8, x - 3 * s - spread, y, beak, 1.6 * s); seg(x + 3 * s, cy + ry * .8, x + 3 * s + spread, y, beak, 1.6 * s);
      seg(x - 3 * s - spread, y, x - 5.5 * s - spread, y, beak, 1.6 * s); seg(x + 3 * s + spread, y, x + 5.5 * s + spread, y, beak, 1.6 * s);
    }
    /* Body and belly */
    g.fillStyle = rgba(color); g.beginPath(); g.ellipse(x, cy, rx, ry, 0, 0, TAU); g.fill();
    g.fillStyle = rgba(belly); g.beginPath(); g.ellipse(x + dir * rx * .12, cy + ry * .3, rx * .58, ry * .52, 0, 0, TAU); g.fill();
    /* Wing (raised when pointing) */
    g.save(); g.translate(x - dir * rx * .55, cy + ry * .05);
    g.rotate(pose === "point" ? -dir * 1.9 : pose === "run" ? Math.sin(phase * 12) * .5 : -dir * .35);
    g.fillStyle = rgba(dark, .9); g.beginPath(); g.ellipse(0, ry * .25, rx * .38, ry * .48, 0, 0, TAU); g.fill(); g.restore();
    /* Crest */
    const crest = hair || dark;
    for (let i = -1; i <= 1; i++) { seg(x + i * 2 * s, cy - ry + s, x + i * 3.2 * s, cy - ry - (5 - Math.abs(i) * 1.5) * s, crest, 1.6 * s); }
    /* Eyes */
    const ey = cy - ry * .32, ex = x + dir * rx * .12;
    if (eyes) {
      if (closed) { seg(ex - rx * .5, ey, ex - rx * .15, ey, dark, s * 1.1); seg(ex + rx * .15, ey, ex + rx * .5, ey, dark, s * 1.1); }
      else {
        fillCircle(ex - rx * .32, ey, 2.4 * s, P.white); fillCircle(ex + rx * .32, ey, 2.4 * s, P.white);
        fillCircle(ex - rx * .32 + dir * .9 * s, ey + .3 * s, 1.2 * s, P.dark); fillCircle(ex + rx * .32 + dir * .9 * s, ey + .3 * s, 1.2 * s, P.dark);
      }
    }
    /* Beak */
    const bx = x + dir * rx * .55, by = cy - ry * .05;
    g.fillStyle = rgba(beak); g.beginPath(); g.moveTo(bx - dir * 2 * s, by - 2.6 * s); g.lineTo(bx + dir * 6 * s, by); g.lineTo(bx - dir * 2 * s, by + 2.6 * s); g.fill();
    g.restore();
  }
  const person = bird;
  function robot(x, y, s, { color = P.steel, eye = P.cyan, power = 1, alpha = 1 } = {}) {
    g.save(); g.globalAlpha *= alpha;
    roundRect(x - 7 * s, y - 16 * s, 14 * s, 14 * s, 3 * s, color); roundRect(x - 5 * s, y - 24 * s, 10 * s, 8 * s, 2 * s, mix(color, P.white, .1));
    seg(x, y - 24 * s, x, y - 29 * s, color, 1.5 * s); fillCircle(x, y - 30 * s, 1.6 * s, eye, .4 + power * .6);
    fillCircle(x - 2 * s, y - 20 * s, 1.5 * s, eye, .3 + power * .7); fillCircle(x + 2 * s, y - 20 * s, 1.5 * s, eye, .3 + power * .7);
    seg(x - 4 * s, y - 2 * s, x - 4 * s, y + 2 * s, color, 3 * s); seg(x + 4 * s, y - 2 * s, x + 4 * s, y + 2 * s, color, 3 * s);
    seg(x - 8 * s, y - 12 * s, x - 11 * s, y - 6 * s, color, 2.5 * s); seg(x + 8 * s, y - 12 * s, x + 11 * s, y - 6 * s, color, 2.5 * s);
    g.restore();
  }
  function pod(x, y, s, { color = P.steel2, glass = P.cyan, alpha = 1, light = 1 } = {}) {
    g.save(); g.globalAlpha *= alpha;
    roundRect(x - 22 * s, y - 12 * s, 44 * s, 14 * s, 5 * s, color);
    roundRect(x - 20 * s, y - 20 * s, 40 * s, 10 * s, 5 * s, glass, .28);
    bird(x, y - 12 * s, s * .62, { pose: "lie", color: P.cream, hair: P.grey });
    fillCircle(x + 17 * s, y - 6 * s, 1.5 * s, P.green, .4 + light * .6 * (.6 + .4 * Math.sin(T * 2 + x)));
    g.restore();
  }
  function cube(x, y, s, glowAmt = 0, color = P.cyan) {
    if (glowAmt) lighter(() => glow(x, y - s, s * 4, color, glowAmt * .6));
    g.fillStyle = rgba(P.steel); g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s, y - s * .5); g.lineTo(x, y); g.lineTo(x - s, y - s * .5); g.fill();
    g.fillStyle = rgba(P.steel2); g.beginPath(); g.moveTo(x - s, y - s * .5); g.lineTo(x, y); g.lineTo(x, y + s); g.lineTo(x - s, y + s * .5); g.fill();
    g.fillStyle = rgba(P.slate); g.beginPath(); g.moveTo(x + s, y - s * .5); g.lineTo(x, y); g.lineTo(x, y + s); g.lineTo(x + s, y + s * .5); g.fill();
    fillCircle(x, y - s * .5, s * .18, color, .5 + glowAmt * .5);
  }
  /* Wall of Multivac panels: tape reels, gauges and blinking lights. */
  function machineWall(x, y, w, h, seed, activity, { cols = 8, rows = 4, color = P.steel2, alpha = 1 } = {}) {
    g.save(); g.globalAlpha *= alpha;
    rect(x, y, w, h, color);
    const cw = w / cols, ch = h / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const px = x + c * cw + 3, py = y + r * ch + 3, pw = cw - 6, ph = ch - 6, kind = Math.floor(noise(seed + c * 3.1 + r * 7.3) * 3);
      roundRect(px, py, pw, ph, 3, mix(color, P.black, .25));
      if (kind === 0) { for (let i = 0; i < 2; i++) { const rx = px + pw * (.3 + i * .4), ry = py + ph * .45, rr = Math.min(pw, ph) * .22; fillCircle(rx, ry, rr, P.dark); strokeCircle(rx, ry, rr * .6, P.grey, .7, 1.5); const a = T * (activity ? 1.5 : 0) * (i ? -1 : 1) + seed + c; seg(rx, ry, rx + Math.cos(a) * rr * .9, ry + Math.sin(a) * rr * .9, P.grey, 1.5, .8); } }
      else if (kind === 1) { const n = 4; for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) { const on = noise(Math.floor(T * (2 + activity * 6) + i * 1.7 + j * 3.3 + seed + c * 5 + r * 9)) < activity * .7; const col = (i + j + c) % 3 === 0 ? P.red : (i + c) % 2 ? P.amber : P.green; fillCircle(px + pw * (.15 + i * .23), py + ph * (.35 + j * .3), Math.max(1.5, Math.min(pw, ph) * .07), col, on ? 1 : .18); } }
      else { rect(px + pw * .12, py + ph * .3, pw * .76, ph * .12, P.dark); const level = .2 + noise(Math.floor(T * 2 + c + r * 4 + seed)) * .6 * activity; rect(px + pw * .12, py + ph * .3, pw * .76 * level, ph * .12, P.cyan, .8); rect(px + pw * .12, py + ph * .58, pw * .76, ph * .12, P.dark); rect(px + pw * .12, py + ph * .58, pw * .76 * (1 - level * .7), ph * .12, P.orange, .7); }
    }
    g.restore();
  }
  function caption(str, x, y, size, color, progress = 1, { glowColor = null, weight = 500 } = {}) {
    const shown = str.slice(0, Math.ceil(str.length * clamp(progress, 0, 1)));
    if (!shown) return;
    if (glowColor) { g.save(); g.shadowColor = rgba(glowColor, .9); g.shadowBlur = size * .9; text(shown, x, y, size, color, { spacing: size * .12, weight }); g.restore(); }
    else text(shown, x, y, size, color, { spacing: size * .12, weight });
    if (progress < 1 && Math.sin(T * 8) > 0) { g.font = `${weight} ${size}px ${FONT}`; const wdt = g.measureText(shown).width; rect(x + wdt / 2 + size * .2, y - size * .5, size * .5, size, color); }
  }
  function beam(x1, y1, x2, y2, color, width, alpha) {
    lighter(() => { seg(x1, y1, x2, y2, color, width * 3, alpha * .18); seg(x1, y1, x2, y2, color, width, alpha * .5); seg(x1, y1, x2, y2, P.white, width * .3, alpha * .7); });
  }
  function rocket(x, y, s, angle, color = P.cream, flame = 1) {
    g.save(); g.translate(x, y); g.rotate(angle);
    if (flame) { fillCircle(0, 12 * s, 4 * s * flame, P.orange, .8); fillCircle(0, 15 * s, 2.5 * s * flame, P.yellow, .9); }
    roundRect(-4 * s, -14 * s, 8 * s, 24 * s, 4 * s, color); g.fillStyle = rgba(P.red); g.beginPath(); g.moveTo(-4 * s, -8 * s); g.lineTo(0, -18 * s); g.lineTo(4 * s, -8 * s); g.fill();
    g.beginPath(); g.moveTo(-4 * s, 4 * s); g.lineTo(-8 * s, 12 * s); g.lineTo(-4 * s, 10 * s); g.fill(); g.beginPath(); g.moveTo(4 * s, 4 * s); g.lineTo(8 * s, 12 * s); g.lineTo(4 * s, 10 * s); g.fill();
    fillCircle(0, -2 * s, 2.2 * s, P.cyan);
    g.restore();
  }
  function ship(x, y, s, color = P.cream, dir = 1, trail = 1) {
    g.save(); g.translate(x, y); g.scale(dir, 1);
    if (trail) lighter(() => { seg(-10 * s, 0, -10 * s - 40 * s * trail, 0, P.cyan, 3 * s, .35); });
    roundRect(-12 * s, -3 * s, 24 * s, 6 * s, 3 * s, color); roundRect(-4 * s, -6 * s, 10 * s, 5 * s, 2.5 * s, mix(color, P.cyan, .5));
    g.restore();
  }
  function wisp(x, y, s, color, phaseOffset = 0, alpha = 1) {
    lighter(() => {
      glow(x, y, 26 * s, color, alpha * .55); glow(x, y, 9 * s, P.white, alpha * .6);
      g.strokeStyle = rgba(color, alpha * .55); g.lineWidth = 2 * s; g.lineCap = "round";
      for (let i = 0; i < 5; i++) {
        const a = phaseOffset + i * 1.26 + T * .4, len = (30 + i * 9) * s;
        g.beginPath(); g.moveTo(x, y);
        g.bezierCurveTo(x + Math.cos(a) * len * .4, y + Math.sin(a) * len * .4, x + Math.cos(a + Math.sin(T + i) * .8) * len * .8, y + Math.sin(a + Math.cos(T * 1.3 + i) * .8) * len * .8, x + Math.cos(a + 1) * len, y + Math.sin(a + 1) * len);
        g.stroke();
      }
    });
    fillCircle(x, y, 3.5 * s, P.white, alpha);
  }

  /* ------------------------------------------------------------------ sets
   * Each set is an environment drawn from smoothed parameters `p` and the beat
   * timing `b` ({ phase: 0..1 through the beat, age: seconds since it began }).
   */
  const SETS = {};
  const DEFAULTS = {};
  function defineSet(name, defaults, draw) { DEFAULTS[name] = defaults; SETS[name] = draw; }

  function spaceBackdrop({ top = P.deep, bottom = P.navy, nebulae = 1, starAlpha = 1, dead = 0, density = 1, streak = 0, scroll = 0 } = {}) {
    sky(top, bottom);
    if (nebulae) { nebula(W * .18, H * .3, W * .32, P.violet, .28 * nebulae); nebula(W * .8, H * .68, W * .3, P.magenta, .16 * nebulae); nebula(W * .62, H * .18, W * .22, P.teal, .14 * nebulae); }
    stars({ alpha: starAlpha, dead, density, streak, scroll });
  }

  /* Earth seen from orbit. The sun rises over the limb; stations, rockets and distant planets come and go. */
  defineSet("earthDawn", { sunrise: .5, station: 0, rockets: 0, planets: 0, molten: 0, pluto: 0, smog: 0, lights: .3, zoom: 1 }, (p, b) => {
    spaceBackdrop({ nebulae: .6, starAlpha: .9 });
    const r = Math.min(W, H) * .5 * p.zoom, cx = W * .56, cy = H * .7 + r * .25;
    const sunX = cx + r * .55, sunY = cy - r * .92 - (p.sunrise - .5) * r * .5;
    sun(sunX, sunY, Math.min(W, H) * .07, { rays: 14, alpha: smooth(p.sunrise * 1.4) });
    if (p.planets > 0) {
      const a = p.planets;
      planet(W * .14, H * .22, 16, { color: P.grey, shade: P.dark, craters: 6, alpha: a }); text("MOON", W * .14, H * .22 + 30, 10, P.cream, { spacing: 2, alpha: a * .8 });
      planet(W * .3, H * .13, 13, { color: P.red, shade: P.dark, spots: 3, alpha: a }); text("MARS", W * .3, H * .13 + 27, 10, P.cream, { spacing: 2, alpha: a * .8 });
      planet(W * .5, H * .2, 19, { color: P.amber, shade: P.rock, bands: 3, alpha: a }); text("VENUS", W * .5, H * .2 + 33, 10, P.cream, { spacing: 2, alpha: a * .8 });
    }
    if (p.pluto > 0) {
      planet(W * .9, H * .16, 9, { color: P.sky, shade: P.dark, craters: 3, alpha: p.pluto }); text("PLUTO", W * .9, H * .16 + 22, 10, P.cream, { spacing: 2, alpha: p.pluto * .8 });
      for (let i = 0; i < 4; i++) { const k = ((T * .12 + i * .25) % 1), back = i % 2; const x = lerp(W * .5, W * .9, back ? 1 - k : k), y = lerp(H * .5, H * .17, back ? 1 - k : k) - Math.sin(k * Math.PI) * 30; ship(x, y, 1.1, P.cream, back ? -1 : 1, 1); if (p.station) beam(W * .5 + 80, H * .32, x, y, P.amber, 1, .5 * p.pluto); }
    }
    earth(cx, cy, r, T * .03 + POS * .0004, { molten: p.molten, lights: p.lights, night: .7 });
    if (p.smog > 0) { for (let i = 0; i < 9; i++) { const a = -1.2 + i * .12, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; glow(x, y - 8, 26 + noise(i) * 20, P.slate, p.smog * .8); } }
    if (p.station > 0) {
      const a = -1.35 + Math.sin(T * .05) * .12, sx = cx + Math.cos(a) * r * 1.34, sy = cy + Math.sin(a) * r * 1.34;
      g.save(); g.globalAlpha *= p.station;
      beam(sx, sy, cx + Math.cos(a) * r, cy + Math.sin(a) * r, P.amber, 4, .9);
      for (let i = 0; i < 3; i++) beam(sx, sy, cx + Math.cos(a + (i - 1) * .35) * r * .98, cy + Math.sin(a + (i - 1) * .35) * r * .98, P.yellow, 1.5, .45);
      lighter(() => glow(sx, sy, 60, P.amber, .5));
      roundRect(sx - 34, sy - 5, 68, 10, 4, P.steel); rect(sx - 46, sy - 16, 24, 32, P.blue); rect(sx + 22, sy - 16, 24, 32, P.blue); rect(sx - 44, sy - 14, 20, 28, P.sky, .55); rect(sx + 24, sy - 14, 20, 28, P.sky, .55);
      fillCircle(sx, sy, 8, P.cream); fillCircle(sx, sy, 4, P.amber);
      g.restore();
    }
    if (p.rockets > 0) {
      for (let i = 0; i < 3; i++) { const k = ((T * .09 + i * .33) % 1); const a = -1.9 + i * .35; const x = cx + Math.cos(a) * r * (1 + k * 1.3), y = cy + Math.sin(a) * r * (1 + k * 1.3); rocket(x, y, 1.1 - k * .4, a + Math.PI / 2, P.cream, 1); lighter(() => glow(x, y, 20, P.orange, .3)); }
    }
    vignette(.3);
  });

  /* Ground-level Earth: coal stacks give way to a beamed-down solar age. */
  defineSet("solarLand", { smoke: 1, station: 0, beam: 0, lit: 0, day: .2 }, (p, b) => {
    const top = mix(P.deep, P.sky, p.day), bottom = mix(P.indigo, P.amber, p.day);
    sky(top, bottom, mix(P.navy, P.pink, p.day), .65);
    stars({ alpha: 1 - p.day, yMax: .7 });
    if (p.station > 0) { const sx = W * .62, sy = H * .2; lighter(() => glow(sx, sy, 90, P.amber, .5 * p.station)); roundRect(sx - 28, sy - 4, 56, 8, 4, P.steel, p.station); rect(sx - 40, sy - 14, 20, 28, P.blue, p.station); rect(sx + 20, sy - 14, 20, 28, P.blue, p.station); fillCircle(sx, sy, 7, P.cream, p.station); if (p.beam > 0) { beam(sx, sy, W * .58, H * .66, P.amber, 8, p.beam); beam(sx, sy, W * .3, H * .68, P.yellow, 2, p.beam * .5); beam(sx, sy, W * .84, H * .68, P.yellow, 2, p.beam * .5); } }
    cloud(W * .15 + Math.sin(T * .1) * 10, H * .3, 1.1, mix(P.indigo, P.white, p.day * .8), .8); cloud(W * .8, H * .22, .8, mix(P.indigo, P.white, p.day * .8), .7);
    hills(H * .54, 46, .004, mix(P.navy, P.violet, .4 + p.day * .3), 1); hills(H * .61, 32, .006, mix(P.navy, P.violet, .2 + p.day * .2), 7);
    const ground = H * STAGE; rect(0, ground, W, H - ground, mix(P.dark, P.indigo, p.day * .5));
    /* Town */
    for (let i = 0; i < 16; i++) { const x = W * .04 + i * W * .06, h = 44 + noise(i * 3.3) * 120, w = 30 + noise(i * 7.1) * 28; roundRect(x, ground - h, w, h, 3, mix(P.slate, P.dark, .3)); for (let wy = ground - h + 8; wy < ground - 6; wy += 12) for (let wx = x + 5; wx < x + w - 6; wx += 9) { const on = noise(i + wx + wy) < .45 + p.lit * .5; fillCircle(wx + 2, wy + 2, 2, on ? P.yellow : P.dark, .2 + p.lit * .8); } }
    /* Power plants with stacks */
    for (const sx of [W * .3, W * .84]) {
      roundRect(sx - 40, ground - 40, 80, 40, 4, P.slate); rect(sx - 26, ground - 110, 14, 70, P.steel2); rect(sx + 12, ground - 96, 14, 56, P.steel2);
      for (let i = 0; i < 8; i++) { const k = ((T * .16 + i * .125) % 1); glow(sx - 19 + Math.sin(k * 6 + i) * 12 + k * 40, ground - 112 - k * 150, 18 + k * 44, mix(P.grey, P.dark, .25), p.smoke * (1 - k) * .95); }
      fillCircle(sx - 19, ground - 112, 5, P.orange, p.smoke); fillCircle(sx + 19, ground - 98, 4, P.green, (1 - p.smoke) * .8);
    }
    /* Solar receiver dish */
    if (p.station > 0) { roundRect(W * .58 - 30, H * .66 - 6, 60, 12, 6, P.steel, p.station); strokeCircle(W * .58, H * .66 - 16, 22, P.cyan, p.station, 4); lighter(() => glow(W * .58, H * .66 - 10, 50, P.amber, p.beam * .5)); }
    person(W * .5, ground, 2, { color: P.rose, hair: P.rock, look: 1 }); person(W * .56, ground, 1.9, { color: P.teal, hair: P.grey, look: -1 });
    vignette(.32);
  });

  /* The colossal interior of Multivac. */
  defineSet("multivacHall", { activity: .8, dead: 0, teletype: 0, console: 0, question: 0, circuit: 0, figures: 1, warm: 0 }, (p, b) => {
    sky(P.deep, P.dark);
    const vx = W * .5, vy = H * .36, act = p.activity * (1 - p.dead), floorY = H * .56;
    /* Side walls recede toward the vanishing point: each column is a slice of wall scaled by depth. */
    for (const side of [-1, 1]) {
      const cols = 7;
      for (let c = cols - 1; c >= 0; c--) {
        const d0 = c / cols, d1 = (c + 1) / cols, s0 = 1 - d0 * .72, s1 = 1 - d1 * .72;
        const nearX = side < 0 ? 0 : W, x0 = lerp(nearX, vx, d0 * .62), x1 = lerp(nearX, vx, d1 * .62);
        const top0 = vy - (vy - H * .02) * s0, top1 = vy - (vy - H * .02) * s1, bot0 = vy + (floorY + H * .2 - vy) * s0, bot1 = vy + (floorY + H * .2 - vy) * s1;
        g.save(); g.beginPath(); g.moveTo(x0, top0); g.lineTo(x1, top1); g.lineTo(x1, bot1); g.lineTo(x0, bot0); g.closePath(); g.clip();
        const left = Math.min(x0, x1), top = Math.min(top0, top1);
        machineWall(left, top, Math.abs(x1 - x0) + 1, Math.max(bot0, bot1) - top, side * 9 + c * 4, act, { cols: 1, rows: 5, color: mix(P.steel2, P.black, .2 + d0 * .35) });
        g.restore();
      }
    }
    /* Back wall and floor */
    machineWall(W * .31, H * .24, W * .38, H * .32, 3, act, { cols: 8, rows: 4, color: mix(P.steel2, P.black, .3) });
    rect(0, floorY, W, H - floorY, P.dark);
    for (let i = 0; i <= 12; i++) seg(W * (i / 12), H, vx + (W * (i / 12) - vx) * .38, floorY, P.slate, 1, .35);
    for (let i = 1; i < 6; i++) { const y = floorY + (H - floorY) * Math.pow(i / 6, 1.8); seg(0, y, W, y, P.slate, 1, .25); }
    lighter(() => glow(vx, H * .42, W * .3, act > .1 ? P.cyan : P.slate, .22 * (act + .05)));
    if (p.circuit > 0) {
      g.save(); g.globalAlpha *= p.circuit;
      for (let i = 0; i < 60; i++) { const x1 = W * (.3 + noise(i * 1.3) * .5), y1 = H * (.1 + noise(i * 2.9) * .5), x2 = x1 + (noise(i * 4.4) - .5) * 160, y2 = y1 + (noise(i * 5.5) - .5) * 100; const on = noise(Math.floor(T * 5 + i)) < act; seg(x1, y1, x2, y1, P.cyan, 1.5, on ? .7 : .2); seg(x2, y1, x2, y2, P.cyan, 1.5, on ? .7 : .2); fillCircle(x2, y2, 3, on ? P.yellow : P.slate, .9); }
      g.restore();
    }
    if (p.figures > 0) { const fy = H * STAGE; person(W * .44, fy, 2.2, { color: P.rose, hair: P.rock, look: 1 }); person(W * .54, fy, 2.1, { color: P.teal, hair: P.grey, look: -1 }); }
    if (p.console > 0) {
      g.save(); g.globalAlpha *= p.console;
      roundRect(W * .4, H * .56, W * .2, H * .08, 6, P.steel2); rect(W * .415, H * .575, W * .17, H * .035, P.dark);
      for (let i = 0; i < 12; i++) { const on = noise(Math.floor(T * 6 + i)) < .5; text("∂∑φ≈∞Ψλ∫⊕Ω∇Δ"[i], W * .425 + i * W * .0135, H * .593, 11, on ? P.cyan : P.slate); }
      person(W * .5, H * STAGE, 2.3, { color: P.rose, hair: P.rock, look: 0 });
      g.restore();
    }
    if (p.teletype > 0) {
      g.save(); g.globalAlpha *= p.teletype;
      const tx = W * .64, ty = H * .56;
      roundRect(tx, ty, 150, 56, 8, P.steel); rect(tx + 12, ty + 8, 126, 20, P.dark);
      const strip = clamp(b.age * 40, 0, 180); roundRect(tx + 30, ty - strip, 90, strip + 6, 4, P.cream);
      g.restore();
    }
    if (p.dead > 0) rect(0, 0, W, H, P.black, p.dead * .55);
    vignette(.4);
  });

  /* Underground chambers where Multivac's buried body shows through the rock. */
  const VISIONS = {
    sun(cx, cy, r) { sun(cx, cy, r * .45, { rays: 10 }); },
    sunDim(cx, cy, r) { sun(cx, cy, r * .5, { core: P.orange, corona: P.red, rays: 6, alpha: .8 }); fillCircle(cx, cy, r * .2, P.slate, .5); },
    stars(cx, cy, r) { for (let i = 0; i < 40; i++) fillCircle(cx + (noise(i * 3.1) - .5) * r * 1.8, cy + (noise(i * 5.3) - .5) * r * 1.8, 1 + noise(i) * 2, P.white, .6 + .4 * Math.sin(T * 3 + i)); },
    starsOut(cx, cy, r) { for (let i = 0; i < 40; i++) { const alive = noise(i * 7.7) > ((T * .15) % 1); fillCircle(cx + (noise(i * 3.1) - .5) * r * 1.8, cy + (noise(i * 5.3) - .5) * r * 1.8, 1 + noise(i) * 2, P.white, alive ? .8 : .08); } },
    ships(cx, cy, r) { fillCircle(cx - r * .6, cy, r * .22, P.blue); fillCircle(cx + r * .65, cy - r * .1, r * .08, P.sky); for (let i = 0; i < 3; i++) { const k = (T * .3 + i * .33) % 1; ship(lerp(cx - r * .4, cx + r * .5, k), cy - r * .15 + i * r * .15, .7, P.cream, 1, .6); } },
    melt(cx, cy, r) { earth(cx, cy, r * .42, T * .2, { molten: .5 + .5 * Math.sin(T) }); },
    forever(cx, cy, r) { g.strokeStyle = rgba(P.cyan, .9); g.lineWidth = 5; g.beginPath(); for (let i = 0; i <= 80; i++) { const a = i / 80 * TAU; const x = cx + Math.cos(a) * r * .55, y = cy + Math.sin(a * 2) * r * .28; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); const k = (T * .5) % 1, a = k * TAU; fillCircle(cx + Math.cos(a) * r * .55, cy + Math.sin(a * 2) * r * .28, 6, P.yellow); },
    entropy(cx, cy, r) { for (let i = 0; i < 50; i++) { const k = (T * .2 + noise(i) ) % 1, a = noise(i * 3.3) * TAU; fillCircle(cx + Math.cos(a) * k * r * .9, cy + Math.sin(a) * k * r * .9, 3 - k * 2.5, mix(P.orange, P.slate, k), 1 - k); } },
    rebuild(cx, cy, r) { for (let i = 0; i < 50; i++) { const k = 1 - (T * .2 + noise(i)) % 1, a = noise(i * 3.3) * TAU; fillCircle(cx + Math.cos(a) * k * r * .9, cy + Math.sin(a) * k * r * .9, 3 - k * 2.5, mix(P.yellow, P.slate, k), 1 - k); } fillCircle(cx, cy, r * .12, P.yellow, .8); },
    multivac(cx, cy, r) { machineWall(cx - r * .8, cy - r * .5, r * 1.6, r, 5, .9, { cols: 5, rows: 3 }); }
  };
  defineSet("cavern", { vision: "", rest: 0, lamp: 1, drink: 1, leaving: 0, bottle: 1, look: 0 }, (p, b) => {
    sky(P.rock2, P.black);
    /* Cavern ceiling and walls */
    g.fillStyle = rgba(P.rock); g.beginPath(); g.moveTo(0, 0); for (let x = 0; x <= W; x += 40) g.lineTo(x, H * .16 + Math.sin(x * .02) * 24 + noise(Math.floor(x / 40)) * 40); g.lineTo(W, 0); g.fill();
    g.beginPath(); g.moveTo(0, 0); for (let y = 0; y <= H; y += 40) g.lineTo(W * .1 + Math.sin(y * .03) * 22 + noise(y) * 20, y); g.lineTo(0, H); g.fill();
    g.beginPath(); g.moveTo(W, 0); for (let y = 0; y <= H; y += 40) g.lineTo(W * .9 - Math.sin(y * .03) * 22 - noise(y + 3) * 20, y); g.lineTo(W, H); g.fill();
    /* Buried Multivac showing through the right wall */
    machineWall(W * .74, H * .2, W * .18, H * .4, 11, .35, { cols: 3, rows: 5, color: mix(P.steel2, P.rock, .4) });
    const fy = H * STAGE + 6;
    rect(0, fy, W, H - fy, P.rock2);
    /* Lamp glow */
    const lampX = W * .24;
    lighter(() => glow(W * .38, H * .5, W * .34, P.amber, .3 * p.lamp));
    seg(lampX, H * .14, lampX, H * .3, P.slate, 2); fillCircle(lampX, H * .32, 9, P.yellow, p.lamp); lighter(() => glow(lampX, H * .32, 44, P.yellow, .8 * p.lamp));
    /* Crates, bottle and glasses */
    const tx = W * .4, s = 2.6;
    roundRect(tx - 34, fy - 34, 68, 34, 4, mix(P.rock, P.amber, .3));
    if (p.bottle > 0) { roundRect(tx - 6, fy - 64, 12, 30, 3, P.green, p.bottle); roundRect(tx - 3, fy - 74, 6, 12, 2, P.green, p.bottle); }
    if (p.drink > 0) { for (const gx of [tx - 22, tx + 20]) { roundRect(gx - 6, fy - 50, 12, 16, 2, P.cyan, .35 * p.drink); rect(gx - 6, fy - 42, 12, 8, P.amber, .6 * p.drink); fillCircle(gx - 2 + Math.sin(T * 2 + gx) * 2, fy - 45, 2.5, P.white, .8 * p.drink); } }
    /* Two men on crates; `leaving` walks them out toward the stairs at right */
    const seated = p.leaving < .2;
    const lx = W * .29 + p.leaving * W * .5, rx = W * .52 + p.leaving * W * .32;
    if (seated) { roundRect(lx - 13 * s, fy - 9 * s, 26 * s, 9 * s, 3, mix(P.rock, P.amber, .2)); roundRect(rx - 13 * s, fy - 9 * s, 26 * s, 9 * s, 3, mix(P.rock, P.amber, .2)); }
    bird(lx, seated ? fy - 9 * s : fy, s, { color: P.rose, hair: P.rock, pose: seated ? "sit" : "stand", closed: p.rest, look: 1 });
    bird(rx, seated ? fy - 9 * s : fy, s * .95, { color: P.teal, hair: P.grey, pose: seated ? "sit" : "stand", closed: p.rest, look: seated ? -1 : 1 });
    if (p.leaving > 0) { for (let i = 0; i < 7; i++) rect(W * .8 + i * 26, fy - 8 - i * 26, 30, 8, P.slate, p.leaving); }
    /* Shared imagining, projected in the air above the crates */
    if (p.vision && VISIONS[p.vision]) {
      const cx = W * .56, cy = H * .3, r = Math.min(W, H) * .16;
      lighter(() => glow(cx, cy, r * 1.4, P.cyan, .25));
      g.save(); g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.clip(); rect(cx - r, cy - r, r * 2, r * 2, P.deep, .9); VISIONS[p.vision](cx, cy, r); g.restore();
      strokeCircle(cx, cy, r, P.cyan, .6, 2);
      for (let i = 0; i < 3; i++) fillCircle(lerp(tx + 10, cx, .3 + i * .22), lerp(fy - 80, cy + r, .3 + i * .22), 3 + i * 1.5, P.cyan, .5);
    }
    vignette(.45);
  });

  /* The sun's life, from now until it runs down. */
  defineSet("sunLife", { age: 0, timeline: 1, earthOrbit: 1 }, (p, b) => {
    spaceBackdrop({ nebulae: .3, starAlpha: .7, dead: p.age * .4 });
    const cx = W * .5, cy = H * .46, base = Math.min(W, H) * .13, a = p.age;
    let r, core, corona, alpha = 1;
    if (a < .5) { const k = a / .5; r = base * (1 + k * 1.6); core = mix(P.yellow, P.orange, k); corona = mix(P.orange, P.red, k); }
    else if (a < .8) { const k = (a - .5) / .3; r = lerp(base * 2.6, base * .25, smooth(k)); core = mix(P.orange, P.white, k); corona = mix(P.red, P.sky, k); }
    else { const k = (a - .8) / .2; r = base * .25 * (1 - k * .5); core = mix(P.white, P.slate, k); corona = mix(P.sky, P.dark, k); alpha = 1 - k * .7; }
    if (a > .5 && a < .8) { const k = (a - .5) / .3; lighter(() => glow(cx, cy, base * (2.6 + k * 2), P.magenta, (1 - k) * .3)); }
    sun(cx, cy, r, { core, corona, rays: a < .5 ? 12 : 0, alpha });
    if (p.earthOrbit > 0) { const oa = T * .35; const ox = cx + Math.cos(oa) * base * 3.1, oy = cy + Math.sin(oa) * base * 1.1; const scorched = clamp((a - .2) / .3, 0, 1); planet(ox, oy, 9, { color: mix(P.blue, P.rock, scorched), shade: P.deep, atmo: mix(P.cyan, P.red, scorched), alpha: p.earthOrbit }); }
    if (p.timeline > 0) {
      const y = H * .13, x0 = W * .44, x1 = W * .92; seg(x0, y, x1, y, P.grey, 2, .6 * p.timeline); seg(lerp(x0, x1, a), y - 12, lerp(x0, x1, a), y + 12, P.yellow, 3, p.timeline);
      text("NOW", x0, y + 24, 11, P.cream, { spacing: 2, alpha: p.timeline }); text("TEN BILLION YEARS", x1, y + 24, 11, P.cream, { spacing: 2, alpha: p.timeline });
      text(a < .35 ? "MAIN SEQUENCE" : a < .6 ? "RED GIANT" : a < .85 ? "WHITE DWARF" : "DARK", W * .68, y + 46, 12, P.amber, { spacing: 3, alpha: p.timeline });
    }
    vignette(.3);
  });

  /* Cosmos-scale: the original explosion, then every star running down. */
  defineSet("starsDying", { dead: 0, bang: 0, haze: 0, galaxies: 1 }, (p, b) => {
    sky(P.black, P.deep);
    const cx = W * .5, cy = H * .48;
    if (p.bang > 0 && p.bang < 1) { const k = p.bang; lighter(() => { glow(cx, cy, Math.max(W, H) * (.08 + k * 1.4), P.amber, (1 - k) * .9); glow(cx, cy, Math.max(W, H) * (.04 + k * .5), P.white, (1 - k)); }); }
    const spread = p.bang > 0 ? ease(p.bang) : 1;
    g.save(); g.translate(cx, cy); g.scale(spread, spread); g.translate(-cx, -cy);
    if (p.galaxies > 0) for (let i = 0; i < 10; i++) { const alive = noise(i * 9.1 + 2) > p.dead; galaxy(W * (.08 + noise(i * 3.7) * .84), H * (.1 + noise(i * 5.9) * .72), 18 + noise(i * 2.2) * 30, noise(i) * TAU, { tint: [P.sky, P.pink, P.teal][i % 3], alpha: p.galaxies * (alive ? 1 : .08), spin: T * .05 }); }
    stars({ dead: p.dead, alpha: 1, big: 1.2 });
    g.restore();
    if (p.haze > 0) { for (let i = 0; i < 40; i++) { const k = (T * .07 + noise(i * 3.3)) % 1; fillCircle(noise(i * 7.7) * W, H * (1 - k), 2 + k * 3, P.slate, p.haze * (1 - k) * .6); } }
    if (p.dead > .7) { const k = (p.dead - .7) / .3; text("HEAT DEATH", W * .7, H * .13, 12, P.grey, { spacing: 4, alpha: k * .7 }); }
    vignette(.3);
  });

  /* Lupov's parable: a man runs from the rain to a grove of trees. */
  defineSet("rainGrove", { rain: 1, running: 1, sheltered: 0, drip: 0 }, (p, b) => {
    sky(P.slate, P.steel2, P.grey, .5);
    for (let i = 0; i < 4; i++) cloud(W * (.1 + i * .27) + Math.sin(T * .2 + i) * 6, H * .14 + (i % 2) * 30, 1.4, P.steel2, .9);
    hills(H * .56, 40, .004, mix(P.green, P.dark, .5), 3); hills(H * .63, 26, .007, mix(P.green, P.dark, .35), 8);
    rect(0, H * STAGE, W, H * (1 - STAGE), mix(P.green, P.dark, .25));
    const gx = W * .66, gy = H * STAGE;
    for (let i = 0; i < 5; i++) tree(gx + (i - 2) * 64, gy - Math.abs(i - 2) * 6, 2.7 - Math.abs(i - 2) * .2, { leaf: mix(P.green, P.dark, .2), trunk: P.rock });
    const runK = clamp(b.age / 4, 0, 1);
    const px = p.running > 0 ? lerp(W * .12, gx - 20, ease(runK)) : gx - 20;
    person(px, gy, 2.2, { color: P.amber, hair: P.rock, pose: runK < 1 && p.running > 0 ? "run" : "stand", phase: T, look: 1 });
    if (p.rain > 0) { for (let i = 0; i < 320; i++) { const k = (T * .9 + noise(i * 2.3)) % 1; const x = noise(i * 5.1) * W + k * 40, y = k * H; if (p.sheltered > 0 && x > gx - 110 && x < gx + 110 && y > gy - 100) continue; seg(x, y, x - 5, y + 18, P.cyan, 1.4, p.rain * .6); } }
    if (p.drip > 0) { for (let i = 0; i < 20; i++) { const k = (T * .7 + noise(i * 4.4)) % 1; fillCircle(gx - 100 + noise(i * 1.7) * 200, gy - 70 + k * 70, 2.5, P.cyan, p.drip * (1 - k)); } }
    vignette(.35);
  });

  /* Family cabin aboard the hyperspace ship: ribbed hull, bolted viewport, the Microvac running along the ceiling. */
  function viewportScene(p, b, wx, wy, ww, wh) {
    sky(P.black, P.navy);
    if (p.view === "hyper") { for (let i = 0; i < 80; i++) { const k = (T * .5 + noise(i * 2.1)) % 1, a = noise(i * 7.3) * TAU; const cx = wx + ww / 2, cy = wy + wh / 2; lighter(() => seg(cx + Math.cos(a) * k * ww * .1, cy + Math.sin(a) * k * wh * .1, cx + Math.cos(a) * k * ww, cy + Math.sin(a) * k * wh, [P.cyan, P.magenta, P.white][i % 3], 1.5 + k * 3, k)); } return; }
    g.save(); g.translate(wx, wy); const kw = W, kh = H; W = ww; H = wh; stars({ alpha: p.view === "starsOut" ? .3 : 1, dead: p.dead, yMax: 1, parallax: .5 }); W = kw; H = kh; g.restore();
    if (p.view === "star" || p.view === "planet") { const cx = wx + ww * .6, cy = wy + wh * .48; sun(cx - ww * .32, cy - wh * .26, 16, { rays: 8 }); planet(cx, cy, 20 + p.planetSize * wh * .6, { color: P.teal, shade: P.deep, bands: 4, atmo: P.cyan, spots: 4 }); text("X-23", cx, cy + 30 + p.planetSize * wh * .6, 12, P.cream, { spacing: 4, alpha: .8 }); }
    if (p.view === "earth") { const cx = wx + ww * .5, cy = wy + wh * .5; earth(cx, cy, 24 + (1 - p.planetSize) * 40, T * .1, { lights: p.earthCrowd, night: .3 }); if (p.earthCrowd > 0) { for (let i = 0; i < 60; i++) { const a = noise(i * 3.1) * TAU, d = .3 + noise(i * 4.4) * .9; fillCircle(cx + Math.cos(a) * d * 60, cy + Math.sin(a) * d * 60, 1.5, P.cream, p.earthCrowd * .8); } } }
    if (p.view === "planets") { for (let i = 0; i < 9; i++) { const x = wx + ww * (.08 + noise(i * 2.2) * .84), y = wy + wh * (.12 + noise(i * 3.7) * .76); planet(x, y, 6 + noise(i * 5.1) * 16, { color: [P.teal, P.amber, P.rose, P.sky, P.lime][i % 5], shade: P.deep, bands: i % 2 ? 3 : 0, rings: i % 4 === 0 ? 1 : 0 }); if (i % 3 === 0) ship(x + 30, y - 20 + Math.sin(T + i) * 4, .6, P.cream, 1, .5); } }
    if (p.batteries > 0) { for (let i = 0; i < 7; i++) { const x = wx + ww * (.12 + i * .13), y = wy + wh * (.3 + (i % 2) * .35), level = clamp(1 - i * .13 - ((T * .05) % 1) * .3, 0, 1); sun(x, y, 9, { rays: 6, alpha: p.batteries * (.3 + level * .7), core: mix(P.slate, P.yellow, level), corona: mix(P.dark, P.orange, level) }); roundRect(x - 14, y + 18, 28, 8, 2, P.slate, p.batteries); roundRect(x - 13, y + 19, 26 * level, 6, 2, level > .3 ? P.green : P.red, p.batteries); rect(x + 14, y + 20, 2, 4, P.slate, p.batteries); } }
  }
  function screenPanel(x, y, w, h, seed, glowColor) {
    roundRect(x, y, w, h, 6, P.steel2); roundRect(x + 4, y + 4, w - 8, h - 8, 4, P.deep);
    g.save(); g.beginPath(); g.rect(x + 4, y + 4, w - 8, h - 8); g.clip();
    g.strokeStyle = rgba(glowColor, .8); g.lineWidth = 1.5; g.beginPath();
    for (let i = 0; i <= 12; i++) { const px = x + 6 + (w - 12) * i / 12, py = y + h * .55 - Math.sin(i * .9 + T * 1.4 + seed) * h * .2 - noise(i + seed) * h * .12; i ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.stroke();
    for (let i = 0; i < 4; i++) rect(x + 8 + i * 9, y + h - 12, 6, 4, noise(Math.floor(T * 2 + i + seed)) < .5 ? glowColor : P.slate);
    g.restore();
  }
  defineSet("shipCabin", { view: "hyper", planetSize: .2, cry: 0, film: 0, filmText: "", robotPower: 1, microvacGlow: .3, moist: 0, focus: "family", batteries: 0, dead: 0, earthCrowd: 0 }, (p, b) => {
    const hull = mix(P.slate, P.dark, .35), hullLight = mix(P.slate, P.steel2, .5), floorY = H * .6;
    sky(mix(P.dark, P.slate, .2), hull);
    /* Curved ceiling dome and hull ribs */
    g.fillStyle = rgba(mix(P.dark, P.black, .3)); g.beginPath(); g.ellipse(W * .5, -H * .55, W * .8, H * .72, 0, 0, TAU); g.fill();
    for (let i = 0; i < 9; i++) { const x = W * (.03 + i * .118); const bend = Math.abs(i - 4) / 4; g.fillStyle = rgba(hullLight, .55); g.beginPath(); g.moveTo(x, floorY); g.lineTo(x + W * .016, floorY); g.lineTo(x + W * .016 + (i < 4 ? -1 : 1) * bend * 26, H * .06); g.lineTo(x + (i < 4 ? -1 : 1) * bend * 26, H * .06); g.closePath(); g.fill(); }
    seg(0, H * .14, W, H * .14, hullLight, 3, .6); seg(0, floorY - 10, W, floorY - 10, hullLight, 3, .6);
    /* Microvac: a segmented cylinder along the ceiling */
    const mvY = H * .05, mvH = H * .065;
    roundRect(W * .04, mvY, W * .92, mvH, mvH / 2, P.steel);
    roundRect(W * .04, mvY + mvH * .15, W * .92, mvH * .28, mvH * .14, mix(P.steel, P.white, .18), .6);
    for (let i = 1; i < 16; i++) rect(W * .04 + i * W * .0575, mvY + 2, 3, mvH - 4, P.steel2, .9);
    for (let i = 0; i < 4; i++) { const mx = W * (.16 + i * .22); rect(mx - 10, mvY + mvH - 2, 20, 12, P.steel2); }
    lighter(() => glow(W * .5, mvY + mvH / 2, W * .5, P.cyan, .35 * p.microvacGlow));
    for (let i = 0; i < 15; i++) fillCircle(W * .0687 + i * W * .0575, mvY + mvH * .72, 2.6, noise(Math.floor(T * 3 + i)) < p.microvacGlow ? P.cyan : P.dark, .95);
    if (p.focus === "microvac") lighter(() => glow(W * .5, mvY + mvH / 2, W * .32, P.cyan, .35));
    /* Viewport: bolted frame with an inner bevel */
    const wx = W * .3, wy = H * .16, ww = W * .42, wh = H * .3;
    roundRect(wx - 22, wy - 22, ww + 44, wh + 44, 34, P.steel);
    roundRect(wx - 10, wy - 10, ww + 20, wh + 20, 24, P.steel2);
    for (const [bx, by] of [[wx - 12, wy - 12], [wx + ww + 12, wy - 12], [wx - 12, wy + wh + 12], [wx + ww + 12, wy + wh + 12]]) { fillCircle(bx, by, 4.5, P.slate); fillCircle(bx - 1, by - 1, 2, mix(P.steel, P.white, .3)); }
    g.save(); g.beginPath(); g.roundRect ? g.roundRect(wx, wy, ww, wh, 18) : g.rect(wx, wy, ww, wh); g.clip(); viewportScene(p, b, wx, wy, ww, wh);
    const glass = g.createLinearGradient(wx, wy, wx + ww, wy + wh); glass.addColorStop(0, rgba(P.white, .1)); glass.addColorStop(.3, rgba(P.white, 0)); glass.addColorStop(1, rgba(P.cyan, .06)); g.fillStyle = glass; g.fillRect(wx, wy, ww, wh); g.restore();
    lighter(() => glow(wx + ww / 2, wy + wh, ww * .5, P.cyan, .1));
    /* Console beneath the viewport */
    const cy0 = wy + wh + 24; roundRect(wx - 10, cy0, ww + 20, H * .075, 10, P.steel2); roundRect(wx - 10, cy0, ww + 20, 6, 3, mix(P.steel, P.white, .1));
    for (let i = 0; i < 6; i++) { const sx = wx + 10 + i * (ww / 6); roundRect(sx, cy0 + 12, ww / 6 - 14, H * .035, 4, P.deep); rect(sx + 4, cy0 + 16, (ww / 6 - 22) * (.3 + noise(Math.floor(T * 1.5 + i)) * .6), 4, [P.cyan, P.amber, P.green][i % 3], .9); for (let j = 0; j < 3; j++) fillCircle(sx + 8 + j * 9, cy0 + H * .035 + 22, 2.4, noise(Math.floor(T * 2 + i * 3 + j)) < .5 ? [P.green, P.amber, P.red][j] : P.slate); }
    text("X-23 · APPROACH VECTOR", wx + ww / 2, cy0 + H * .075 - 7, 8, P.cream, { spacing: 2, alpha: .55 });
    /* Left: instrument panels. Right: hatch. */
    screenPanel(W * .06, H * .37, W * .17, H * .1, 1, P.cyan); screenPanel(W * .06, H * .485, W * .17, H * .09, 7, P.amber);
    for (let i = 0; i < 8; i++) fillCircle(W * .84 + i * W * .016, H * .14 + 14, 3, noise(Math.floor(T * 2 + i * 1.3)) < .55 ? [P.green, P.cyan, P.amber][i % 3] : P.slate);
    const hx = W * .8, hy = H * .18, hw = W * .14, hh = H * .38;
    roundRect(hx - 8, hy - 8, hw + 16, hh + 16, 18, P.steel); roundRect(hx, hy, hw, hh, 12, P.steel2); strokeCircle(hx + hw / 2, hy + hh * .3, hw * .26, P.steel, 1, 7); fillCircle(hx + hw / 2, hy + hh * .3, hw * .22, P.deep); fillCircle(hx + hw / 2 - 3, hy + hh * .3 - 4, hw * .05, P.white, .25);
    roundRect(hx + hw * .3, hy + hh * .64, hw * .4, 8, 4, P.steel); rect(hx + hw * .46, hy + hh * .64 - 10, hw * .08, 28, P.steel);
    fillCircle(hx + hw / 2, hy + hh * .88, 4, P.green, .5 + .5 * Math.sin(T * 2));
    /* Deck */
    rect(0, floorY, W, H - floorY, mix(P.slate, P.dark, .15)); rect(0, floorY, W, 8, hullLight);
    for (let i = 0; i <= 14; i++) seg(W * (i / 14), H, W * .5 + (W * (i / 14) - W * .5) * .55, floorY + 8, P.dark, 1, .5);
    for (let i = 1; i < 5; i++) { const y = floorY + 8 + (H - floorY) * Math.pow(i / 5, 1.6); seg(0, y, W, y, P.dark, 1, .5); }
    /* Table, cups and seats */
    const ty = H * .63; roundRect(W * .08, ty, W * .14, 10, 5, P.steel); seg(W * .11, ty + 10, W * .105, H * STAGE + 6, P.steel2, 6); seg(W * .19, ty + 10, W * .195, H * STAGE + 6, P.steel2, 6);
    roundRect(W * .11, ty - 12, 10, 12, 2, P.cyan, .8); roundRect(W * .16, ty - 10, 10, 10, 2, P.amber, .8);
    for (const sx of [W * .86, W * .94]) { roundRect(sx - 14, H * .58, 28, 30, 8, P.steel2); roundRect(sx - 16, H * .6, 32, 10, 5, P.steel); }
    /* Family */
    const fy = H * STAGE;
    bird(W * .34, fy, 2.4, { color: P.blue, hair: P.rock, look: p.focus === "window" ? 0 : 1, slim: .5 });
    bird(W * .46, fy, 2.2, { color: P.rose, hair: P.amber, look: p.focus === "window" ? 0 : -1, closed: 0 });
    if (p.moist > 0) { fillCircle(W * .46 - 6, fy - 64, 2.5, P.cyan, p.moist); fillCircle(W * .46 + 8, fy - 58 + ((T * 30) % 18), 2.2, P.cyan, p.moist * .8); }
    const kidBounce = p.cry > 0 ? Math.abs(Math.sin(T * 6)) * 3 : 0;
    bird(W * .57, fy - kidBounce, 1.5, { color: P.lime, hair: P.rock, look: -1, closed: p.cry, pose: p.focus === "microvac" ? "point" : "stand" });
    bird(W * .65, fy - kidBounce, 1.35, { color: P.pink, hair: P.amber, look: -1, closed: p.cry, pose: p.focus === "microvac" ? "point" : "stand" });
    if (p.cry > 0) { for (const kx of [W * .57, W * .65]) for (let i = 0; i < 3; i++) { const k = (T * 1.2 + i * .33) % 1; fillCircle(kx - 8 + i * 8, fy - 56 + k * 30, 2.4, P.cyan, p.cry * (1 - k)); } }
    /* Toy robot */
    robot(W * .76, fy, 1.6, { power: p.robotPower });
    if (p.robotPower < .5) text("z z", W * .79, fy - 60 + Math.sin(T * 2) * 3, 11, P.cyan, { alpha: .7 });
    /* Cellufilm strip */
    if (p.film > 0) { const fx = W * .51, fyy = H * .6; g.save(); g.globalAlpha *= p.film; roundRect(fx - 150, fyy - 16, 300, 32, 4, P.cream); caption(p.filmText || "", fx, fyy, 11, P.dark, clamp(b.age / 2.4, 0, 1)); g.restore(); }
    vignette(.35);
  });

  /* Human expansion across a galaxy, mapped. */
  defineSet("galaxyExpansion", { filled: .2, ships: 1, planetaryAC: 0, compare: 0, scroll: 0 }, (p, b) => {
    spaceBackdrop({ nebulae: .7, starAlpha: .6 });
    const cx = W * .55, cy = H * .48, r = Math.min(W, H) * .34;
    galaxy(cx, cy, r, .3, { tint: P.sky, spin: T * .02, tilt: .5 });
    g.save(); g.translate(cx, cy); g.rotate(.3); g.scale(1, .5); g.rotate(T * .02);
    for (let i = 0; i < GALAXY.length; i++) { const pt = GALAXY[i]; const d = Math.hypot(pt.x, pt.y) / .4; if (d < p.filled) { const k = clamp((p.filled - d) * 6, 0, 1); fillCircle(pt.x * r * 2.4, pt.y * r * 2.4, Math.max(1.5, pt.s * r * .012), P.amber, k * .95); } }
    g.restore();
    if (p.ships > 0) for (let i = 0; i < 6; i++) { const k = (T * .1 + i * .17) % 1, a = i * 1.1 + T * .02; const d = p.filled * r * 1.1 * k; ship(cx + Math.cos(a) * d, cy + Math.sin(a) * d * .5, .7, P.cream, Math.cos(a) > 0 ? 1 : -1, .7 * p.ships); }
    if (p.planetaryAC > 0) { g.save(); g.globalAlpha *= p.planetaryAC; const px = W * .2, py = H * .58; planet(px, py, 56, { color: P.amber, shade: P.rock, bands: 3 }); machineWall(px - 40, py - 24, 80, 36, 21, .9, { cols: 6, rows: 3 }); text("PLANETARY AC", px, py + 78, 11, P.cream, { spacing: 3 }); g.restore(); }
    if (p.compare > 0) { g.save(); g.globalAlpha *= p.compare; const y = H * .62; machineWall(W * .1, y - 90, W * .3, 90, 7, .7, { cols: 8, rows: 4 }); text("MULTIVAC · A HUNDRED SQUARE MILES", W * .25, y + 20, 10, P.cream, { spacing: 2 }); roundRect(W * .66, y - 12, 90, 14, 7, P.steel); lighter(() => glow(W * .66 + 45, y - 5, 60, P.cyan, .5)); text("MICROVAC · ONE ROD", W * .66 + 45, y + 20, 10, P.cream, { spacing: 2 }); g.restore(); }
    text(`${Math.round(p.filled * 100)}% OF THE GALAXY`, W * .7, H * .13, 11, P.amber, { spacing: 4, alpha: .8 });
    vignette(.32);
  });

  /* Two immortal bureaucrats and a floating map of the Galaxy. */
  defineSet("councilRoom", { map: 1, cubeOn: 0, cubeGlow: 0, speaking: 0, mapFill: .8, threads: 0 }, (p, b) => {
    const wall = mix(P.indigo, P.dark, .45), floorY = H * .58;
    sky(mix(P.indigo, P.dark, .2), wall);
    /* Panoramic window onto space, framed by mullions */
    const winX = W * .18, winY = H * .1, winW = W * .64, winH = H * .34;
    g.save(); g.beginPath(); g.roundRect ? g.roundRect(winX, winY, winW, winH, 26) : g.rect(winX, winY, winW, winH); g.clip();
    sky(P.black, P.deep); stars({ alpha: .9, yMax: .7, parallax: .5 }); nebula(W * .6, H * .2, W * .2, P.magenta, .25); nebula(W * .3, H * .34, W * .16, P.teal, .18);
    for (let i = 0; i < 5; i++) galaxy(winX + winW * (.1 + i * .2), winY + winH * (.25 + noise(i * 3) * .5), 10 + noise(i * 5) * 12, noise(i) * TAU, { tint: [P.sky, P.pink, P.teal][i % 3], spin: T * .04, alpha: .8 });
    g.restore();
    g.strokeStyle = rgba(P.steel); g.lineWidth = 12; g.beginPath(); g.roundRect ? g.roundRect(winX, winY, winW, winH, 26) : g.rect(winX, winY, winW, winH); g.stroke();
    for (let i = 1; i < 4; i++) seg(winX + winW * i / 4, winY, winX + winW * i / 4, winY + winH, P.steel, 5, .9);
    /* Pillars either side and a cornice */
    for (const px of [W * .1, W * .88]) { roundRect(px - 16, H * .04, 32, floorY - H * .04, 6, mix(P.steel2, P.dark, .3)); rect(px - 22, H * .04, 44, 12, P.steel2); rect(px - 22, floorY - 14, 44, 14, P.steel2); lighter(() => glow(px, H * .3, 60, P.cyan, .08)); }
    rect(0, H * .04, W, 6, P.steel2);
    /* Raised dais and floor */
    rect(0, floorY, W, H - floorY, mix(P.dark, P.black, .25)); rect(0, floorY, W, 5, P.slate);
    g.fillStyle = rgba(mix(P.slate, P.dark, .5)); g.beginPath(); g.ellipse(W * .5, floorY + 22, W * .34, 22, 0, 0, TAU); g.fill();
    g.fillStyle = rgba(mix(P.slate, P.dark, .3)); g.beginPath(); g.ellipse(W * .5, floorY + 14, W * .34, 22, 0, Math.PI, TAU); g.fill();
    lighter(() => { g.strokeStyle = rgba(P.cyan, .35 * (.6 + p.map * .4)); g.lineWidth = 3; g.beginPath(); g.ellipse(W * .5, floorY + 22, W * .3, 16, 0, 0, TAU); g.stroke(); });
    /* Hologram pedestal with emitter ring */
    const ty = floorY + 4;
    roundRect(W * .44, ty - 18, W * .12, 18, 6, P.steel2); roundRect(W * .41, ty - 26, W * .18, 12, 6, P.steel);
    lighter(() => { g.strokeStyle = rgba(P.cyan, .9); g.lineWidth = 3; g.beginPath(); g.ellipse(W * .5, ty - 26, W * .075, 6, 0, 0, TAU); g.stroke(); glow(W * .5, ty - 26, 60, P.cyan, .35 * p.map); });
    /* Side table for the AC-contact */
    roundRect(W * .54, ty - 8, W * .12, 10, 5, P.steel); seg(W * .6, ty + 2, W * .6, ty + 34, P.steel2, 8);
    /* 3D galaxy map above the table */
    if (p.map > 0) { g.save(); g.globalAlpha *= p.map; const mx = W * .5, my = H * .36; lighter(() => glow(mx, my, 130, P.cyan, .25)); galaxy(mx, my, 96, -.2 + Math.sin(T * .3) * .1, { tint: P.cyan, core: P.white, tilt: .38, spin: T * .12 }); g.save(); g.translate(mx, my); g.rotate(-.2 + Math.sin(T * .3) * .1); g.scale(1, .38); g.rotate(T * .12); for (let i = 0; i < GALAXY.length; i++) { const pt = GALAXY[i]; if (Math.hypot(pt.x, pt.y) / .4 < p.mapFill) fillCircle(pt.x * 96 * 2.4, pt.y * 96 * 2.4, 2, P.amber, .9); } g.restore(); for (let i = 0; i < 3; i++) strokeCircle(mx, my + 20, 40 + i * 30 + ((T * 14) % 30), P.cyan, .2, 1); lighter(() => { const cone = g.createLinearGradient(0, ty - 26, 0, my); cone.addColorStop(0, rgba(P.cyan, .28)); cone.addColorStop(1, rgba(P.cyan, 0)); g.fillStyle = cone; g.beginPath(); g.moveTo(mx - W * .07, ty - 26); g.lineTo(mx + W * .07, ty - 26); g.lineTo(mx + 110, my); g.lineTo(mx - 110, my); g.closePath(); g.fill(); }); g.restore(); }
    /* Tall, perfectly formed figures */
    bird(W * .34, H * STAGE, 2.6, { color: P.violet, slim: 1, look: 1, hair: P.cream });
    bird(W * .7, H * STAGE, 2.6, { color: P.teal, slim: 1, look: -1, hair: P.dark, pose: p.cubeOn > .5 && p.cubeOn < 1 ? "point" : "stand" });
    /* AC-contact on the table */
    if (p.cubeOn > 0) { const cx = W * .6, cy = ty - 14; g.save(); g.globalAlpha *= p.cubeOn; cube(cx, cy, 13, p.cubeGlow); if (p.threads > 0) { for (let i = 0; i < 7; i++) { const a = -Math.PI * .1 - i * .13 - Math.sin(T + i) * .05; beam(cx, cy - 10, cx + Math.cos(a) * W * .6, cy - 10 + Math.sin(a) * W * .6, P.magenta, 1, p.threads * .4); } } if (p.speaking > 0) { for (let i = 0; i < 3; i++) strokeCircle(cx, cy - 8, 16 + i * 14 + ((T * 20) % 14), P.cyan, p.speaking * .5 * (1 - i / 3), 1.5); for (let i = 0; i < 18; i++) { const h = (4 + Math.abs(Math.sin(T * 6 + i * .8)) * 18) * p.speaking; rect(cx - 60 + i * 7, cy - 60 - h / 2, 4, h, P.cyan, .8); } } g.restore(); }
    vignette(.35);
  });

  /* A hundred billion galaxies. */
  const WEB = Array.from({ length: 150 }, (_, i) => ({ x: noise(i * 2.3 + 5), y: noise(i * 4.1 + 5), r: 7 + noise(i * 6.7) * 22, a: noise(i * 8.9) * TAU, t: i % 3, d: Math.hypot(noise(i * 2.3 + 5) - .5, noise(i * 4.1 + 5) - .5) }));
  defineSet("galaxyField", { zoom: 1, filled: 0, ships: 0, sunUnits: 0, gasStar: 0, heat: 0, count: 1 }, (p, b) => {
    sky(P.black, P.deep);
    nebula(W * .3, H * .5, W * .5, P.violet, .12); nebula(W * .75, H * .35, W * .4, P.magenta, .08);
    stars({ alpha: .4, big: .8 });
    g.save(); g.translate(W / 2, H / 2); g.scale(p.zoom, p.zoom); g.translate(-W / 2, -H / 2);
    for (let i = 0; i < WEB.length * p.count; i++) { const w = WEB[i]; const taken = w.d * 1.4 < p.filled; galaxy(w.x * W, w.y * H, w.r, w.a, { tint: taken ? P.amber : [P.sky, P.pink, P.teal][w.t], core: taken ? P.yellow : P.cream, spin: T * .03, alpha: .9, arms: w.r > 12 }); }
    g.restore();
    if (p.ships > 0) for (let i = 0; i < 8; i++) { const a = WEB[i * 7], bb = WEB[i * 7 + 3], k = (T * .08 + i * .125) % 1; ship(lerp(a.x, bb.x, k) * W, lerp(a.y, bb.y, k) * H, .8, P.cream, bb.x > a.x ? 1 : -1, .8 * p.ships); }
    if (p.sunUnits > 0) { g.save(); g.globalAlpha *= p.sunUnits; const y = H * .14; for (let i = 0; i < 12; i++) { const used = i < 2; sun(W * .44 + i * W * .042, y, 9, { rays: 6, alpha: used ? 1 : .35, core: used ? P.yellow : P.slate, corona: used ? P.orange : P.dark }); } text("2 OF 1000 SUNPOWER UNITS USED", W * .67, y + 30, 11, P.amber, { spacing: 3 }); g.restore(); }
    if (p.gasStar > 0) { const cx = W * .5, cy = H * .48, k = p.gasStar; for (let i = 0; i < 90; i++) { const a = noise(i * 3.3) * TAU, d0 = 60 + noise(i * 5.1) * 180, d = d0 * (1 - ease(k)) + 6; fillCircle(cx + Math.cos(a + k * 3) * d, cy + Math.sin(a + k * 3) * d, 2 + noise(i) * 3, mix(P.cyan, P.yellow, k), .7); } sun(cx, cy, 6 + k * 34, { alpha: smooth(k * 1.4), rays: 10 }); }
    if (p.heat > 0) { for (let i = 0; i < 60; i++) { const k = (T * .1 + noise(i * 2.7)) % 1; fillCircle(noise(i * 6.1) * W, H * .5 + (k - .5) * H, 2 + k * 2, P.orange, p.heat * (1 - k) * .4); } }
    vignette(.28);
  });

  /* The Galactic AC: a little world wrapped in a spider webbing of force-beams. */
  defineSet("galacticAC", { glowAmt: 1 }, (p, b) => {
    spaceBackdrop({ nebulae: .8, starAlpha: .8 });
    const cx = W * .55, cy = H * .42, r = Math.min(W, H) * .2;
    lighter(() => glow(cx, cy, r * 2.4, P.magenta, .25 * p.glowAmt));
    planet(cx, cy, r * .55, { color: P.violet, shade: P.deep, bands: 2, atmo: P.magenta });
    for (let ring = 1; ring <= 4; ring++) { g.strokeStyle = rgba(P.cyan, .35); g.lineWidth = 1.5; g.beginPath(); for (let i = 0; i <= 12; i++) { const a = i / 12 * TAU + T * .05 * ring; const rr = r * (.6 + ring * .12); const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * .8; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + T * .05; beam(cx + Math.cos(a) * r * .55, cy + Math.sin(a) * r * .44, cx + Math.cos(a + .2) * r * 1.08, cy + Math.sin(a + .2) * r * .86, P.cyan, 1.5, .5); fillCircle(cx + Math.cos(a + .2) * r * 1.08, cy + Math.sin(a + .2) * r * .86, 4, P.white, .9); }
    text("A THOUSAND FEET ACROSS", W * .7, H * .13, 11, P.cream, { spacing: 4, alpha: .7 });
    vignette(.3);
  });

  /* You can't turn smoke and ash back into a tree. */
  defineSet("treeAsh", { burn: 0 }, (p, b) => {
    sky(P.deep, P.indigo, P.violet, .7);
    stars({ alpha: .6, yMax: .6 });
    hills(H * .58, 30, .005, mix(P.green, P.dark, .55), 2); rect(0, H * STAGE, W, H * (1 - STAGE), mix(P.green, P.dark, .4));
    const tx = W * .55, ty = H * STAGE, k = p.burn;
    if (k > .05 && k < .95) { lighter(() => glow(tx, ty - 60, 120, P.orange, Math.sin(k * Math.PI) * .6)); for (let i = 0; i < 40; i++) { const kk = (T * .5 + noise(i * 3.1)) % 1; fillCircle(tx + (noise(i * 5.5) - .5) * 70 + Math.sin(kk * 8 + i) * 8, ty - 40 - kk * 120, 2 + (1 - kk) * 3, mix(P.yellow, P.red, kk), Math.sin(k * Math.PI) * (1 - kk)); } }
    tree(tx, ty, 3.2, { burn: k });
    if (k > .3) { for (let i = 0; i < 70; i++) { const kk = (T * .12 + noise(i * 2.2)) % 1; glow(tx + (noise(i * 7.3) - .5) * 160 + kk * 60, ty - 100 - kk * H * .6, 10 + kk * 30, P.grey, (k - .3) * (1 - kk) * .5); } }
    if (k > .6) { for (let i = 0; i < 50; i++) { const kk = (T * .2 + noise(i * 4.4)) % 1; fillCircle(tx + (noise(i * 9.1) - .5) * 240, ty - 100 + kk * 110, 1.5, P.grey, (k - .6) * 2 * (1 - kk)); } }
    text(k < .5 ? "TREE" : "SMOKE AND ASH", W * .7, H * .13, 12, P.cream, { spacing: 4, alpha: .7 });
    vignette(.35);
  });

  /* Zee Prime: a disembodied mind drifting across galaxies. */
  defineSet("mindGalaxy", { wisps: 1, zoom: 0, origin: 0, nova: 0, newWorld: 0, buildStar: 0, dead: 0, dim: 0 }, (p, b) => {
    sky(P.black, P.deep);
    nebula(W * .25, H * .35, W * .4, P.violet, .18 * (1 - p.dim)); nebula(W * .75, H * .6, W * .35, P.teal, .12 * (1 - p.dim));
    const cx = W * .55, cy = H * .48;
    /* Zoom 0: one galaxy fills the view.  Zoom 1: the sea of galaxies. */
    const bigR = Math.min(W, H) * .42, k = p.zoom;
    if (k < 1) galaxy(cx, cy, bigR * (1 - k * .85), .25, { tint: P.sky, spin: T * .015, tilt: .55, alpha: (1 - k * .5) * (1 - p.dim * .6) });
    const originX = W * .64, originY = H * .34;
    if (k > 0) { for (let i = 0; i < WEB.length; i++) { const w = WEB[i]; const isOrigin = i === 41; const gx = isOrigin ? originX : w.x * W, gy = isOrigin ? originY : w.y * H; galaxy(lerp(cx, gx, k), lerp(cy, gy, k), w.r * k * (isOrigin ? 1 + p.origin * 3 : 1), w.a, { tint: isOrigin && p.origin > 0 ? P.amber : [P.sky, P.pink, P.teal][w.t], spin: T * .03, alpha: k * (1 - p.dim * .7) * (isOrigin ? 1 : 1 - p.origin * .5), arms: w.r * k > 10 || isOrigin }); } }
    stars({ alpha: .8 * (1 - p.dim * .8), dead: p.dead, big: .9 });
    if (p.nova > 0) { const n = p.nova, ox = k > 0 ? originX : cx, oy = k > 0 ? originY : cy; if (n < .55) { const q = n / .55; lighter(() => { glow(ox, oy, 20 + q * 260, P.amber, (1 - q) * .9); glow(ox, oy, 10 + q * 120, P.white, (1 - q)); }); strokeCircle(ox, oy, q * 260, P.orange, (1 - q) * .8, 3); } fillCircle(ox, oy, 3, P.white, clamp((n - .4) * 3, 0, 1)); lighter(() => glow(ox, oy, 26, P.sky, clamp((n - .4) * 2, 0, 1) * .6)); if (n > .6) text("WHITE DWARF", ox, oy + 28, 11, P.sky, { spacing: 3, alpha: (n - .6) * 2 }); }
    if (p.newWorld > 0) { const q = p.newWorld; planet(W * .3, H * .6, 40 * ease(q), { color: P.teal, shade: P.deep, bands: 3, atmo: P.cyan }); for (let i = 0; i < 4; i++) robot(W * .3 + Math.cos(T * .6 + i * 1.57) * 62, H * .6 + Math.sin(T * .6 + i * 1.57) * 62, .7, { alpha: q }); }
    if (p.buildStar > 0) { const q = p.buildStar; for (let i = 0; i < 80; i++) { const a = noise(i * 3.3) * TAU, d = (80 + noise(i * 5.1) * 220) * (1 - ease(q)) + 8; fillCircle(cx + Math.cos(a + q * 2) * d, cy + Math.sin(a + q * 2) * d, 2 + noise(i) * 3, mix(P.cyan, P.yellow, q), .7); } sun(cx, cy, 4 + q * 22, { alpha: smooth(q * 1.5), rays: 8 }); }
    /* Minds */
    wisp(cx - 120 + Math.sin(T * .5) * 30, cy - 60 + Math.cos(T * .4) * 24, 1.3, P.cyan, 0);
    if (p.wisps > 1) wisp(cx + 140 + Math.sin(T * .45 + 2) * 30, cy - 30 + Math.cos(T * .5 + 1) * 24, 1.2, P.pink, 2, clamp(p.wisps - 1, 0, 1));
    vignette(.3);
  });

  /* Planets of sleeping bodies tended by automatons. */
  defineSet("podWorld", { rise: 1, automatons: 1, dim: 0, rows: 5 }, (p, b) => {
    sky(mix(P.deep, P.black, p.dim), mix(P.indigo, P.deep, p.dim));
    stars({ alpha: .7 * (1 - p.dim * .6), yMax: .55 });
    for (let i = 0; i < 5; i++) galaxy(W * (.1 + i * .2), H * (.1 + noise(i * 3) * .3), 14 + noise(i * 7) * 14, noise(i) * TAU, { tint: [P.sky, P.pink, P.teal][i % 3], alpha: .8 * (1 - p.dim * .7), spin: T * .04 });
    /* Curved planet surface */
    g.fillStyle = rgba(mix(P.slate, P.dark, .3 + p.dim * .4)); g.beginPath(); g.arc(W * .5, H * 2.1, H * 1.66, Math.PI, TAU); g.fill();
    const rows = Math.round(p.rows);
    for (let r = rows - 1; r >= 0; r--) { const depth = r / rows, y = H * .7 - depth * H * .2, s = .45 + (1 - depth) * 1.3, n = 4 + r * 2; for (let i = 0; i < n; i++) { const x = W * .5 + (i - (n - 1) / 2) * (W * .17 * s + 12); pod(x, y, s, { alpha: 1 - depth * .5, light: 1 - p.dim }); if (p.rise > 0 && (i + r) % 3 === 0) { const k = (T * .12 + noise(i * 3 + r)) % 1; const mx = x + Math.sin(k * 9 + i) * 10 * s, my = y - 26 * s - k * H * .32; lighter(() => glow(mx, my, 14 * s + 6, P.cyan, p.rise * (1 - k) * .7)); fillCircle(mx, my, 2.2 * s + 1, P.white, p.rise * (1 - k)); } } }
    if (p.automatons > 0) for (let i = 0; i < 4; i++) robot(W * (.15 + i * .23) + Math.sin(T * .4 + i) * 40, H * STAGE + 4, 1.4, { alpha: p.automatons, power: 1 - p.dim * .5 });
    text("A TRILLION, TRILLION, TRILLION AGELESS BODIES", W * .68, H * .13, 10, P.cream, { spacing: 3, alpha: .55 });
    vignette(.35);
  });

  /* Universal AC: a shining globe, two feet across, somewhere in hyperspace. */
  defineSet("universalAC", { globe: 1, receptors: 0, chain: 0, flicker: 1 }, (p, b) => {
    sky(P.indigo, P.deep, P.violet, .5);
    /* hyperspace lattice */
    g.strokeStyle = rgba(P.magenta, .18); g.lineWidth = 1;
    for (let i = 0; i < 14; i++) { g.beginPath(); for (let x = 0; x <= W; x += 30) { const y = H * (i / 13) + Math.sin(x * .01 + T * .5 + i) * 18 + Math.cos(x * .004 - T * .3) * 24; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    const cx = W * .55, cy = H * .42;
    if (p.receptors > 0) { for (let i = 0; i < 26; i++) { const a = i / 26 * TAU; const x = cx + Math.cos(a) * W * .6, y = cy + Math.sin(a) * H * .6; beam(x, y, cx, cy, P.cyan, 1, p.receptors * .35); const k = (T * .3 + i * .1) % 1; fillCircle(lerp(x, cx, k), lerp(y, cy, k), 2.5, P.white, p.receptors * (1 - k)); } }
    if (p.globe > 0) { const fl = p.flicker ? .5 + .5 * Math.sin(T * 2.2) * Math.sin(T * 5.1) : 1; lighter(() => { glow(cx, cy, 160, P.cyan, .35 * p.globe * (.5 + fl * .5)); glow(cx, cy, 60, P.white, .6 * p.globe * fl); }); fillCircle(cx, cy, 22, P.white, p.globe * (.5 + fl * .5)); strokeCircle(cx, cy, 30 + Math.sin(T * 3) * 4, P.cyan, p.globe * .5, 2); text("TWO FEET ACROSS", cx, cy + 60, 11, P.cream, { spacing: 4, alpha: p.globe * .6 }); }
    if (p.chain > 0) { g.save(); g.globalAlpha *= p.chain; const y = H * .15; for (let i = 0; i < 6; i++) { const x = W * .44 + i * W * .095, r = 6 + i * 3.5, k = clamp(b.age * .6 - i * .8, 0, 1); lighter(() => glow(x, y, r * 3, P.cyan, .4 * k)); fillCircle(x, y, r * k, P.white, .9); if (i < 5) beam(x + r, y, x + W * .095 - r - 10, y, P.cyan, 1.5, .5 * k); } text("EACH UNIVERSAL AC BUILT ITS SUCCESSOR", W * .68, y + 36, 10, P.cream, { spacing: 3 }); g.restore(); }
    vignette(.3);
  });

  /* Sky of dying white dwarfs. */
  defineSet("whiteDwarfSky", { collide: 0, meter: 0, dim: .5 }, (p, b) => {
    sky(P.black, P.deep);
    for (let i = 0; i < 90; i++) { const x = noise(i * 2.7 + 8) * W, y = noise(i * 4.9 + 8) * H; const a = (.25 + noise(i) * .5) * (1 - p.dim * .6); fillCircle(x, y, 1.2 + noise(i * 3) * 1.6, P.sky, a); if (i % 9 === 0) glow(x, y, 10, P.sky, a * .5); }
    for (let i = 0; i < 6; i++) galaxy(W * (.1 + noise(i * 3.1) * .8), H * (.1 + noise(i * 5.3) * .7), 12 + noise(i) * 14, noise(i * 7) * TAU, { tint: P.slate, core: P.grey, alpha: .4 * (1 - p.dim * .5), spin: T * .02 });
    if (p.collide > 0) { const k = p.collide, cx = W * .5, cy = H * .46; const d = 140 * (1 - ease(Math.min(1, k * 1.6))); if (k < .62) { fillCircle(cx - d, cy, 7, P.white); fillCircle(cx + d, cy, 6, P.sky); lighter(() => { glow(cx - d, cy, 30, P.sky, .6); glow(cx + d, cy, 26, P.sky, .6); }); } else { const q = (k - .62) / .38; sun(cx, cy, 14 + q * 26, { rays: 10, alpha: 1 }); lighter(() => glow(cx, cy, 200 * q, P.amber, (1 - q) * .7)); text("A NEW STAR", cx, cy + 70, 12, P.amber, { spacing: 4, alpha: q }); } }
    if (p.meter > 0) { g.save(); g.globalAlpha *= p.meter; const x = W * .45, y = H * .12, w = W * .45; roundRect(x, y, w, 14, 7, P.slate); roundRect(x + 2, y + 2, (w - 4) * .12, 10, 5, P.amber); text("ENERGY LEFT IN THE UNIVERSE · CAREFULLY HUSBANDED", W * .675, y + 30, 10, P.cream, { spacing: 2 }); g.restore(); }
    vignette(.3);
  });

  /* Cosmic AC / AC alone: hyperspace, neither matter nor energy. */
  const LAT = Array.from({ length: 140 }, (_, i) => { const gx = i % 14, gy = Math.floor(i / 14); return { gx: gx / 13, gy: gy / 9, rx: noise(i * 3.3 + 1), ry: noise(i * 7.7 + 1), ph: noise(i) * TAU }; });
  defineSet("cosmicAC", { organize: .5, chaos: 0, pulse: 0, bright: 1, spark: 0, tint: 0 }, (p, b) => {
    sky(mix(P.black, P.indigo, p.bright * .5), mix(P.deep, P.violet, p.bright * .4));
    const pts = LAT.map((l) => ({ x: lerp(l.rx, l.gx, p.organize) * W * .84 + W * .08 + Math.sin(T * .8 + l.ph) * 6 * (1 + p.chaos * 5), y: lerp(l.ry, l.gy, p.organize) * H * .54 + H * .1 + Math.cos(T * .6 + l.ph) * 6 * (1 + p.chaos * 5) }));
    const tint = mix(P.cyan, P.amber, p.tint);
    lighter(() => glow(W * .52, H * .4, W * .3, tint, .12 * p.bright));
    for (let i = 0; i < LAT.length; i++) { const gx = i % 14, gy = Math.floor(i / 14); for (const j of [i + 1, i + 14]) { if (j >= LAT.length || (j === i + 1 && gx === 13)) continue; const strength = p.organize * .5 + .1; seg(pts[i].x, pts[i].y, pts[j].x, pts[j].y, tint, 1, strength * p.bright); } }
    for (let i = 0; i < pts.length; i++) { const on = noise(Math.floor(T * 2 + i)) < .3 + p.organize * .5; fillCircle(pts[i].x, pts[i].y, on ? 2.6 : 1.4, on ? P.white : tint, p.bright * (on ? .95 : .4)); }
    if (p.pulse > 0) { const cx = W * .5, cy = H * .47; const k = (b.age * .5) % 1; lighter(() => { strokeCircle(cx, cy, k * W * .6, tint, (1 - k) * .6 * p.pulse, 3); glow(cx, cy, 120, tint, .3 * p.pulse); }); }
    if (p.spark > 0) lighter(() => { glow(W * .5, H * .47, 80 + p.spark * 200, P.white, p.spark * .8); glow(W * .5, H * .47, 400 * p.spark, P.amber, p.spark * .5); });
    vignette(.3);
  });

  /* The last dark star; the last mind. */
  defineSet("lastStar", { ember: .6, minds: 1, fuse: 0, matter: 1 }, (p, b) => {
    sky(P.black, P.black);
    const cx = W * .5, cy = H * .5;
    if (p.matter > 0) for (let i = 0; i < 60; i++) { const k = (T * .02 + noise(i * 3.7)) % 1; fillCircle(noise(i * 5.9) * W, noise(i * 8.3) * H + Math.sin(T * .3 + i) * 4, 1.6, P.grey, p.matter * (.2 + .3 * Math.sin(k * TAU))); }
    lighter(() => { glow(cx, cy, 220 * p.ember + 20, P.red, .5 * p.ember); glow(cx, cy, 60, P.orange, .5 * p.ember); });
    fillCircle(cx, cy, 30, mix(P.dark, P.red, p.ember * .8)); fillCircle(cx - 9, cy - 7, 9, mix(P.dark, P.orange, p.ember), .8);
    for (let i = 0; i < 6; i++) { const a = i * 1.05 + T * .1; fillCircle(cx + Math.cos(a) * 22, cy + Math.sin(a) * 22, 3, mix(P.dark, P.orange, p.ember), .5 + .5 * Math.sin(T * 2 + i)); }
    if (p.minds > 0) { const n = Math.round(p.minds * 24); for (let i = 0; i < 24; i++) { if (i >= n) continue; const a = noise(i * 2.1) * TAU, d0 = 120 + noise(i * 4.4) * Math.min(W, H) * .35; const d = d0 * (1 - ease(p.fuse)); const x = cx + Math.cos(a + T * .05) * d, y = cy + Math.sin(a + T * .05) * d * .7; wisp(x, y, .8, P.cyan, i, .9); } }
    if (p.fuse > .95) lighter(() => glow(cx, cy, 90, P.cyan, .6));
    vignette(.2);
  });

  /* LET THERE BE LIGHT. */
  defineSet("genesis", { flash: 0, born: 0 }, (p, b) => {
    sky(P.black, P.black);
    const cx = W * .5, cy = H * .48;
    if (p.born > 0) { const k = p.born; nebula(cx - W * .2, cy, W * .5 * k, P.magenta, .5 * k); nebula(cx + W * .25, cy - H * .2, W * .4 * k, P.cyan, .45 * k); nebula(cx, cy + H * .25, W * .45 * k, P.amber, .4 * k); for (let i = 0; i < 12; i++) { const a = noise(i * 3.3) * TAU, d = noise(i * 5.1) * Math.min(W, H) * .45 * k; galaxy(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 10 + noise(i) * 30 * k, a, { tint: [P.sky, P.pink, P.teal][i % 3], spin: T * .1, alpha: k }); } stars({ alpha: k, big: 1.3 }); }
    if (p.flash > 0) { const k = p.flash; lighter(() => { glow(cx, cy, Math.max(W, H) * 1.3 * k, P.white, k); glow(cx, cy, Math.max(W, H) * .5 * k, P.yellow, k * .8); }); if (k < .9) { g.save(); g.translate(cx, cy); for (let i = 0; i < 24; i++) { g.rotate(TAU / 24); g.fillStyle = rgba(P.white, k * .5); g.beginPath(); g.moveTo(0, -3); g.lineTo(Math.max(W, H) * k * 1.4, 0); g.lineTo(0, 3); g.fill(); } g.restore(); } }
  });

  /* The morning after. */
  defineSet("morningCity", { sunrise: .5 }, (p, b) => {
    sky(P.sky, P.pink, P.amber, .7);
    sun(W * .75, H * .5 - p.sunrise * H * .15, Math.min(W, H) * .09, { rays: 14 });
    cloud(W * .2, H * .2, 1.2, P.white, .9); cloud(W * .55, H * .28, .9, P.white, .85);
    hills(H * .5, 30, .005, mix(P.violet, P.pink, .5), 4);
    for (let i = 0; i < 22; i++) { const x = i * W * .048, h = 40 + noise(i * 3.9) * H * .25, w = W * .04; roundRect(x, H * .64 - h, w, h, 3, mix(P.violet, P.indigo, .5)); for (let wy = H * .64 - h + 10; wy < H * .64 - 8; wy += 14) fillCircle(x + w / 2, wy, 2, P.yellow, noise(i + wy) < .3 ? .8 : .1); }
    rect(0, H * .64, W, H * .36, mix(P.violet, P.dark, .5));
    person(W * .42, H * STAGE, 1.8, { color: P.rose, hair: P.rock, closed: 1, look: 0 }); person(W * .52, H * STAGE, 1.7, { color: P.teal, hair: P.grey, closed: 1 });
    for (let i = 0; i < 2; i++) text("~", W * (.42 + i * .1), H * STAGE - 62 + Math.sin(T * 2 + i) * 3, 14, P.dark, { alpha: .6 });
    vignette(.25);
  });

  /* ------------------------------------------------------------------ beats
   * `at` is a phrase from the story (or [phrase, nthOccurrence], or a word index).
   * Numeric parameters may be functions of (phase, ageSeconds) for motion inside a beat.
   */
  const INSUFFICIENT = "THERE IS AS YET INSUFFICIENT DATA FOR A MEANINGFUL ANSWER.";
  const BEATS = [
    /* I · 2061 */
    { at: 0, set: "earthDawn", label: "EARTH · MAY 21, 2061", sunrise: (ph) => .2 + ph * .6, lights: .4 },
    { at: "Alexander Adell and Bertram Lupov", set: "multivacHall", label: "MULTIVAC · MILES OF FACE", activity: .85 },
    { at: "Multivac was self-adjusting", set: "multivacHall", label: "SELF-ADJUSTING · SELF-CORRECTING", activity: .95, circuit: 1 },
    { at: "For decades, Multivac had helped design the ships", set: "earthDawn", label: "MOON · MARS · VENUS", sunrise: .7, rockets: 1, planets: 1, lights: .5 },
    { at: "Earth exploited its coal and uranium", set: "solarLand", label: "COAL AND URANIUM", smoke: 1, station: 0, beam: 0, lit: .3, day: .15 },
    { at: "But slowly Multivac learned enough", set: "multivacHall", label: "THEORY BECOMES FACT", activity: 1, circuit: .7 },
    { at: "The energy of the sun was stored", set: "solarLand", label: "THE SOLAR STATION", smoke: (ph) => 1 - smooth(ph * 1.5), station: 1, beam: 1, lit: 1, day: .35 },
    { at: "circling the Earth at half the distance", set: "earthDawn", label: "INVISIBLE BEAMS OF SUNPOWER", sunrise: .6, station: 1, lights: .9 },
    { at: "Seven days had not sufficed", set: "cavern", label: "UNDERGROUND · MULTIVAC'S BURIED BODY", drink: 0, bottle: 0, lamp: .8, vision: "multivac" },
    { at: "They had brought a bottle with them", set: "cavern", label: "A BOTTLE, TWO GLASSES", drink: 1, bottle: 1, vision: "" },
    { at: "It's amazing when you think of it", set: "cavern", label: "ADELL", vision: "" },
    { at: "Enough energy, if we wanted to draw on it, to melt all Earth", set: "earthDawn", label: "ALL EARTH INTO LIQUID IRON", sunrise: .75, station: 1, molten: (ph) => smooth(ph * 1.4), zoom: .8 },
    { at: "Lupov cocked his head sideways", set: "cavern", label: "LUPOV · CONTRARY", vision: "" },
    { at: "Till the sun runs down", set: "sunLife", label: "TILL THE SUN RUNS DOWN", age: (ph) => ph * .55 },
    { at: "Billions and billions of years", set: "sunLife", label: "TEN BILLION YEARS", age: (ph) => .55 + ph * .35 },
    { at: "Lupov put his fingers through his thinning hair", set: "cavern", label: "TEN BILLION YEARS IS NOT FOREVER", vision: "sunDim" },
    { at: "it will last our time", set: "cavern", label: "IT WILL LAST OUR TIME", vision: "sun" },
    { at: "hook up each individual spaceship to the Solar Station", set: "earthDawn", label: "TO PLUTO AND BACK A MILLION TIMES", sunrise: .5, station: 1, pluto: 1, zoom: .62, lights: .8 },
    { at: "I don't have to ask Multivac", set: "cavern", label: "I KNOW THAT", vision: "" },
    { at: "Then stop running down what Multivac's done for us", set: "cavern", label: "BLAZING UP", vision: "multivac" },
    { at: "What I say is that a sun won't last forever", set: "cavern", label: "BUT THEN WHAT?", vision: "sunDim" },
    { at: "There was silence for a while", set: "cavern", label: "THEY RESTED", rest: 1, vision: "", lamp: .5 },
    { at: "Then Lupov's eyes snapped open", set: "cavern", label: "SWITCH TO ANOTHER SUN?", rest: 0, vision: "stars", lamp: 1 },
    { at: "You're like the guy in the story", set: "rainGrove", label: "THE GROVE OF TREES", rain: 1, running: 1, sheltered: 0 },
    { at: "when one tree got wet through", set: "rainGrove", label: "JUST GET UNDER ANOTHER ONE", rain: 1, running: 0, sheltered: 1, drip: 1 },
    { at: "When the sun is done, the other stars will be gone, too", set: "starsDying", label: "THE OTHER STARS WILL BE GONE, TOO", dead: (ph) => ph * .5 },
    { at: "It all had a beginning in the original cosmic explosion", set: "starsDying", label: "THE ORIGINAL COSMIC EXPLOSION", bang: (ph, age) => clamp(age * .3, 0, 1), dead: 0 },
    { at: "Some run down faster than others", set: "starsDying", label: "SOME RUN DOWN FASTER", bang: 1, dead: (ph) => ph * .6 },
    { at: "just give us a trillion years and everything will be dark", set: "starsDying", label: "A TRILLION YEARS · EVERYTHING DARK", bang: 1, dead: (ph) => .6 + ph * .4, haze: 1 },
    { at: "I know all about entropy", set: "cavern", label: "ENTROPY", vision: "entropy" },
    { at: "You said we had all the energy we needed, forever", set: "cavern", label: "YOU SAID 'FOREVER'", vision: "forever" },
    { at: "Maybe we can build things up again someday", set: "cavern", label: "BUILD THINGS UP AGAIN?", vision: "rebuild" },
    { at: "Five dollars says it can't be done", set: "cavern", label: "A FIVE-DOLLAR BET", vision: "" },
    { at: "Adell was just drunk enough to try", set: "multivacHall", label: "PHRASING THE QUESTION", console: 1, figures: 0, activity: .8 },
    { at: "restore the sun to its full youthfulness", set: "sunLife", label: "RESTORE THE SUN?", age: (ph) => .85 - smooth(ph) * .85, timeline: 1 },
    { at: "How can the net amount of entropy", set: "starsDying", label: "THE LAST QUESTION", bang: 1, dead: .35, haze: .5, caption: "HOW CAN THE NET AMOUNT OF ENTROPY OF THE UNIVERSE BE MASSIVELY DECREASED?" },
    { at: "Multivac fell dead and silent", set: "multivacHall", label: "DEAD AND SILENT", dead: (ph) => clamp(.3 + ph, 0, .9), activity: .1, figures: 1 },
    { at: "there was a sudden springing to life of the teletype", set: "multivacHall", label: "THE TELETYPE", dead: .35, activity: .6, teletype: 1, caption: "INSUFFICIENT DATA FOR MEANINGFUL ANSWER.", captionDelay: 3 },
    { at: "whispered Lupov. They left hurriedly", set: "cavern", label: "NO BET", leaving: (ph, age) => clamp(age * .3, 0, 1), drink: 0, bottle: 0, vision: "" },
    { at: "By next morning", set: "morningCity", label: "THE NEXT MORNING", sunrise: (ph) => ph },

    /* II · the ship */
    { at: "Jerrodd, Jerrodine, and Jerrodette", set: "shipCabin", label: "HYPERSPACE → X-23", view: (ph, age) => (age < 4 ? "hyper" : "star"), planetSize: .15, focus: "window" },
    { at: "said Jerrodd confidently", set: "shipCabin", label: "THAT'S X-23", view: "star", planetSize: .25, focus: "family" },
    { at: "The little Jerrodettes, both girls", set: "shipCabin", label: "THE FIRST HYPERSPACE PASSAGE", view: "hyper", focus: "kids" },
    { at: "Quiet, children", set: "shipCabin", label: "ARE YOU SURE, JERRODD?", view: "star", focus: "family" },
    { at: "glancing up at the bulge of featureless metal", set: "shipCabin", label: "THE MICROVAC", focus: "microvac", microvacGlow: .9, view: "star" },
    { at: "Jerrodd scarcely knew a thing about the thick rod of metal", set: "shipCabin", label: "MICROVAC PLOTS THE COURSE", focus: "microvac", microvacGlow: 1, view: "hyper" },
    { at: "Jerrodd and his family had only to wait", set: "shipCabin", label: "RESIDENCE QUARTERS", focus: "family", view: "star", microvacGlow: .4 },
    { at: "Jerrodine's eyes were moist", set: "shipCabin", label: "LEAVING EARTH", view: "earth", planetSize: .3, moist: 1, focus: "window" },
    { at: "There are over a million people on the planet already", set: "shipCabin", label: "A MILLION PEOPLE ON X-23", view: "planet", planetSize: .5, moist: .5 },
    { at: "our great-grandchildren will be looking for new worlds", set: "shipCabin", label: "X-23 WILL BE OVERCROWDED", view: "earth", earthCrowd: 1, planetSize: .7, moist: .3 },
    { at: "Our Microvac is the best Microvac in the world", set: "shipCabin", label: "THE BEST MICROVAC", focus: "microvac", view: "star", microvacGlow: 1, moist: 0 },
    { at: "In his father's youth, the only computers had been tremendous machines", set: "galaxyExpansion", label: "PLANETARY ACS", filled: .35, planetaryAC: 1, ships: 1 },
    { at: "Jerrodd felt uplifted", set: "galaxyExpansion", label: "MICROVAC VS MULTIVAC", compare: 1, planetaryAC: 0, filled: .4 },
    { at: "So many stars, so many planets", set: "shipCabin", label: "SO MANY STARS", view: "planets", focus: "window", moist: 0 },
    { at: "said Jerrodd, with a smile", set: "shipCabin", label: "EVEN THE STARS RUN DOWN", view: "starsOut", dead: (ph) => ph * .5, focus: "window" },
    { at: "What's entropy, daddy?", set: "shipCabin", label: "WHAT'S ENTROPY?", view: "stars", dead: .4, focus: "kids" },
    { at: "like your little walkie-talkie robot", set: "shipCabin", label: "RUNNING DOWN", robotPower: (ph) => 1 - ph, focus: "robot", view: "stars", dead: .4 },
    { at: "Can't you just put in a new power-unit", set: "shipCabin", label: "A NEW POWER-UNIT?", robotPower: .15, focus: "robot" },
    { at: "The stars are the power-units", set: "shipCabin", label: "THE STARS ARE THE POWER-UNITS", view: "stars", batteries: 1, focus: "window", robotPower: .1 },
    { at: "Jerrodette I at once set up a howl", set: "shipCabin", label: "DON'T LET THE STARS RUN DOWN", cry: 1, view: "starsOut", dead: .6, batteries: 0, focus: "kids" },
    { at: "wailed Jerrodette I", set: "shipCabin", label: "ASK THE MICROVAC", cry: 1, focus: "microvac", microvacGlow: 1 },
    { at: "He asked the Microvac, adding quickly", set: "shipCabin", label: "PRINT THE ANSWER", cry: .3, focus: "microvac", microvacGlow: 1, film: 1, filmText: "· · · · · · · · · · · ·" },
    { at: "Jerrodd cupped the strip", set: "shipCabin", label: "THE CELLUFILM", cry: 0, film: 1, filmText: "· · · · · · · · · · · ·", focus: "family" },
    { at: "it's time for bed", set: "shipCabin", label: "TIME FOR BED", cry: 0, film: 0, focus: "family", view: "star", planetSize: .5 },
    { at: "Jerrodd read the words on the cellufilm again", set: "shipCabin", label: "INSUFFICIENT DATA", film: 1, filmText: "INSUFICIENT DATA FOR MEANINGFUL ANSWER.", focus: "film" },
    { at: "X-23 was just ahead", set: "shipCabin", label: "X-23 JUST AHEAD", film: 0, view: "planet", planetSize: (ph) => .6 + ph * .4, focus: "window" },

    /* III · the Galactic AC */
    { at: "VJ-23X of Lameth stared", set: "councilRoom", label: "A MAP OF THE GALAXY", map: 1, mapFill: .75 },
    { at: "the Galaxy will be filled in five years", set: "galaxyExpansion", label: "FILLED IN FIVE YEARS", filled: (ph) => .75 + ph * .25, ships: 1 },
    { at: "Both seemed in their early twenties", set: "councilRoom", label: "TALL AND PERFECTLY FORMED", map: 1 },
    { at: "Space is infinite. A hundred billion Galaxies", set: "galaxyField", label: "A HUNDRED BILLION GALAXIES", zoom: (ph) => 1.25 - ph * .35 },
    { at: "Twenty thousand years ago", set: "galaxyExpansion", label: "TWENTY THOUSAND YEARS OF EXPANSION", filled: (ph) => ph, ships: 1 },
    { at: "We can thank immortality for that", set: "councilRoom", label: "IMMORTALITY", map: .6 },
    { at: "Two hundred twenty-three", set: "councilRoom", label: "TWO HUNDRED TWENTY-THREE YEARS OLD", map: .6 },
    { at: "Population doubles every ten years", set: "galaxyField", label: "ANOTHER GALAXY EVERY TEN YEARS", filled: (ph) => ph * .8, zoom: 1 },
    { at: "there's a problem of transportation", set: "galaxyField", label: "MOVING GALAXIES OF PEOPLE", filled: .5, ships: 1 },
    { at: "mankind consumes two sunpower units per year", set: "galaxyField", label: "TWO SUNPOWER UNITS A YEAR", sunUnits: 1, ships: 0, filled: .5 },
    { at: "even with a hundred per cent efficiency", set: "galaxyField", label: "A GEOMETRIC PROGRESSION", sunUnits: 1, filled: (ph) => .5 + ph * .5 },
    { at: "build new stars out of interstellar gas", set: "galaxyField", label: "NEW STARS FROM INTERSTELLAR GAS", sunUnits: 0, gasStar: (ph, age) => clamp(age * .12, 0, 1), filled: .6 },
    { at: "Or out of dissipated heat?", set: "galaxyField", label: "OR OUT OF DISSIPATED HEAT?", gasStar: 0, heat: 1 },
    { at: "pulled out his AC-contact", set: "councilRoom", label: "THE AC-CONTACT", cubeOn: 1, cubeGlow: .3, map: .3 },
    { at: "It was only two inches cubed", set: "councilRoom", label: "CONNECTED THROUGH HYPERSPACE", cubeOn: 1, cubeGlow: .8, threads: 1, map: 0 },
    { at: "It was on a little world of its own", set: "galacticAC", label: "THE GALACTIC AC" },
    { at: "Can entropy ever be reversed", set: "councilRoom", label: "CAN ENTROPY EVER BE REVERSED?", cubeOn: 1, cubeGlow: 1, threads: .5, map: 0 },
    { at: "You can't turn smoke and ash back into a tree", set: "treeAsh", label: "SMOKE AND ASH", burn: (ph, age) => clamp(age * .11, 0, 1) },
    { at: "Do you have trees on your world?", set: "treeAsh", label: "DO YOU HAVE TREES ON YOUR WORLD?", burn: 0 },
    { at: "The sound of the Galactic AC startled them", set: "councilRoom", label: "THIN AND BEAUTIFUL", cubeOn: 1, cubeGlow: 1, speaking: 1, map: 0, caption: "THERE IS INSUFFICIENT DATA FOR A MEANINGFUL ANSWER.", captionDelay: 4 },
    { at: "returned to the question of the report", set: "councilRoom", label: "THE REPORT", cubeOn: 1, cubeGlow: .2, speaking: 0, map: .8 },

    /* IV · Zee Prime */
    { at: "Zee Prime's mind spanned the new Galaxy", set: "mindGalaxy", label: "ZEE PRIME", wisps: 1, zoom: 0 },
    { at: "Minds, not bodies!", set: "podWorld", label: "MINDS, NOT BODIES", rise: 1 },
    { at: "the wispy tendrils of another mind", set: "mindGalaxy", label: "ANOTHER MIND", wisps: 2, zoom: 0 },
    { at: "On one particular Galaxy the race of man must have originated", set: "mindGalaxy", label: "WHERE DID MAN ORIGINATE?", wisps: 2, zoom: .3 },
    { at: "Zee Prime's perceptions broadened", set: "mindGalaxy", label: "THE GALAXIES THEMSELVES SHRANK", wisps: 2, zoom: (ph, age) => clamp(age * .12, 0, 1) },
    { at: "On which Galaxy did mankind originate?", set: "mindGalaxy", label: "CALLING THE UNIVERSAL AC", zoom: 1, wisps: 2 },
    { at: "The Universal AC heard", set: "universalAC", label: "RECEPTORS ON EVERY WORLD", receptors: 1, globe: .4 },
    { at: "he reported only a shining globe", set: "universalAC", label: "A SHINING GLOBE, DIFFICULT TO SEE", globe: 1, receptors: .2 },
    { at: "is in hyperspace. In what form", set: "universalAC", label: "MOST OF IT IS IN HYPERSPACE", globe: .5, receptors: 0 },
    { at: "Each Universal AC designed and constructed its successor", set: "universalAC", label: "EACH BUILT ITS SUCCESSOR", chain: 1, globe: .3 },
    { at: "guided into the dim sea of Galaxies", set: "mindGalaxy", label: "ONE GALAXY ENLARGED", zoom: 1, origin: (ph, age) => clamp(age * .2, 0, 1), wisps: 2 },
    { at: "THIS IS THE ORIGINAL GALAXY OF MAN", set: "mindGalaxy", label: "THE ORIGINAL GALAXY OF MAN", zoom: 1, origin: 1, wisps: 2, caption: "THIS IS THE ORIGINAL GALAXY OF MAN." },
    { at: "But it was the same after all", set: "mindGalaxy", label: "THE SAME AS ANY OTHER", zoom: 1, origin: 1, wisps: 2 },
    { at: "MAN'S ORIGINAL STAR HAS GONE NOVA", set: "mindGalaxy", label: "GONE NOVA", zoom: 1, origin: 1, wisps: 2, nova: (ph, age) => clamp(age * .18, 0, 1), caption: "MAN'S ORIGINAL STAR HAS GONE NOVA. IT IS A WHITE DWARF." },
    { at: "A NEW WORLD, AS IN SUCH CASES", set: "mindGalaxy", label: "A NEW WORLD FOR THEIR BODIES", zoom: 1, origin: 1, nova: 1, newWorld: (ph, age) => clamp(age * .3, 0, 1), caption: "A NEW WORLD WAS CONSTRUCTED FOR THEIR PHYSICAL BODIES IN TIME." },
    { at: "a sense of loss overwhelmed him", set: "mindGalaxy", label: "A SENSE OF LOSS", zoom: 1, origin: (ph, age) => clamp(1 - age * .15, 0, 1), nova: 1, newWorld: 0, wisps: 2 },
    { at: "The stars are dying. The original star is dead", set: "mindGalaxy", label: "THE STARS ARE DYING", zoom: 1, dead: (ph) => .3 + ph * .3, dim: .3, wisps: 2 },
    { at: "our bodies will finally die", set: "podWorld", label: "OUR BODIES WILL FINALLY DIE", dim: .6, rise: .3 },
    { at: "How may stars be kept from dying?", set: "universalAC", label: "HOW MAY STARS BE KEPT FROM DYING?", globe: 1, receptors: .6 },
    { at: "And the Universal AC answered", set: "universalAC", label: "INSUFFICIENT DATA", globe: 1, receptors: .2, caption: INSUFFICIENT, captionDelay: 1.5 },
    { at: "Zee Prime's thoughts fled back to his own Galaxy", set: "mindGalaxy", label: "BACK TO HIS OWN GALAXY", zoom: (ph, age) => clamp(1 - age * .15, 0, 1), wisps: 1, dead: .3 },
    { at: "began collecting interstellar hydrogen", set: "mindGalaxy", label: "A SMALL STAR OF HIS OWN", zoom: 0, wisps: 1, buildStar: (ph, age) => clamp(age * .12, 0, 1) },

    /* V · Man and the Cosmic AC */
    { at: "Man considered with himself", set: "podWorld", label: "MAN · A TRILLION TRILLION TRILLION BODIES", rise: .6, dim: .4, rows: 6 },
    { at: "The Universe is dying", set: "whiteDwarfSky", label: "THE UNIVERSE IS DYING", dim: .4 },
    { at: "Man looked about at the dimming Galaxies", set: "whiteDwarfSky", label: "WHITE DWARFS, FADING", dim: .6 },
    { at: "White dwarfs might yet be crashed together", set: "whiteDwarfSky", label: "CRASHING WHITE DWARFS TOGETHER", collide: (ph, age) => clamp(age * .1, 0, 1), dim: .5 },
    { at: "Carefully husbanded, as directed by the Cosmic AC", set: "whiteDwarfSky", label: "CAREFULLY HUSBANDED", meter: 1, dim: .6, collide: 0 },
    { at: "eventually it will all come to an end", set: "whiteDwarfSky", label: "IT WILL ALL COME TO AN END", meter: 1, dim: .85 },
    { at: "The Cosmic AC surrounded them but not in space", set: "cosmicAC", label: "THE COSMIC AC · NEITHER MATTER NOR ENERGY", organize: .4, chaos: .2, bright: 1 },
    { at: "how may entropy be reversed?", set: "cosmicAC", label: "HOW MAY ENTROPY BE REVERSED?", pulse: 1, organize: .45 },
    { at: ["The Cosmic AC said, \"THERE IS AS YET", 0], set: "cosmicAC", label: "INSUFFICIENT DATA", pulse: 1, caption: INSUFFICIENT },
    { at: "Collect additional data", set: "cosmicAC", label: "COLLECT ADDITIONAL DATA", organize: .5, pulse: .4 },
    { at: "I HAVE BEEN DOING SO FOR A HUNDRED BILLION YEARS", set: "cosmicAC", label: "A HUNDRED BILLION YEARS", organize: .6, pulse: 1, caption: "I HAVE BEEN DOING SO FOR A HUNDRED BILLION YEARS." },
    { at: "Will there come a time", set: "cosmicAC", label: "IS THE PROBLEM INSOLUBLE?", organize: .6, pulse: .3 },
    { at: "NO PROBLEM IS INSOLUBLE", set: "cosmicAC", label: "NO PROBLEM IS INSOLUBLE", organize: .7, pulse: 1, caption: "NO PROBLEM IS INSOLUBLE IN ALL CONCEIVABLE CIRCUMSTANCES." },
    { at: "When will you have enough data", set: "cosmicAC", label: "WHEN?", pulse: .3, organize: .7 },
    { at: ["The Cosmic AC said, \"THERE IS AS YET", 1], set: "cosmicAC", label: "INSUFFICIENT DATA", pulse: 1, caption: INSUFFICIENT },
    { at: "Will you keep working on it", set: "cosmicAC", label: "WILL YOU KEEP WORKING ON IT?", pulse: .3 },
    { at: "said, \"I WILL.\"", set: "cosmicAC", label: "I WILL", pulse: 1, caption: "I WILL." },
    { at: "We shall wait", set: "cosmicAC", label: "WE SHALL WAIT", pulse: 0, organize: .75, bright: .8 },

    /* VI · the last mind */
    { at: "The stars and Galaxies died and snuffed out", set: "starsDying", label: "TEN TRILLION YEARS OF RUNNING DOWN", bang: 1, dead: (ph, age) => clamp(.5 + age * .06, 0, 1), galaxies: 1, haze: .3 },
    { at: "One by one Man fused with AC", set: "lastStar", label: "MAN FUSED WITH AC", minds: 1, fuse: (ph, age) => clamp(age * .08, 0, .7), ember: .5 },
    { at: "Man's last mind paused before fusion", set: "lastStar", label: "THE DREGS OF ONE LAST DARK STAR", minds: .05, fuse: .45, ember: .35, matter: 1 },
    { at: "is this the end?", set: "lastStar", label: "IS THIS THE END?", minds: .05, fuse: .45, ember: .3 },
    { at: ["THERE IS AS YET INSUFFICIENT DATA FOR A MEANINGFUL ANSWER", 3], set: "lastStar", label: "INSUFFICIENT DATA", minds: .05, ember: .25, caption: INSUFFICIENT },
    { at: "Man's last mind fused and only AC existed", set: "lastStar", label: "ONLY AC EXISTED", minds: .05, fuse: (ph, age) => clamp(.45 + age * .15, 0, 1), ember: (ph, age) => clamp(.25 - age * .05, 0, 1), matter: (ph, age) => clamp(1 - age * .2, 0, 1) },

    /* VII · the answer */
    { at: "Matter and energy had ended", set: "cosmicAC", label: "OUTSIDE SPACE AND TIME", organize: .3, chaos: .4, bright: .5, tint: 0, pulse: 0 },
    { at: "All other questions had been answered", set: "cosmicAC", label: "ONE QUESTION REMAINED", organize: .4, bright: .5 },
    { at: "All collected data had come to a final end", set: "cosmicAC", label: "NOTHING LEFT TO COLLECT", organize: .5, bright: .55 },
    { at: "had yet to be completely correlated", set: "cosmicAC", label: "CORRELATING ALL POSSIBLE RELATIONSHIPS", organize: (ph, age) => clamp(.5 + age * .06, 0, .95), bright: .7 },
    { at: "A timeless interval was spent", set: "cosmicAC", label: "A TIMELESS INTERVAL", organize: .95, bright: .8 },
    { at: "AC learned how to reverse the direction of entropy", set: "cosmicAC", label: "ENTROPY REVERSED", organize: 1, bright: 1, spark: (ph, age) => clamp(age * .3, 0, .6), tint: 1 },
    { at: "there was now no man to whom AC might give the answer", set: "cosmicAC", label: "NO ONE LEFT TO TELL", organize: 1, spark: .2, tint: 1, bright: .9 },
    { at: "AC thought how best to do this", set: "cosmicAC", label: "ORGANIZING THE PROGRAM", organize: 1, spark: .3, tint: 1 },
    { at: "brooded over what was now Chaos", set: "cosmicAC", label: "STEP BY STEP", organize: (ph, age) => clamp(1 - age * .1, .4, 1), chaos: (ph, age) => clamp(age * .15, 0, 1), spark: .4, tint: 1 },
    { at: "LET THERE BE LIGHT", set: "genesis", label: "LET THERE BE LIGHT!", flash: (ph, age) => clamp(age * .9, 0, 1), born: 0, caption: "LET THERE BE LIGHT!", captionColor: P.dark, captionBg: P.white },
    { at: "And there was light", set: "genesis", label: "AND THERE WAS LIGHT", flash: (ph, age) => clamp(1 - age * .5, 0, 1), born: (ph, age) => clamp(age * .45, 0, 1) }
  ];

  /* ------------------------------------------------------------------ engine */
  let beats = [], words = [], current = -1, beatStart = 0;
  let live = {}, liveSet = "";
  let outgoing = null; // { set, params, start }
  const FADE = 1.3;

  function resolveBeats(indexOfPhrase, nthIndexOfPhrase) {
    beats = [];
    for (const beat of BEATS) {
      let start;
      if (typeof beat.at === "number") start = beat.at;
      else if (Array.isArray(beat.at)) start = nthIndexOfPhrase(beat.at[0], beat.at[1]);
      else start = indexOfPhrase(beat.at);
      if (start < 0) { console.warn("[visuals] beat anchor not found:", beat.at); continue; }
      beats.push({ ...beat, start });
    }
    beats.sort((a, b) => a.start - b.start);
    beats.forEach((b, i) => { b.end = beats[i + 1] ? beats[i + 1].start : words.length; });
  }

  function beatIndexAt(wordIndex) {
    let low = 0, high = beats.length - 1;
    while (low < high) { const mid = (low + high + 1) >> 1; if (beats[mid].start <= wordIndex) low = mid; else high = mid - 1; }
    return low;
  }

  function evaluate(beat, timing) {
    const target = { ...DEFAULTS[beat.set] };
    for (const key in beat) {
      if (["at", "set", "label", "start", "end", "caption", "captionColor", "captionBg", "captionDelay"].includes(key)) continue;
      const value = beat[key];
      target[key] = typeof value === "function" ? value(timing.phase, timing.age) : value;
    }
    return target;
  }

  function step(target, dt) {
    const rate = 1 - Math.exp(-dt * 2.4);
    for (const key in target) {
      const value = target[key];
      if (typeof value === "number") live[key] = typeof live[key] === "number" ? live[key] + (value - live[key]) * rate : value;
      else live[key] = value;
    }
  }

  function drawCaption(beat, timing) {
    if (!beat.caption) return;
    const delay = beat.captionDelay || 0;
    const progress = clamp((timing.age - delay) * 22 / beat.caption.length, 0, 1);
    if (progress <= 0) return;
    const size = clamp(W * .012, 11, 17), x = W * .5, y = H * .56;
    g.font = `500 ${size}px ${FONT}`; const wdt = g.measureText(beat.caption).width + size * 3;
    const bg = beat.captionBg || P.deep, fg = beat.captionColor || P.cream;
    roundRect(x - wdt / 2, y - size * 1.4, wdt, size * 2.8, size, bg, .78);
    caption(beat.caption, x, y, size, fg, progress, { glowColor: beat.captionBg ? null : P.cyan });
  }

  function renderSet(setName, params, timing) {
    const draw = SETS[setName];
    if (draw) draw(params, timing);
  }

  function init(canvas, storyWords, indexOfPhrase, nthIndexOfPhrase) {
    main = canvas.getContext("2d", { alpha: false });
    offCanvas = document.createElement("canvas"); offCtx = offCanvas.getContext("2d", { alpha: false });
    words = storyWords; resolveBeats(indexOfPhrase, nthIndexOfPhrase);
  }


  function resize(width, height, scale) {
    W = width; H = height;
    offCanvas.width = Math.round(W * scale); offCanvas.height = Math.round(H * scale);
    offCtx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  function frame({ t, dt, position, pointerX, pointerY }) {
    T = t; PX = pointerX; PY = pointerY; POS = position;
    const wi = clamp(Math.floor(position), 0, words.length - 1);
    const index = beatIndexAt(wi);
    if (index !== current) {
      const next = beats[index];
      if (current >= 0 && beats[current].set !== next.set) outgoing = { set: beats[current].set, params: { ...live }, start: t };
      if (current < 0 || beats[current].set !== next.set) { live = {}; liveSet = next.set; }
      current = index; beatStart = t;
      if (!Object.keys(live).length) live = evaluate(next, { phase: 0, age: 0 });
    }
    const beat = beats[current];
    const timing = { phase: clamp((position - beat.start) / Math.max(1, beat.end - beat.start), 0, 1), age: t - beatStart };
    step(evaluate(beat, timing), dt);

    const fade = outgoing ? smooth((t - outgoing.start) / FADE) : 1;
    if (outgoing && fade >= 1) outgoing = null;
    if (outgoing) {
      g = main; renderSet(outgoing.set, outgoing.params, { phase: 1, age: t - outgoing.start + 10 });
      g = offCtx; renderSet(beat.set, live, timing);
      g = main; main.save(); main.globalAlpha = fade; main.drawImage(offCanvas, 0, 0, offCanvas.width, offCanvas.height, 0, 0, W, H); main.restore();
    } else {
      g = main; renderSet(beat.set, live, timing);
    }
    g = main; drawCaption(beat, timing);
    return { label: beat.label || "", set: beat.set, index: current, count: beats.length };
  }

  window.LQ_VISUALS = { init, resize, frame, beats: () => beats };
})();
