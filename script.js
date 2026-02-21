// ===============================
// 1) Reveal on scroll
// ===============================
const revealEls = document.querySelectorAll('.reveal');

const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('show');
        revealObserver.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.12 }
);

revealEls.forEach((el) => revealObserver.observe(el));

// ===============================
// 2) 3D tilt cards (desktop only)
// ===============================
const tiltCards = document.querySelectorAll('.tilt-card');

tiltCards.forEach((card) => {
  card.addEventListener('mousemove', (e) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const rect = card.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;

    const rotateY = (px - 0.5) * 8;
    const rotateX = (0.5 - py) * 8;

    card.style.transform =
      `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`;
  });

  card.addEventListener('mouseleave', () => {
    card.style.transform =
      'perspective(900px) rotateX(0deg) rotateY(0deg) translateY(0px)';
  });
});

// ===============================
// 3) Interactive dual-fluid background (2 immiscible liquids style)
//    No WebGL, pure Canvas2D
// ===============================
const canvas = document.getElementById('bg-canvas');
const ctx = canvas.getContext('2d', { alpha: true });

let w = 0;
let h = 0;
let dpr = Math.min(window.devicePixelRatio || 1, 2);

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Mouse / pointer
const pointer = {
  x: window.innerWidth * 0.5,
  y: window.innerHeight * 0.35,
  vx: 0,
  vy: 0,
  active: false,
  lastX: window.innerWidth * 0.5,
  lastY: window.innerHeight * 0.35,
};

// Two particle phases = two "liquids"
let phaseA = [];
let phaseB = [];

// Tweakable parameters
const config = {
  countA: 90,
  countB: 90,
  interactionRadius: 110,
  separationStrength: 0.024,   // how strongly A/B avoid mixing
  cohesionStrength: 0.0065,    // same-phase cohesion
  swirlStrength: 0.012,        // pointer swirl
  pointerPushStrength: 0.045,  // pointer impulse
  friction: 0.986,
  maxSpeed: 1.65,
  noiseDrift: 0.0035,
  edgeBounce: 0.9,
  metaballRadiusA: 62,
  metaballRadiusB: 62,
  gridStep: 7,                 // lower = smoother, heavier CPU
  isoThreshold: 1.0
};

// Lightweight pseudo-noise (no library)
function smoothNoise2D(x, y, t = 0) {
  return Math.sin(x * 0.013 + t * 0.7) * 0.5 +
         Math.cos(y * 0.011 - t * 0.5) * 0.35 +
         Math.sin((x + y) * 0.007 + t * 0.25) * 0.15;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function resizeCanvas() {
  w = window.innerWidth;
  h = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Adjust counts by screen area (safe for mobile)
  const scale = clamp((w * h) / (1440 * 900), 0.65, 1.35);
  const mobile = w < 700;
  config.countA = Math.round((mobile ? 55 : 90) * scale);
  config.countB = Math.round((mobile ? 55 : 90) * scale);
  config.gridStep = mobile ? 9 : 7;

  initPhases();
}

function makeParticle(phase, i, total) {
  // Initial clusters on opposite sides to emphasize "immiscible" look
  const leftSide = phase === 'A';
  const cx = leftSide ? w * 0.32 : w * 0.68;
  const cy = h * 0.42 + (phase === 'A' ? -25 : 25);

  const angle = (i / total) * Math.PI * 2 + Math.random() * 0.3;
  const rad = (Math.sqrt(Math.random()) * Math.min(w, h) * 0.28);

  return {
    x: cx + Math.cos(angle) * rad,
    y: cy + Math.sin(angle) * rad,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.35,
    phase,
    seed: Math.random() * 1000
  };
}

function initPhases() {
  phaseA = Array.from({ length: config.countA }, (_, i) => makeParticle('A', i, config.countA));
  phaseB = Array.from({ length: config.countB }, (_, i) => makeParticle('B', i, config.countB));
}

function applyPointer(eX, eY) {
  const newVx = eX - pointer.lastX;
  const newVy = eY - pointer.lastY;
  pointer.vx = newVx;
  pointer.vy = newVy;
  pointer.x = eX;
  pointer.y = eY;
  pointer.lastX = eX;
  pointer.lastY = eY;
  pointer.active = true;
}

window.addEventListener('mousemove', (e) => applyPointer(e.clientX, e.clientY));
window.addEventListener('touchmove', (e) => {
  if (!e.touches[0]) return;
  applyPointer(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });

window.addEventListener('mouseleave', () => {
  pointer.active = false;
});

window.addEventListener('touchend', () => {
  pointer.active = false;
});

window.addEventListener('resize', resizeCanvas);

// Pairwise fluid-ish behavior (same-phase cohesion, cross-phase repulsion)
function stepParticles(allA, allB, t) {
  const all = [...allA, ...allB];

  // O(n^2) is okay here with ~110-180 particles total; tuned for Pages/mobile
  for (let i = 0; i < all.length; i++) {
    const p = all[i];

    for (let j = i + 1; j < all.length; j++) {
      const q = all[j];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const distSq = dx * dx + dy * dy;
      const r = config.interactionRadius;

      if (distSq > r * r || distSq < 0.0001) continue;

      const dist = Math.sqrt(distSq);
      const nx = dx / dist;
      const ny = dy / dist;

      const proximity = 1 - dist / r;

      if (p.phase === q.phase) {
        // Same liquid wants to stay coherent
        const f = proximity * config.cohesionStrength;
        p.vx += nx * f;
        p.vy += ny * f;
        q.vx -= nx * f;
        q.vy -= ny * f;
      } else {
        // Different liquids repel (immiscible)
        const f = proximity * config.separationStrength;
        p.vx -= nx * f;
        p.vy -= ny * f;
        q.vx += nx * f;
        q.vy += ny * f;
      }
    }

    // Gentle flow field (to keep motion organic)
    const n = smoothNoise2D(p.x + p.seed * 2.3, p.y - p.seed, t);
    const angle = n * Math.PI * 2.0;
    p.vx += Math.cos(angle) * config.noiseDrift;
    p.vy += Math.sin(angle) * config.noiseDrift;

    // Pointer interaction: push + swirl
    if (pointer.active && !prefersReducedMotion) {
      const dx = p.x - pointer.x;
      const dy = p.y - pointer.y;
      const d2 = dx * dx + dy * dy;
      const r = 180;

      if (d2 < r * r && d2 > 0.001) {
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const falloff = (1 - d / r);

        // Direct push away from pointer
        const push = falloff * config.pointerPushStrength * (1 + Math.min(12, Math.hypot(pointer.vx, pointer.vy)) * 0.12);
        p.vx += nx * push;
        p.vy += ny * push;

        // Swirl around pointer (different direction for each phase => nice interface motion)
        const swirlDir = p.phase === 'A' ? 1 : -1;
        const tangentialX = -ny * swirlDir;
        const tangentialY = nx * swirlDir;
        const swirl = falloff * config.swirlStrength * (1 + Math.min(10, Math.hypot(pointer.vx, pointer.vy)) * 0.08);
        p.vx += tangentialX * swirl;
        p.vy += tangentialY * swirl;
      }
    }

    // Friction / speed cap
    p.vx *= config.friction;
    p.vy *= config.friction;

    const speed = Math.hypot(p.vx, p.vy);
    if (speed > config.maxSpeed) {
      p.vx = (p.vx / speed) * config.maxSpeed;
      p.vy = (p.vy / speed) * config.maxSpeed;
    }

    p.x += p.vx;
    p.y += p.vy;

    // Soft bounds
    const margin = 24;
    if (p.x < margin) {
      p.x = margin;
      p.vx = Math.abs(p.vx) * config.edgeBounce;
    } else if (p.x > w - margin) {
      p.x = w - margin;
      p.vx = -Math.abs(p.vx) * config.edgeBounce;
    }

    if (p.y < margin) {
      p.y = margin;
      p.vy = Math.abs(p.vy) * config.edgeBounce;
    } else if (p.y > h - margin) {
      p.y = h - margin;
      p.vy = -Math.abs(p.vy) * config.edgeBounce;
    }
  }

  // pointer velocity decay
  pointer.vx *= 0.85;
  pointer.vy *= 0.85;
}

// Metaball-like scalar field evaluation for each phase
function fieldValue(x, y, particles, radius) {
  let v = 0;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const dx = x - p.x;
    const dy = y - p.y;
    const d2 = dx * dx + dy * dy + 0.0001;
    v += (radius * radius) / d2;
  }
  return v * 0.012; // normalize-ish
}

// Marching squares helper to draw contour line
function interp(a, b, va, vb, threshold) {
  const t = (threshold - va) / ((vb - va) || 1e-6);
  return a + (b - a) * t;
}

function drawMetafluid(particles, {
  radius,
  fillInner,     // rgba
  fillOuter,     // rgba
  edgeColor      // rgba
}) {
  const step = config.gridStep;
  const threshold = config.isoThreshold;

  // 1) Soft fill by sampling grid cells (cheap and pretty)
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const cx = x + step * 0.5;
      const cy = y + step * 0.5;
      const v = fieldValue(cx, cy, particles, radius);

      if (v > threshold * 0.55) {
        const intensity = clamp((v - threshold * 0.55) / (threshold * 1.25), 0, 1);

        // Two-layer color feel (core + halo)
        // halo first
        ctx.fillStyle = fillOuter.replace('{a}', (0.04 + intensity * 0.10).toFixed(3));
        ctx.fillRect(x, y, step + 0.5, step + 0.5);

        // inner denser zone
        if (v > threshold) {
          const innerI = clamp((v - threshold) / (threshold * 1.15), 0, 1);
          ctx.fillStyle = fillInner.replace('{a}', (0.06 + innerI * 0.18).toFixed(3));
          ctx.fillRect(x, y, step + 0.5, step + 0.5);
        }
      }
    }
  }

  // 2) Contour line (marching squares) for "interface" look
  ctx.beginPath();

  for (let y = 0; y < h - step; y += step) {
    for (let x = 0; x < w - step; x += step) {
      const x0 = x, x1 = x + step;
      const y0 = y, y1 = y + step;

      const v0 = fieldValue(x0, y0, particles, radius); // top-left
      const v1 = fieldValue(x1, y0, particles, radius); // top-right
      const v2 = fieldValue(x1, y1, particles, radius); // bottom-right
      const v3 = fieldValue(x0, y1, particles, radius); // bottom-left

      const s0 = v0 >= threshold ? 1 : 0;
      const s1 = v1 >= threshold ? 1 : 0;
      const s2 = v2 >= threshold ? 1 : 0;
      const s3 = v3 >= threshold ? 1 : 0;

      const mask = (s0 << 3) | (s1 << 2) | (s2 << 1) | s3;
      if (mask === 0 || mask === 15) continue;

      const topX = interp(x0, x1, v0, v1, threshold);
      const rightY = interp(y0, y1, v1, v2, threshold);
      const bottomX = interp(x0, x1, v3, v2, threshold);
      const leftY = interp(y0, y1, v0, v3, threshold);

      // draw segments for cases (compressed handling)
      const segments = [];
      switch (mask) {
        case 1: case 14: segments.push([[x0, leftY], [bottomX, y1]]); break;
        case 2: case 13: segments.push([[bottomX, y1], [x1, rightY]]); break;
        case 3: case 12: segments.push([[x0, leftY], [x1, rightY]]); break;
        case 4: case 11: segments.push([[topX, y0], [x1, rightY]]); break;
        case 5:
          segments.push([[topX, y0], [x0, leftY]]);
          segments.push([[bottomX, y1], [x1, rightY]]);
          break;
        case 6: case 9: segments.push([[topX, y0], [bottomX, y1]]); break;
        case 7: case 8: segments.push([[topX, y0], [x0, leftY]]); break;
        case 10:
          segments.push([[topX, y0], [x1, rightY]]);
          segments.push([[x0, leftY], [bottomX, y1]]);
          break;
      }

      for (const seg of segments) {
        ctx.moveTo(seg[0][0], seg[0][1]);
        ctx.lineTo(seg[1][0], seg[1][1]);
      }
    }
  }

  ctx.strokeStyle = edgeColor;
  ctx.lineWidth = 1.15;
  ctx.stroke();
}

function drawBackgroundBase(t) {
  // faint grid + slow shimmer
  ctx.save();

  const gridStep = 46;
  const shimmer = 0.02 + 0.01 * Math.sin(t * 0.7);

  ctx.strokeStyle = `rgba(255,255,255,${shimmer})`;
  ctx.lineWidth = 1;

  for (let x = 0; x < w; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
  }

  // pointer bloom
  if (pointer.active && !prefersReducedMotion) {
    const g = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 220);
    g.addColorStop(0, 'rgba(255,255,255,0.03)');
    g.addColorStop(0.35, 'rgba(217,70,239,0.05)');
    g.addColorStop(0.65, 'rgba(34,211,238,0.04)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  ctx.restore();
}

function drawPhaseParticlesHints(list, color) {
  // Tiny spark points for texture (subtle)
  ctx.save();
  ctx.fillStyle = color;
  for (const p of list) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

let lastTime = performance.now();

function animate(now) {
  const t = now * 0.001;
  const dt = Math.min(32, now - lastTime);
  lastTime = now;

  ctx.clearRect(0, 0, w, h);

  if (!prefersReducedMotion) {
    stepParticles(phaseA, phaseB, t);
  }

  drawBackgroundBase(t);

  // Draw two "immiscible liquids"
  // Order matters for overlap aesthetics
  drawMetafluid(phaseA, {
    radius: config.metaballRadiusA,
    fillInner: 'rgba(217,70,239,{a})',   // pink/violet core
    fillOuter: 'rgba(168,85,247,{a})',   // violet halo
    edgeColor: 'rgba(238,188,255,0.22)'
  });

  drawMetafluid(phaseB, {
    radius: config.metaballRadiusB,
    fillInner: 'rgba(34,211,238,{a})',   // cyan core
    fillOuter: 'rgba(59,130,246,{a})',   // blue halo
    edgeColor: 'rgba(191,239,255,0.22)'
  });

  // Interface highlight where liquids feel close (subtle)
  if (pointer.active && !prefersReducedMotion) {
    ctx.save();
    const g = ctx.createRadialGradient(pointer.x, pointer.y, 10, pointer.x, pointer.y, 140);
    g.addColorStop(0, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.02)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 140, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawPhaseParticlesHints(phaseA, 'rgba(255,220,255,0.10)');
  drawPhaseParticlesHints(phaseB, 'rgba(220,250,255,0.10)');

  requestAnimationFrame(animate);
}

resizeCanvas();
requestAnimationFrame(animate);