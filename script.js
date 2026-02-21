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

    const rotateY = (px - 0.5) * 8; // left/right
    const rotateX = (0.5 - py) * 8; // up/down

    card.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`;
  });

  card.addEventListener('mouseleave', () => {
    card.style.transform = 'perspective(900px) rotateX(0deg) rotateY(0deg) translateY(0px)';
  });
});

// ===============================
// 3) Particle/grid background on canvas
// ===============================
const canvas = document.getElementById('bg-canvas');
const ctx = canvas.getContext('2d', { alpha: true });

let w = 0;
let h = 0;
let dpr = Math.min(window.devicePixelRatio || 1, 2);
let particles = [];
let mouse = { x: -9999, y: -9999 };

function resizeCanvas() {
  w = window.innerWidth;
  h = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const count = Math.max(40, Math.min(90, Math.floor((w * h) / 22000)));
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.35,
    r: Math.random() * 1.6 + 0.4
  }));
}

function drawGrid() {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  const step = 48;

  for (let x = 0; x < w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

function animate() {
  ctx.clearRect(0, 0, w, h);

  drawGrid();

  // gradient bloom near mouse
  const grad = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 180);
  grad.addColorStop(0, 'rgba(217,70,239,0.08)');
  grad.addColorStop(0.5, 'rgba(34,211,238,0.05)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // lines
  for (let i = 0; i < particles.length; i++) {
    const p1 = particles[i];

    p1.x += p1.vx;
    p1.y += p1.vy;

    if (p1.x < 0 || p1.x > w) p1.vx *= -1;
    if (p1.y < 0 || p1.y > h) p1.vy *= -1;

    for (let j = i + 1; j < particles.length; j++) {
      const p2 = particles[j];
      const dx = p1.x - p2.x;
      const dy = p1.y - p2.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 120) {
        const alpha = 1 - dist / 120;
        ctx.strokeStyle = `rgba(191, 239, 255, ${alpha * 0.08})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }
  }

  // particles
  for (const p of particles) {
    const dmx = p.x - mouse.x;
    const dmy = p.y - mouse.y;
    const md = Math.hypot(dmx, dmy);
    const glow = md < 120 ? (1 - md / 120) : 0;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r + glow * 1.4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(242,245,255,${0.35 + glow * 0.4})`;
    ctx.fill();
  }

  requestAnimationFrame(animate);
}

window.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

window.addEventListener('touchmove', (e) => {
  if (!e.touches[0]) return;
  mouse.x = e.touches[0].clientX;
  mouse.y = e.touches[0].clientY;
}, { passive: true });

window.addEventListener('mouseleave', () => {
  mouse.x = -9999;
  mouse.y = -9999;
});

window.addEventListener('resize', resizeCanvas);

resizeCanvas();
animate();