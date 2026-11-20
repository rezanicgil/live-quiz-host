// Sahne parçacıkları: konfeti, kalpler, yıldız parıltıları. Tek bir 1080×1920 tuval; yalnız parçacık varken çizer.
//   createFx(canvas) → { confetti(x,y,n,opts), rain(ms,opts), hearts(n,x,y), sparkle(x,y,n,color), ring(x,y,color), clear(), count }
// Sahne `ask` evresindeyken tuvali CSS ile y>1020 bölgesine kırpar; burada ayrıca sınır yoktur.

const COLORS = ['#FFD34D', '#FF5C8A', '#2ED3B7', '#FFF3DA', '#8E7BFF', '#FFFFFF'];
const MAX = 520;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[(Math.random() * list.length) | 0];

export function createFx(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const parts = [], rains = [];
  let raf = 0, last = 0, dirty = false;

  function add(p) { if (parts.length >= MAX) parts.shift(); parts.push(p); wake(); }
  function wake() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); } }

  function heartPath(s) {
    ctx.beginPath(); ctx.moveTo(0, s * 0.45);
    ctx.bezierCurveTo(-s * 1.1, -s * 0.25, -s * 0.55, -s * 1.05, 0, -s * 0.45);
    ctx.bezierCurveTo(s * 0.55, -s * 1.05, s * 1.1, -s * 0.25, 0, s * 0.45); ctx.closePath();
  }
  function starPath(s) {
    ctx.beginPath(); ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s * 0.16, -s * 0.16, s, 0); ctx.quadraticCurveTo(s * 0.16, s * 0.16, 0, s);
    ctx.quadraticCurveTo(-s * 0.16, s * 0.16, -s, 0); ctx.quadraticCurveTo(-s * 0.16, -s * 0.16, 0, -s); ctx.closePath();
  }

  function loop(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (let i = rains.length - 1; i >= 0; i--) {
      const r = rains[i]; r.left -= dt; r.acc += dt * r.rate;
      while (r.acc >= 1) { r.acc -= 1; piece(rnd(r.x0, r.x1), r.y - 20, rnd(-60, 60), rnd(120, 320), r.colors); }
      if (r.left <= 0) rains.splice(i, 1);
    }
    if (dirty) ctx.clearRect(0, 0, W, H);
    dirty = parts.length > 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt;
      if (p.t >= p.ttl || p.y > H + 60 || p.y < -200) { parts.splice(i, 1); continue; }
      p.vx *= 1 - p.drag * dt; p.vy = p.vy * (1 - p.drag * dt) + p.g * dt;
      p.x += (p.vx + Math.sin(p.t * p.swf + p.ph) * p.sw) * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const k = p.t / p.ttl, fade = k < p.fin ? k / p.fin : k > p.fout ? Math.max(0, (1 - k) / (1 - p.fout)) : 1;
      ctx.globalAlpha = fade * p.alpha;
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        const c = Math.cos(p.rot), s = Math.sin(p.rot), flip = Math.cos(p.t * p.fl + p.ph);
        ctx.setTransform(c, s, -s * flip, c * flip, p.x, p.y);
        ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
      } else {
        const sc = p.shape === 'ring' ? 1 : (p.grow ? 0.5 + Math.min(1, k * 4) * 0.5 : 1);
        const c = Math.cos(p.rot) * sc, s = Math.sin(p.rot) * sc;
        ctx.setTransform(c, s, -s, c, p.x, p.y);
        if (p.shape === 'heart') { heartPath(p.size); ctx.fill(); }
        else if (p.shape === 'star') { starPath(p.size * (1 - k * 0.5)); ctx.fill(); }
        else if (p.shape === 'ring') { ctx.strokeStyle = p.color; ctx.lineWidth = p.size * (1 - k); ctx.beginPath(); ctx.arc(0, 0, 20 + k * p.reach, 0, 6.2832); ctx.stroke(); }
        else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, 6.2832); ctx.fill(); }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    if (parts.length || rains.length) raf = requestAnimationFrame(loop);
    else if (dirty) { ctx.clearRect(0, 0, W, H); dirty = false; }
  }

  function base(x, y, o) {
    return Object.assign({ x, y, vx: 0, vy: 0, g: 0, drag: 0, rot: rnd(0, 6.28), vr: 0, size: 14, color: '#fff', shape: 'dot', t: 0, ttl: 2,
      sw: 0, swf: 3, ph: rnd(0, 6.28), fl: 8, fin: 0.01, fout: 0.75, alpha: 1, grow: false, reach: 0 }, o);
  }
  function piece(x, y, vx, vy, colors = COLORS) {
    add(base(x, y, { vx, vy, g: 720, drag: 1.25, vr: rnd(-7, 7), size: rnd(13, 24), color: pick(colors), shape: Math.random() < 0.82 ? 'rect' : 'dot',
      ttl: rnd(2.2, 3.6), sw: rnd(20, 70), swf: rnd(2, 5), fl: rnd(5, 12), fout: 0.8 }));
  }

  return {
    get count() { return parts.length; },
    /** Bir noktadan patlayan konfeti. opts: { spread (rad), angle (rad, yukarı = -PI/2), power, colors } */
    confetti(x, y, n = 70, opts = {}) {
      const { spread = Math.PI * 0.9, angle = -Math.PI / 2, power = 900, colors = COLORS } = opts;
      for (let i = 0; i < n; i++) {
        const a = angle + rnd(-spread / 2, spread / 2), v = power * rnd(0.35, 1);
        piece(x + rnd(-12, 12), y + rnd(-8, 8), Math.cos(a) * v, Math.sin(a) * v, colors);
      }
    },
    /** Belirli bir süre boyunca yukarıdan yağan konfeti. opts: { y, x0, x1, rate, colors } */
    rain(ms = 2500, opts = {}) {
      rains.push({ left: ms / 1000, acc: 0, rate: opts.rate || 60, y: opts.y ?? 0, x0: opts.x0 ?? 0, x1: opts.x1 ?? W, colors: opts.colors || COLORS }); wake();
    },
    /** Yukarı süzülen kalpler (beğeni). */
    hearts(n = 6, x = 940, y = 1780, spread = 70) {
      for (let i = 0; i < n; i++) {
        add(base(x + rnd(-spread, spread), y + rnd(-20, 30), { vx: rnd(-25, 25), vy: rnd(-330, -190), g: -30, drag: 0.35, rot: rnd(-0.3, 0.3), vr: rnd(-0.5, 0.5),
          size: rnd(15, 30), color: pick(['#FF5C8A', '#FF86A6', '#FFD34D', '#FF5C8A']), shape: 'heart', ttl: rnd(1.5, 2.3), sw: rnd(30, 80), swf: rnd(2, 4), fin: 0.12, fout: 0.6, grow: true }));
      }
    },
    /** Dört köşeli yıldız parıltıları. */
    sparkle(x, y, n = 12, color = '#FFD34D', power = 320) {
      for (let i = 0; i < n; i++) {
        const a = rnd(0, 6.28), v = power * rnd(0.3, 1);
        add(base(x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 120, drag: 2.4, vr: rnd(-3, 3), size: rnd(9, 20), color: Math.random() < 0.3 ? '#fff' : color,
          shape: 'star', ttl: rnd(0.6, 1.1), fout: 0.4 }));
      }
    },
    /** Genişleyen halka (vurgu). */
    ring(x, y, color = '#FFD34D', reach = 150) {
      add(base(x, y, { shape: 'ring', color, size: 16, ttl: 0.55, reach, rot: 0, fout: 0.3 }));
    },
    clear() { parts.length = 0; rains.length = 0; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); dirty = false; },
  };
}
