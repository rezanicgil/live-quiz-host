// Bil Bakalım sahnesi: WebSocket iletilerini (hello / state / fx / say) dinler ve çizer. Sahne yalnız dinler, hiçbir şey göndermez.
// ?mock=1 ile sunucusuz çalışır: /mock.js aynı iletileri aynı `deliver` yolundan verir.
// Yerleşim kuralı: soru alanını (y 220–1015) kürsü, mola ve açılış dışında hiçbir kutlama kapatamaz; sunucu bölgesinde okunacak
// her şey sağ sütundadır (x 700–1040, y < 1780): yayın uygulamasının sohbeti ve alt çubuğu oraya gelmez.
import { createHost } from './host.js';
import { createSound } from './sound.js';
import { createFx } from './fx.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const MOCK = params.get('mock') === '1';
const TR = 'tr-TR';
const up = (s) => String(s ?? '').toLocaleUpperCase(TR);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const PHASES = ['lobby', 'intro', 'ask', 'solved', 'timeout', 'podium', 'break', 'ended'];
const FULL_OK = ['lobby', 'podium', 'break'];   // kutlamanın ekranı kaplayabildiği evreler; bunlarda soru (q) yoktur
const CATS = {
  uzay: ['🪐', 'UZAY', '#ADB4FF'], icat: ['💡', 'İCATLAR', '#FFD779'], sanat: ['🎨', 'SANAT', '#FEB0BC'], dil: ['💬', 'SÖZ OYUNLARI', '#A1EACC'],
  memleket: ['🗺️', 'MEMLEKET', '#2ED3B7'], yemek: ['🍲', 'YEMEK', '#FFA24D'], futbol: ['⚽', 'FUTBOL', '#6FDB7F'],
  'dizi-film': ['🎬', 'DİZİ-FİLM', '#FF8FB0'], doga: ['🌿', 'DOĞA', '#8FE07A'], tarih: ['🏛️', 'TARİH', '#F5C76B'],
  gunluk: ['☀️', 'GÜNLÜK', '#FFD34D'], muzik: ['🎵', 'MÜZİK', '#BFA6FF'], genel: ['⭐', 'GENEL', '#7CCBFF'],
};
const TYPES = { kelime: 'Kelime bulmaca', plaka: 'Plaka sorusu', atasozu: 'Sözü tamamla', karisik: 'Karışık harfler', emoji: 'Emoji bulmaca' };
const MOOD = { lobby: 'happy', intro: 'neutral', ask: 'neutral', solved: 'happy', timeout: 'sad', podium: 'excited', break: 'happy' };
const LIVE_SHOWN = ['connecting', 'waiting', 'warning', 'ended'];   // bağlantı çipinin sunucudan gelen `detail` yazısını gösterdiği kaynak durumları
const AVA = ['#FF5C8A', '#22B8A0', '#8E7BFF', '#FF8A3D', '#22A8E0', '#E05CC8', '#4FBF63', '#E0A012'];
const RING = 314.16;

const stage = $('stage'), viewport = $('viewport'), tilesEl = $('tiles'), strip = $('strip'), guessesEl = $('guesses'), laneEl = $('lane');
const chipsEl = $('chips'), bubble = $('bubble'), ring = $('ring'), ticker = $('ticker'), capBox = $('cap-box');
const sound = createSound();
const fx = createFx($('fx'));     // oyunun kendi kutlamaları (bilen, cevap, kürsü)
const fxh = createFx($('fxh'));   // izleyici kutlamaları: kürsü, mola ve açılış dışında yalnız sunucu bölgesinde görünür
const host = createHost($('host'));

/** Sahnenin belleği: son durum iletisi ve ondan türeyen çizim durumu. */
const S = {
  st: null, phase: 'boot', build: null, demo: false, title: 'Bil Bakalım', socketUp: MOCK,
  qKey: '', q: null, tiles: [], tileMode: '', revealed: false, introSig: '', introFxAt: 0,
  win: null, lastSec: null, drumStop: null, look: null,
  leadSig: null, podiumSig: null, chatSig: '', chat: null, hlSig: '',
};

/* ---------- küçük yardımcılar ---------- */
function h(tag, cls, text) { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined && text !== null) el.textContent = text; return el; }
function restart(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function hash(s) { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x; }
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('tr', { granularity: 'grapheme' }) : null;
const graphemes = (s) => (seg ? [...seg.segment(s)].map((x) => x.segment) : Array.from(s));
const nickOf = (user) => String(user?.nick || 'Misafir');
function avatar(user) {
  const el = h('span', 'ava'), nick = nickOf(user);
  el.style.setProperty('--c', AVA[hash(String(user?.id ?? nick)) % AVA.length]);
  el.textContent = up(graphemes(nick.replace(/^[^\p{L}\p{N}]+/u, ''))[0] || '?');
  return el;
}
/** Tek satırlık metni kutusuna sığana dek küçültür. */
function fitLine(el, max, min) { let s = max; el.style.fontSize = s + 'px'; while (s > min && el.scrollWidth > el.clientWidth + 1) { s -= 1; el.style.fontSize = s + 'px'; } }
/** Çocukların yerini değiştiren bir işlemi yumuşatır (FLIP); sahne ölçekli olduğu için offset* kullanılır. */
function flip(container, mutate) {
  const before = new Map([...container.children].map((k) => [k, [k.offsetLeft, k.offsetTop]]));
  mutate();
  for (const k of container.children) {
    const b = before.get(k); if (!b || k.hidden) continue;
    const dx = b[0] - k.offsetLeft, dy = b[1] - k.offsetTop;
    if (dx || dy) k.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 340, easing: 'cubic-bezier(.2,.8,.3,1)' });
  }
}
function stageBox(el) { let x = 0, y = 0, n = el; while (n && n !== stage) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; } return { x, y, w: el.offsetWidth, h: el.offsetHeight }; }
const qTimers = new Set();
function qLater(fn, ms) { const t = setTimeout(() => { qTimers.delete(t); fn(); }, ms); qTimers.add(t); return t; }
function cancelQ() { for (const t of qTimers) clearTimeout(t); qTimers.clear(); }

/* ---------- ölçek ---------- */
const fit = () => { stage.style.transform = `scale(${viewport.clientWidth / 1080})`; };
new ResizeObserver(fit).observe(viewport); fit();

/* ---------- zemin süsleri ---------- */
(function motes() {
  const box = $('motes'), shapes = ['?', '★', '✦', '+', '●', '?', '✦', '★', '?', '+', '●', '✦'];
  shapes.forEach((ch, i) => {
    const el = h('span', 'mote', ch), dur = 16 + (i * 7) % 13;
    el.style.cssText = `left:${40 + ((i * 197) % 1000)}px;font-size:${34 + (i * 23) % 50}px;animation-duration:${dur}s;animation-delay:${-((i * 5.3) % dur)}s;--o:${0.07 + (i % 4) * 0.025};--r:${i % 2 ? 200 : -160}deg`;
    box.appendChild(el);
  });
})();

/* ---------- sunucu karakter: ruh hâli, konuşma, balon ---------- */
let nextListenerGesture = 0;
let speaking = false, baseMood = 'neutral', moodTimer = 0, sayToken = 0, bubbleTimer = 0, typeRaf = 0, lookTimer = 0;
let speakingKind = null;
function mood(emotion, ms = 2400, gesture = null) {
  if (speaking) { if (gesture === 'clap' || gesture === 'listen') host.gesture(gesture); return; }
  host.setEmotion(emotion); if (gesture) host.gesture(gesture);
  clearTimeout(moodTimer); moodTimer = setTimeout(() => { moodTimer = 0; if (!speaking) host.setEmotion(baseMood); }, ms);
}
function glance(x, ms = 1300) { host.lookAt(x); clearTimeout(lookTimer); lookTimer = setTimeout(() => host.lookAt(null), ms); }
/** Balon: yazı 4 satıra (140 karaktere) kadar kırpılmadan sığar; uzadıkça punto küçülür, balon yukarı doğru büyür. */
function showBubble(text, ms) {
  clearTimeout(bubbleTimer); cancelAnimationFrame(typeRaf);
  const el = $('bubble-text'); el.textContent = '';
  const spans = graphemes(String(text || '')).map((ch) => { const sp = h('span', '', ch); el.appendChild(sp); return sp; });
  if (!spans.length) { bubble.classList.remove('on'); return; }
  let size = 44; el.style.fontSize = size + 'px';
  while (size > 22 && el.scrollHeight > 138) { size -= 1; el.style.fontSize = size + 'px'; }
  bubble.classList.add('on');
  const dur = clamp((Number(ms) || 2000) * 0.5, 240, 1500), t0 = performance.now(); let shown = 0;
  const step = (now) => {
    const n = Math.min(spans.length, Math.ceil(((now - t0) / dur) * spans.length));
    while (shown < n) spans[shown++].classList.add('on');
    if (shown < spans.length) typeRaf = requestAnimationFrame(step);
  };
  typeRaf = requestAnimationFrame(step);
}
function onSay(m) {
  const token = ++sayToken;
  speakingKind = m.kind;
  const handle = sound.say({ url: m.url || null, ms: m.ms, text: m.speech || m.text, voiceEnabled: m.voiceEnabled !== false, allowSystemVoice: m.allowSystemVoice === true });
  speaking = true; clearTimeout(moodTimer); moodTimer = 0;
  host.setEmotion(m.emotion || 'neutral'); if (m.gesture) host.gesture(m.gesture);
  host.talk(handle.level); host.lookAt(null);
  showBubble(m.text, m.ms);
  handle.done.then(() => {
    if (token !== sayToken) return;
    speaking = false; speakingKind = null; host.talk(null);
    bubbleTimer = setTimeout(() => bubble.classList.remove('on'), 700);
    moodTimer = setTimeout(() => { moodTimer = 0; if (!speaking) host.setEmotion(baseMood); }, 1000);
  });
}

/* ---------- üst satır ---------- */
function setTitle(title) {
  S.title = String(title || 'Bil Bakalım');
  const words = up(S.title).split(/\s+/).filter(Boolean);
  for (const box of [$('logo'), document.querySelector('.curtain-logo'), $('desk-logo')]) {
    box.querySelector('b').textContent = words[0] || ''; box.querySelector('i').textContent = words.slice(1).join(' ');
  }
  document.title = S.title + ' · yayın sahnesi';
}
function setRound(s) {
  const el = $('round'); let sig;
  if (s.phase === 'lobby') sig = 'Birazdan başlıyor';
  else if (s.phase === 'podium') sig = `Tur ${s.round} tamamlandı`;
  else if (s.phase === 'break') sig = 'Sohbet molası';
  else sig = `Tur |${s.round}| · Soru |${s.index}|/${s.total}`;
  if (s.paused) sig = '⏸ ' + sig;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig; el.textContent = '';
  sig.split('|').forEach((part, i) => el.appendChild(i % 2 ? h('b', '', part) : document.createTextNode(part)));
}

/* ---------- soru kartı ---------- */
const qKeyOf = (s) => (s.q ? [s.round, s.index, s.q.type, s.q.category, s.q.clue, (s.q.tiles || []).length].join('|') : '');
function showIntro(info, animate) {
  const c = CATS[info.category] || CATS.genel;
  $('intro-emoji').textContent = c[0]; $('intro-cat').textContent = c[1];
  $('intro-no').textContent = info.index && info.total ? `SORU ${info.index}/${info.total}` : 'SIRADAKİ SORU';
  $('intro-type').textContent = TYPES[info.type] || '';
  $('card').style.setProperty('--cat', c[2]);
  $('double').hidden = !info.double;
  if (animate) { restart($('v-intro'), 'go'); if (info.double) restart($('double'), 'stamp'); }
}
function renderBody(q) {
  const c = CATS[q.category] || CATS.genel;
  $('cat-emoji').textContent = c[0]; $('cat-name').textContent = c[1]; $('card').style.setProperty('--cat', c[2]);
  const plate = $('plate'), emoji = $('emoji'), scramble = $('scramble'), clue = $('clue'), hint = $('hint');
  plate.hidden = !q.plate;
  if (q.plate) {
    const no = $('plate-no'); no.textContent = String(q.plate);
    for (const cls of ['', '', 'sp', '', '', '']) no.appendChild(h('i', cls));
  }
  emoji.hidden = !q.emoji; emoji.textContent = '';
  if (q.emoji) for (const g of graphemes(String(q.emoji))) if (g.trim()) emoji.appendChild(h('span', '', g));
  scramble.hidden = !(q.scramble && q.scramble.length); scramble.textContent = '';
  if (q.scramble) for (const ch of q.scramble) { const el = h('span', 'sc', up(ch)); el.dataset.ch = up(ch); scramble.appendChild(el); }
  const visual = !!(q.emoji || (q.scramble && q.scramble.length));
  const line = q.emoji ? (q.clue || q.hint || '') : visual ? (q.hint || q.clue || '') : (q.clue || '');
  clue.textContent = '';
  if (visual) { clue.hidden = false; clue.textContent = line; hint.hidden = true; }
  else {
    clue.hidden = false; hint.hidden = !q.hint; hint.textContent = q.hint || '';
    String(line).split(/(_{2,})/).forEach((part) => clue.appendChild(/^_{2,}$/.test(part) ? h('span', 'gap') : document.createTextNode(part)));
  }
  clue.dataset.max = visual ? 36 : q.plate ? 42 : 58;
  fitClue();
}
/** İpucunu kartın soru bölgesine sığdırır; kazanan / süre doldu şeridi varken bölge küçülür. */
function fitClue() {
  const clue = $('clue'), body = $('qbody');
  if (clue.hidden || !S.q) return;
  const compact = S.phase === 'solved' || S.phase === 'timeout';
  let size = Math.round((Number(clue.dataset.max) || 58) * (compact ? 0.76 : 1));
  clue.style.fontSize = size + 'px';
  while (size > 22 && body.scrollHeight > body.clientHeight + 1) { size -= 2; clue.style.fontSize = size + 'px'; }
}
function setQuestion(s, key) {
  S.qKey = key; S.q = s.q || null; S.revealed = false; stage.classList.remove('revealed'); cancelQ();
  S.win = null; renderWin(); clearGuesses(); stopLast();
  if (!S.q) { refreshDeco(true); return; }
  renderBody(S.q);
  buildTiles(S.q.tiles || [], s.phase === 'intro', false);
  S.tileMode = 'q';
}
/** Sunucunun sohbete sorduğu soru (state.chat): açılışta ve molada kartın tamamında, büyük; talimat "Cevabını yorumlara yaz" olur. */
function setChat(s) {
  const chat = (s.phase === 'lobby' || s.phase === 'break') && s.chat ? String(s.chat).trim() : '';
  const sig = chat ? s.phase + '|' + chat : '';
  if (sig === S.chatSig) return;
  const fresh = chat && chat !== S.chat; S.chatSig = sig; S.chat = chat || null;
  stage.classList.toggle('chatting', !!chat);
  if (!chat) return;
  $('chat-kick').textContent = s.phase === 'break' ? '☕ SOHBET MOLASI' : '🎉 YARIŞMA BİRAZDAN BAŞLIYOR';
  const box = $('chat-q'), line = h('span', '', '💬 ' + chat); box.textContent = ''; box.appendChild(line);
  let size = 74; box.style.fontSize = size + 'px';
  while (size > 30 && (line.offsetHeight > box.clientHeight || line.offsetWidth > box.clientWidth)) { size -= 2; box.style.fontSize = size + 'px'; }
  if (fresh) sound.play('chip');
}

/* ---------- harf kutuları ---------- */
function layoutTiles(list) {
  const W = 984, H = 180, G = 0.1, SP = 0.45, words = []; let cur = [];
  list.forEach((t, i) => { if (t.space) { if (cur.length) words.push(cur); cur = []; } else cur.push(i); });
  if (cur.length) words.push(cur);
  const units = (ws) => ws.reduce((a, w) => a + w.length + G * (w.length - 1), 0) + SP * Math.max(0, ws.length - 1);
  let rows = [words], size = Math.min(128, W / Math.max(1, units(words)));
  if (words.length > 1 && size < 80) {
    let best = null;
    for (let k = 1; k < words.length; k++) { const a = words.slice(0, k), b = words.slice(k), m = Math.max(units(a), units(b)); if (!best || m < best.m) best = { m, rows: [a, b] }; }
    const two = Math.min(84, W / best.m);
    if (two > size) { rows = best.rows; size = two; }
  }
  size = Math.floor(size);
  const gapY = 12, y0 = (H - rows.length * size - (rows.length - 1) * gapY) / 2, pos = {};
  rows.forEach((ws, r) => {
    let x = (W - units(ws) * size) / 2;
    ws.forEach((w, wi) => { if (wi) x += SP * size; w.forEach((i, li) => { if (li) x += G * size; pos[i] = { x: Math.round(x), y: Math.round(y0 + r * (size + gapY)) }; x += size; }); });
  });
  return { size, pos };
}
function buildTiles(list, drop, deco) {
  tilesEl.textContent = ''; S.tiles = [];
  const L = layoutTiles(list); let n = 0;
  list.forEach((t, i) => {
    if (t.space) { S.tiles.push({ space: true }); return; }
    const p = L.pos[i], el = h('div', 'tile' + (drop ? ' drop' : '') + (deco ? ' deco' : ''));
    el.style.cssText = `left:${p.x}px;top:${p.y}px;width:${L.size}px;height:${L.size}px;font-size:${Math.round(L.size * 0.62)}px;--i:${n}`;
    const inner = h('div', 'tile-in'), back = h('div', 'face back'), front = h('div', 'face front'), letter = h('span');
    front.appendChild(letter); inner.append(back, front); el.appendChild(inner); tilesEl.appendChild(el);
    const rec = { el, letter, space: false, open: false, pending: false, ch: null };
    if (t.ch) { rec.open = true; rec.ch = up(t.ch); letter.textContent = rec.ch; if (!deco) el.classList.add('open'); }
    S.tiles.push(rec); n++;
  });
  if (drop) for (let k = 0; k < Math.min(4, n); k++) qLater(() => sound.play('drop'), 260 + k * 120);
}
/** Soru yokken (açılış, mola) kutu bölgesi boş kalmaz: açılışta şovun adı, molanın tamamında MOLA harfleri dalgalanır. */
function refreshDeco(force) {
  if (S.q) return;
  const mode = S.phase === 'lobby' ? 'lobby' : S.phase === 'break' ? 'break' : 'none';
  if (!force && S.tileMode === mode) return;
  S.tileMode = mode;
  if (mode === 'none') { tilesEl.textContent = ''; S.tiles = []; return; }
  let word = mode === 'break' ? 'MOLA' : up(S.title);
  if (graphemes(word.replace(/\s/g, '')).length > 14) word = 'BİL BAKALIM';
  buildTiles(graphemes(word).map((ch) => (ch.trim() ? { ch, space: false } : { ch: null, space: true })), false, true);
}
function takeScramble(ch) {
  const el = [...$('scramble').children].find((x) => x.dataset.ch === ch && !x.classList.contains('used'));
  if (el) el.classList.add('used');
  return el || null;
}
function flyLetter(from, rec, done) {
  const a = stageBox(from), b = stageBox(rec.el);
  if (!a.w || !b.w) { done(); return; }
  const el = h('div', 'fly', rec.ch);
  el.style.cssText = `left:${a.x}px;top:${a.y}px;width:${a.w}px;height:${a.h}px;font-size:${Math.round(a.w * 0.6)}px`;
  stage.appendChild(el);
  const dx = b.x + b.w / 2 - (a.x + a.w / 2), dy = b.y + b.h / 2 - (a.y + a.h / 2), sc = b.w / a.w;
  const anim = el.animate([
    { transform: 'translate(0,0) scale(1) rotate(0deg)' },
    { transform: `translate(${dx * 0.5}px,${dy * 0.5 - 60}px) scale(${(1 + sc) / 2 + 0.25}) rotate(180deg)`, offset: 0.5 },
    { transform: `translate(${dx}px,${dy}px) scale(${sc}) rotate(360deg)` },
  ], { duration: 520, easing: 'cubic-bezier(.4,0,.3,1)', fill: 'forwards' });
  let fired = false; const end = () => { if (fired) return; fired = true; el.remove(); done(); };
  anim.onfinish = end; setTimeout(end, 700);
}
function openTile(i, ch, silent) {
  const rec = S.tiles[i];
  if (!rec || rec.space || rec.open || !ch) return false;
  rec.open = true; rec.pending = false; rec.ch = up(ch); rec.letter.textContent = rec.ch;
  const go = () => { rec.el.classList.add('open'); if (!silent) sound.play('flip'); };
  const loose = S.q && S.q.scramble && S.tileMode === 'q' ? takeScramble(rec.ch) : null;
  if (loose) flyLetter(loose, rec, go); else go();
  return true;
}
function paint(gold) {
  let n = 0;
  for (const rec of S.tiles) { if (rec.space) continue; const el = rec.el, d = n++ * 60 + 420; qLater(() => el.classList.add(gold ? 'gold' : 'dull'), d); }
}
/** Cevap göründü: bütün kutular açılır; gold ise altın parlar (yalnız `answer`), değilse soluk kalır (`timeout`). */
function revealAll(answer, gold) {
  if (S.revealed || S.tileMode !== 'q') return false;
  S.revealed = true; stage.classList.add('revealed'); stopLast();
  const letters = answer ? graphemes(up(answer)).filter((ch) => ch.trim()) : null;
  const slots = S.tiles.filter((t) => !t.space);
  const usable = letters && letters.length === slots.length;
  let order = 0;
  slots.forEach((rec, k) => {
    const ch = usable ? letters[k] : rec.ch;
    if (rec.open || !ch) return;
    rec.pending = true; const i = S.tiles.indexOf(rec), n = order++;
    qLater(() => openTile(i, ch, n % 2 === 1), n * 80);
  });
  paint(gold);
  return true;
}
function syncTiles(s) {
  if (S.tileMode !== 'q') return;
  const list = s.q.tiles || []; let closed = 0;
  list.forEach((t, i) => {
    const rec = S.tiles[i]; if (!rec || rec.space) return;
    if (t.ch) { if (!rec.open && !rec.pending) openTile(i, t.ch, true); } else closed++;
  });
  if (!closed && !S.revealed && (s.phase === 'solved' || s.phase === 'timeout')) { S.revealed = true; stage.classList.add('revealed'); stopLast(); paint(s.phase === 'solved'); }
}

/* ---------- süre halkası ---------- */
function drawRing(left, total, mode) {
  const frac = total > 0 ? clamp(left / total) : 0;
  $('ring-fg').style.strokeDashoffset = String((1 - frac) * RING);
  $('ring-num').textContent = String(Math.max(0, Math.ceil(left - 0.05)));
  ring.classList.toggle('hot', mode === 'ask' && left <= 5.5);
  ring.classList.toggle('warm', mode === 'ask' && left <= 10.5 && left > 5.5);
}
function stopDrum() { if (S.drumStop) { S.drumStop(); S.drumStop = null; } }
function stopLast() { $('last-num').textContent = ''; }
function syncTimer(s) {
  const left = Number(s.timeLeft) || 0, total = Number(s.timeTotal) || 0;
  if (s.phase === 'ask') {
    drawRing(left, total, 'ask');
    const sec = Math.ceil(left);
    if (!s.paused && sec !== S.lastSec) { S.lastSec = sec; if (sec <= 10 && sec > 5) sound.play('tick'); }
    if (!s.paused && left <= 5.3 && left > 0.8 && !S.drumStop) { S.drumStop = sound.play('drum', { dur: left }) || (() => {}); mood('think', left * 1000, 'drum'); }
    if (s.paused) stopDrum();
  } else if (s.phase === 'solved') {
    if (!S.revealed) $('last-num').textContent = String(s.graceLeft ?? Math.ceil(clamp(left - (total - 5), 0, 5)));
  } else if (s.phase === 'lobby' || s.phase === 'break') drawRing(left, total, 'idle');
}

/* ---------- kazanan şeridi ---------- */
function renderWin() {
  const w = S.win; if (!w) return;
  const ava = $('win-ava'), fresh = avatar(w.user); fresh.id = 'win-ava'; ava.replaceWith(fresh);
  const name = $('win-name'); name.textContent = nickOf(w.user);
  const pts = $('win-points'); pts.textContent = '+' + w.points; pts.appendChild(h('small', '', 'PUAN'));
  const tags = $('win-tags'); tags.textContent = '';
  if (w.streak >= 3) tags.appendChild(h('span', 'tag', `🔥 ${w.streak} SERİ`));
  if (w.double) tags.appendChild(h('span', 'tag t-double', 'ÇİFTE PUAN'));
  if (w.fast && !tags.children.length) tags.appendChild(h('span', 'tag t-fast', '⚡ ŞİMŞEK'));
  fitLine(name, 72, 36);
  renderAlso();
}
function renderAlso() {
  const w = S.win, box = $('win-also'); if (!w) return;
  const sig = [...w.also.entries()].map(([r, a]) => r + ':' + a.user?.id + ':' + a.points + ':' + (a.behind ?? '')).join(',') + '|' + w.others;
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig; box.textContent = '';
  for (const rank of [2, 3]) {
    const a = w.also.get(rank); if (!a) continue;
    const el = h('span', 'also'); el.append(h('span', '', rank === 2 ? '🥈' : '🥉'), h('span', 'nm', nickOf(a.user)), h('b', '', '+' + a.points));
    // İlk bilenden ne kadar sonra yazdığı: sıralamanın neye göre olduğu görünsün ("ben önce yazdım" tartışması bitsin).
    if (Number.isFinite(a.behind)) el.append(h('i', 'gap', (a.behind / 1000).toFixed(1).replace('.', ',') + ' sn sonra'));
    box.appendChild(el);
  }
  if (w.others > 0) box.appendChild(h('span', 'also more', `+${w.others} kişi daha bildi`));
  // Satır sığmazsa süre yazıları önce kısalır ("+0,5 sn"), yine sığmazsa kalkar: kart hiçbir zaman taşmaz.
  const over = () => box.scrollWidth > box.clientWidth + 1;
  if (over()) for (const g of box.querySelectorAll('.gap')) g.textContent = '+' + g.textContent.replace(' sn sonra', ' sn');
  if (over()) for (const g of box.querySelectorAll('.gap')) g.remove();
}
function setWinner(user, points, extra = {}) {
  S.win = { user, points: Number(points) || 0, streak: Number(extra.streak) || 0, double: !!extra.double, fast: !!extra.fast, also: new Map(), others: 0 };
  $('win-also').dataset.sig = ''; renderWin();
}
/** state.winners / answer.winners: kazanan kartını (yeniden bağlanınca da) eksiksiz kurar. */
function mergeWinners(list) {
  if (!Array.isArray(list) || !list.length) return;
  const first = list.find((x) => x.rank === 1) || list[0];
  if (!S.win || String(S.win.user?.id) !== String(first.user?.id)) setWinner(first.user, first.points, { double: S.st?.double });
  for (const x of list) if (x.rank === 2 || x.rank === 3) S.win.also.set(x.rank, { user: x.user, points: x.points, behind: x.behind ?? S.win.also.get(x.rank)?.behind });
  S.win.others = Math.max(S.win.others, list.filter((x) => x.rank > 3).length);
  renderAlso();
}

/* ---------- tahmin şeridi + bilgi şeridi ---------- */
function clearGuesses() { guessesEl.textContent = ''; strip.classList.add('empty'); }
function addGuess(f) {
  const verdict = f.verdict === 'near' ? 'near' : f.verdict === 'late' ? 'late' : 'wrong';
  if (verdict === 'near' && S.phase === 'solved') return;   // soru çözüldükten sonra "çok yakın" gösterilmez (cevabı ele verir)
  const el = h('div', 'guess ' + verdict);
  el.append(avatar(f.user), h('span', 'nm', nickOf(f.user)), h('span', 'tx', String(f.text || '').slice(0, 40)));
  el.appendChild(verdict === 'near' ? h('span', 'v', 'çok yakın!') : verdict === 'late' ? h('span', 'v', 'geç kaldı') : h('span', 'x', '✗'));
  strip.classList.remove('empty');
  flip(guessesEl, () => { guessesEl.appendChild(el); while (guessesEl.children.length > 3) guessesEl.firstChild.remove(); fitGuesses(); });
  sound.play(verdict === 'near' ? 'near' : 'pop');
  if (performance.now() >= nextListenerGesture && verdict !== 'late') {
    nextListenerGesture = performance.now() + (verdict === 'near' ? 2200 : 3500);
    mood(verdict === 'near' ? 'think' : 'happy', 1550, verdict === 'near' ? 'listen' : 'nod');
  }
}
/** İlk doğru geldiği an "çok yakın" çipleri kalkar: tolerans penceresinde cevabı ele vermesinler. */
function dropNear() {
  const near = [...guessesEl.querySelectorAll('.guess.near')]; if (!near.length) return;
  flip(guessesEl, () => { for (const el of near) el.remove(); fitGuesses(); });
  if (!guessesEl.children.length) strip.classList.add('empty');
}
/** Üç çip yan yana sığar ve olağan bir tahmin kesilmez: önce adlar kısalır, sonra yazı küçülür, yine sığmazsa en eski çip gizlenir. */
function fitGuesses() {
  const all = [...guessesEl.children], W = guessesEl.clientWidth;
  for (const k of all) { k.hidden = false; k.querySelector('.tx').style.maxWidth = ''; }
  for (let skip = 0; skip < all.length; skip++) {
    const kids = all.slice(skip); if (skip) all[skip - 1].hidden = true;
    const over = () => kids.reduce((a, k) => a + k.offsetWidth, 0) + 10 * (kids.length - 1) - W;
    for (const size of [25, 22, 20]) {
      guessesEl.style.fontSize = size + 'px';
      for (const k of kids) k.querySelector('.nm').style.maxWidth = '';
      for (let guard = 0, extra = over(); extra > 0 && guard < 30; guard++, extra = over()) {
        let widest = null, w = 0;
        for (const k of kids) { const nm = k.querySelector('.nm'); if (nm.offsetWidth > w) { w = nm.offsetWidth; widest = nm; } }
        if (!widest || w <= 56) break;
        widest.style.maxWidth = Math.max(56, w - Math.min(extra, 30)) + 'px';
      }
      if (over() <= 0) return;
    }
    if (kids.length === 1) { const tx = kids[0].querySelector('.tx'); tx.style.maxWidth = Math.max(90, tx.offsetWidth - over()) + 'px'; }
  }
}
/* Bilgi şeridi: tahmin çiplerinin yerinde sırayla dönen kısa bildirimler (unvan, rekor, bilgi). Unvan ve rekor bilgiden önce gelir.
   Soru açılınca şerit boşalır: unvan ve rekor sağ alttaki çiplere, süresi dolmamış bilgi sağ sütundaki nota taşınır (süresini tamamlar). */
const laneQ = []; let laneNow = null, laneTimer = 0;
function chipToast(item) {
  notify({ kind: 'info', pri: 3, ms: 4200, build: () => chipEl(item.icon, item.chip[0], item.chip[1], '#FFD34D') });
}
function factNote(item, ms) {
  const el = h('div', 'cap'), msg = h('span', 'msg', item.parts.map((p) => (Array.isArray(p) ? p[0] : p)).join(''));
  el.append(h('span', 'ico', item.icon), msg);
  showCap(el, clamp(ms, 1800, 6000), () => { let size = 23; msg.style.fontSize = size + 'px'; while (size > 18 && msg.scrollHeight > 110) { size -= 1; msg.style.fontSize = size + 'px'; } });
}
function toast(kind, icon, parts, ms = 3200, chip = null) {
  const item = { kind, icon, parts, ms, chip, pri: kind === 'fact' ? 0 : 1 };
  // `ask` evresinde soru alanı (tahmin şeridi dahil) kapatılamaz: bildirim sağ sütuna düşer.
  if (S.phase === 'ask') { if (item.pri) chipToast(item); else factNote(item, ms); return; }
  const at = laneQ.findIndex((x) => x.pri < item.pri);
  if (at >= 0) laneQ.splice(at, 0, item); else laneQ.push(item);
  if (laneNow && !laneNow.leaving && laneNow.item.pri) {   // sırada bekleyen varken ekrandaki en az 1,7 sn görünür, sonra yer açar (bilgi kesilmez)
    const left = Math.max(0, 1700 - (performance.now() - laneNow.at));
    if (left < laneNow.until - performance.now()) { clearTimeout(laneTimer); laneNow.until = performance.now() + left; laneTimer = setTimeout(endToast, left); }
  }
  pumpLane();
}
function endToast() {
  const now = laneNow; if (!now || now.leaving) return;
  now.leaving = true; now.el.classList.add('bye');
  laneTimer = setTimeout(() => { now.el.remove(); if (laneNow === now) laneNow = null; if (!laneQ.length) strip.classList.remove('lane-on'); pumpLane(); }, 260);
}
function pumpLane() {
  if (laneNow || !laneQ.length) return;
  const item = laneQ.shift(), el = h('div', 'toast ' + item.kind), msg = h('span', 'msg');
  for (const p of item.parts) msg.appendChild(Array.isArray(p) ? h('b', '', p[0]) : document.createTextNode(p));
  el.append(h('span', 'ico', item.icon), msg); laneEl.appendChild(el); strip.classList.add('lane-on');
  let size = 29; while (size > 20 && msg.scrollHeight > 70) { size -= 1; el.style.fontSize = size + 'px'; }
  laneNow = { el, item, at: performance.now(), until: performance.now() + item.ms, leaving: false };
  laneTimer = setTimeout(endToast, item.ms);
}
function clearLane() {
  clearTimeout(laneTimer);
  if (laneNow) {
    const left = laneNow.until - performance.now();
    if (!laneNow.item.pri) { if (!laneNow.leaving && left > 400) factNote(laneNow.item, left + 600); }
    else if (performance.now() - laneNow.at < 1200) chipToast(laneNow.item);
    laneNow.el.remove(); laneNow = null;
  }
  for (const item of laneQ.splice(0)) { if (item.pri) chipToast(item); else factNote(item, item.ms); }
  strip.classList.remove('lane-on');
}

/* ---------- sağ sütun: bildirim çipleri (katılma, takip, paylaşım, unvan, rekor) ---------- */
// Öncelik sırasıyla çıkar: unvan / rekor 3 · takip / paylaşım 2 · katılma 1. Katılmalar beklerken tek çipte toplanır
// ("+12 kişi katıldı") ve aynı anda en çok bir yer tutar; üst öncelikli bildirim hiçbir zaman katılma çipi yüzünden düşmez.
const CHIP_SLOTS = 2, chipQ = []; let chipsShown = 0, chipSeq = 0, joinsShown = 0;
function chipEl(lead, name, text, color, end) {
  const el = h('div', 'chip'), tw = h('div', 'tw'); el.style.setProperty('--c', color);
  tw.append(h('span', 'nm', name), h('span', 'tx', text));
  el.append(typeof lead === 'string' ? h('span', 'ico', lead) : lead, tw); if (end) el.appendChild(h('span', 'end', end));
  return el;
}
function notify(item) {
  item.seq = ++chipSeq; item.ms = item.ms || 4200;
  if (item.kind === 'join' || ((item.kind === 'follow' || item.kind === 'share') && chipQ.length >= 6)) {
    const waiting = chipQ.find((c) => c.kind === item.kind);
    if (waiting) { waiting.count = (waiting.count || 1) + 1; return; }
  }
  chipQ.push(item); chipQ.sort((a, b) => b.pri - a.pri || a.seq - b.seq); pumpChips();
}
function pumpChips() {
  for (;;) {
    const i = chipQ.findIndex((c) => c.kind !== 'join' || joinsShown === 0);
    if (i < 0 || chipsShown >= CHIP_SLOTS) return;
    const [item] = chipQ.splice(i, 1), el = item.build(item.count || 1), ms = chipQ.length > 6 ? 2200 : chipQ.length > 2 ? 3000 : item.ms;
    chipsShown += 1; if (item.kind === 'join') joinsShown += 1;
    flip(chipsEl, () => chipsEl.appendChild(el));
    for (const [sel, max, min] of [['.nm', 23, 18], ['.tx', 20, 16]]) for (const part of el.querySelectorAll(sel)) fitLine(part, max, min);
    setTimeout(() => {
      el.classList.add('bye');
      setTimeout(() => { flip(chipsEl, () => el.remove()); chipsShown -= 1; if (item.kind === 'join') joinsShown -= 1; pumpChips(); }, 290);
    }, ms);
  }
}
function socialChip(kind, pri, user, icon, text, color, many, thanks) {
  notify({ kind, pri, build: (n) => (n > 1 ? chipEl(icon, many(n), thanks, color) : chipEl(avatar(user), nickOf(user), text, color, icon)) });
  sound.play('chip');
}

/* ---------- sağ sütun: öne çıkanlar şeridi; bilgi notu geçici olarak üstüne gelir ---------- */
let hlCards = [], hlAt = -1;
function drawHl(animate) {
  const c = hlCards[hlAt], el = $('hl'); if (!c) return;
  const b = el.querySelector('.b');
  el.dataset.kind = c[0]; el.querySelector('.ico').textContent = c[1]; el.querySelector('.a').textContent = c[2]; b.textContent = c[3];
  fitLine(b, 28, 20); if (animate) restart(el, 'swap');
}
/** state.highlights → kartlar; boş olan atlanır, `active` 2'den azsa gösterilmez. */
function setHighlights(hl) {
  const list = [];
  if (hl) {
    if (Number(hl.active) >= 2) list.push(['active', '🔥', 'Şu an', `${Number(hl.active)} kişi yarışıyor`]);
    if (hl.fast?.nick) list.push(['fast', '⚡', 'En hızlı', String(hl.fast.nick)]);
    if (hl.streak?.nick && Number(hl.streak.n) > 0) list.push(['streak', '🔥', 'Seri', `${hl.streak.nick} ×${Number(hl.streak.n)}`]);
    if (Number(hl.firstTimers) > 0) list.push(['first', '🎉', `Bu turda ${Number(hl.firstTimers)} kişi`, 'ilk doğrusunu yaptı']);
  }
  const sig = JSON.stringify(list); if (sig === S.hlSig) return;
  const current = hlCards[hlAt]?.[0]; S.hlSig = sig; hlCards = list;
  ticker.classList.toggle('has-hl', list.length > 0);
  if (!list.length) { hlAt = -1; return; }
  const same = list.findIndex((c) => c[0] === current);
  if (same >= 0) { hlAt = same; drawHl(false); } else { hlAt = 0; drawHl(true); }
}
setInterval(() => { if (hlCards.length > 1 && !capNow) { hlAt = (hlAt + 1) % hlCards.length; drawHl(true); } }, 5000);
const capQ = []; let capNow = null;
function showCap(el, ms, fitText) { capQ.push({ el, ms, fitText }); pumpCap(); }
function pumpCap() {
  if (capNow || !capQ.length) return;
  const item = capNow = capQ.shift(); capBox.appendChild(item.el); ticker.classList.add('busy'); item.fitText?.();
  setTimeout(() => {
    item.el.classList.add('bye');
    setTimeout(() => { item.el.remove(); capNow = null; if (!capQ.length) ticker.classList.remove('busy'); pumpCap(); }, 280);
  }, item.ms);
}

/* ---------- tur sıralaması ---------- */
const rows = new Map(), ROW = 52;
function setLeaders(list) {
  list = Array.isArray(list) ? list.slice(0, 5) : [];
  const sig = list.map((u) => u.id + ':' + u.points + ':' + u.title + ':' + u.nick).join('|');
  if (sig === S.leadSig) return;
  S.leadSig = sig; $('board').classList.toggle('empty', !list.length);
  const seen = new Set();
  list.forEach((u, i) => {
    const key = String(u.id); seen.add(key);
    let r = rows.get(key);
    if (!r) {
      const el = h('div', 'row'), rk = h('span', 'rk'), who = h('div', 'who'), nm = h('div', 'nm'), tt = h('div', 'tt'), pt = h('span', 'pt', '0');
      who.append(nm, tt); el.append(rk, avatar(u), who, pt);
      el.style.transform = `translateY(${i * ROW}px) translateX(60px)`; el.style.opacity = '0';
      $('board-list').appendChild(el); void el.offsetWidth;
      r = { el, rk, nm, tt, pt, points: 0, shown: 0, raf: 0 }; rows.set(key, r);
      el.style.opacity = '1';
    }
    r.rk.textContent = String(i + 1); r.nm.textContent = nickOf(u); r.tt.textContent = u.title || '';
    r.el.dataset.rank = String(i + 1); r.el.style.zIndex = String(10 - i);
    r.el.style.transform = `translateY(${i * ROW}px)`;
    const target = Number(u.points) || 0;
    if (target !== r.points) {
      if (target > r.points && r.points > 0) { restart(r.el, 'bump'); glance(0.9, 1100); }
      const from = r.shown, t0 = performance.now(); r.points = target; cancelAnimationFrame(r.raf);
      const step = (now) => { const k = clamp((now - t0) / 650); r.shown = Math.round(from + (target - from) * (1 - (1 - k) ** 3)); r.pt.textContent = String(r.shown); if (k < 1) r.raf = requestAnimationFrame(step); };
      r.raf = requestAnimationFrame(step);
    }
  });
  for (const [key, r] of rows) if (!seen.has(key)) { rows.delete(key); cancelAnimationFrame(r.raf); r.el.style.opacity = '0'; setTimeout(() => r.el.remove(), 320); }
}
function flashRow(user) { const r = rows.get(String(user?.id)); if (r) restart(r.el, 'flash'); }

/* ---------- kürsü ---------- */
function setPodium(list, round) {
  list = Array.isArray(list) ? list.slice(0, 3) : [];
  const sig = round + '#' + list.map((u) => u.id + ':' + u.points).join('|');
  if (sig === S.podiumSig) return;
  S.podiumSig = sig;
  $('podium-title').textContent = !list.length ? (round ? `${round}. TUR TAMAMLANDI` : 'TUR TAMAMLANDI') : round ? `🏆 ${round}. TURUN ŞAMPİYONLARI` : '🏆 TURUN ŞAMPİYONLARI';
  $('podium').classList.toggle('empty', !list.length);
  const cols = $('podium-cols'); cols.textContent = '';
  for (const place of [2, 1, 3]) {
    const u = list[place - 1]; if (!u) { if (list.length > 1 || place !== 1) cols.appendChild(h('div', 'pcol ghost')); continue; }
    const col = h('div', 'pcol p' + place), who = h('div', 'pwho');
    if (place === 1) who.appendChild(h('span', 'crown', '👑'));
    who.append(avatar(u), h('div', 'pn', nickOf(u)), h('div', 'pp', `${Number(u.points) || 0} puan`), h('div', 'pt', u.title || ''));
    col.append(who, h('div', 'stand', String(place)));
    cols.appendChild(col);
  }
  const champ = list[0];
  $('break-champ').textContent = champ ? `👑 Son turun şampiyonu: ${nickOf(champ)}` : '';
  $('chat-champ').textContent = champ ? `👑 ${nickOf(champ)}` : '';
}

/* ---------- alkış metre ---------- */
function setLikes(l) { if (l && Number.isFinite(Number(l.fill))) $('meter-fill').style.transform = `scaleX(${clamp(Number(l.fill)).toFixed(3)})`; }
let cheerTimer = 0;
function cheer() {
  const meter = $('meter'), text = $('meter-text');
  meter.classList.add('cheer'); text.textContent = 'COŞKU! 🎉';
  clearTimeout(cheerTimer); cheerTimer = setTimeout(() => { meter.classList.remove('cheer'); text.textContent = 'ALKIŞ'; }, 3000);
  sound.play('cheer');
  fxh.rain(2400, { y: FULL_OK.includes(S.phase) ? 0 : 1020, rate: 70 }); fxh.confetti(870, 1600, 60, { power: 700 }); fxh.hearts(14, 870, 1600, 150);
  mood('excited', 3000, 'jump'); setTimeout(() => { if (!speaking) host.gesture('clap'); }, 1350);
}

/* ---------- evre ---------- */
function setDemo(on) { S.demo = !!on; $('prova').hidden = !S.demo; }
function setPhase(p) {
  if (p === S.phase) return;
  if (p === 'break' && ['takip', 'begeni', 'cosku'].includes(speakingKind)) {
    ++sayToken; sound.stopVoice(); clearTimeout(bubbleTimer); bubble.classList.remove('on');
    speaking = false; speakingKind = null; host.talk(null);
  }
  S.phase = p; stage.dataset.phase = p;
  if (p === 'ask') { clearLane(); $('roundcard').classList.remove('go'); S.lastSec = null; } else stopDrum();
  if (p === 'solved') dropNear();
  if (p !== 'solved') stopLast();
  if (p === 'ask' || p === 'solved' || p === 'timeout') fitClue();
  baseMood = MOOD[p] || 'neutral'; if (!speaking && !moodTimer) host.setEmotion(baseMood);
  refreshDeco(false);
}
function updateConn() {
  let text = '';
  if (!MOCK && !S.socketUp) text = 'Bağlantı yenileniyor…';
  else if (!MOCK && !S.demo && LIVE_SHOWN.includes(S.st?.live?.state)) text = String(S.st.live.detail || '');
  const el = $('conn'); el.hidden = !text; el.textContent = text ? '⚠ ' + text : '';
}

/* ---------- iletiler ---------- */
function onHello(m) {
  if (S.build && m.build && m.build !== S.build) { location.reload(); return; }   // sunucu yeni sürümle açıldı
  if (m.build) S.build = m.build;
  setTitle(m.title); setDemo(m.demo);
  $('bubble-name').textContent = up(m.host?.name || 'Tarçın');
  refreshDeco(true);
}
function onState(s) {
  if (!s || !PHASES.includes(s.phase)) return;
  if (s.q && FULL_OK.includes(s.phase)) s = { ...s, q: null, double: false };   // açılış, kürsü ve molada soru gösterilmez (sözleşme: q null)
  S.st = s;
  setDemo(s.demo ?? S.demo);
  if (s.settings?.volumes) sound.setVolumes(s.settings.volumes);
  if (s.settings?.murmur) sound.setMurmur(s.settings.murmur);
  setPhase(s.phase);
  const final = $('farewell');
  if (s.phase === 'ended') {
    if (final.hidden) {
      ++sayToken; sound.stopVoice(); clearTimeout(bubbleTimer); host.talk(null); speaking = false;
      host.setEmotion('love'); host.gesture('knead'); sound.catCall();
      const winners = s.finalists || [];
      $('farewell-summary').textContent = s.night?.solved ? `Birlikte ${s.night.solved} soru bildik.` : 'Bugün aynı masada buluştuk.';
      $('farewell-winners').replaceChildren(...winners.map((u,i) => {
        const row = h('li'); row.append(h('b','',String(i + 1)),h('span','',nickOf(u)),h('strong','',`${u.points} puan`)); return row;
      }));
      final.hidden = false;
    }
    return;
  }
  final.hidden = true;
  const key = qKeyOf(s);
  if (key !== S.qKey) setQuestion(s, key);
  if (s.q) {
    const sig = s.round + '|' + s.index;
    if (sig !== S.introSig) { S.introSig = sig; showIntro({ index: s.index, total: s.total, type: s.q.type, category: s.q.category, double: s.double }, s.phase === 'intro' && performance.now() - S.introFxAt > 1500); }
    $('double').hidden = !s.double;
    syncTiles(s);
  }
  setChat(s);
  if (s.phase === 'solved') mergeWinners(s.winners);
  const look = s.settings?.look || 'classic';
  if (look !== S.look) {
    host.setLook(look);
    if (S.look && !speaking) host.gesture(({ detective: 'listen', dj: 'drum' })[look] || 'wave');
    S.look = look;
  }
  const hint = $('next-hint');
  hint.hidden = s.phase !== 'ask' || s.nextHintIn == null;
  if (!hint.hidden) hint.textContent = 'Sonraki harf · ' + s.nextHintIn + ' sn';
  const closed = s.phase === 'solved' && S.revealed, idle = s.phase === 'lobby' || s.phase === 'break';
  $('cta-text').textContent = s.paused ? 'Yarışma duraklatıldı' : idle && S.chat ? 'Cevabını yorumlara yaz' : s.phase === 'break' ? 'Yeni tur birazdan başlıyor' :
    s.phase === 'podium' ? 'Turun ilk üçü' : closed || s.phase === 'timeout' ? 'Sıradaki soruya hazırlan' :
    s.phase === 'solved' ? 'Hâlâ cevap yazabilirsin' : 'Cevabı yorumlara yaz';
  const track = $('round-track');
  const outcomes = s.outcomes || [];
  const sig = [s.total, s.index, ...outcomes].join('-');
  if (track.dataset.sig !== sig) {
    track.dataset.sig = sig;
    track.replaceChildren(...Array.from({ length: Math.min(s.total || 0, 60) }, (_, i) =>
      h('i', outcomes[i] || (s.index === i + 1 ? 'current' : ''))));
    track.setAttribute('aria-label', 'Turda bilinen ' + outcomes.filter(x => x === 'solved').length + ' / ' + s.total);
  }
  syncTimer(s); setRound(s); setLeaders(s.leaders);
  if (s.phase === 'podium' || s.phase === 'break') setPodium(s.podium, s.round);
  setHighlights(s.highlights); setLikes(s.likes); updateConn();
}
const FX = {
  lobby() { setPhase('lobby'); restart($('curtain'), 'go'); sound.play('whoosh'); setTimeout(() => sound.play('intro'), 500); mood('happy', 3000, 'wave'); },
  roundStart(f) {
    const card = $('roundcard'); card.textContent = '';
    const box = h('div'); box.append(h('strong', '', `${f.round}. TUR`), h('span', '', 'BAŞLIYOR!')); card.appendChild(box);
    if (S.phase !== 'ask') { restart(card, 'go'); sound.play('whoosh'); }
  },
  questionStart(f) {
    setPhase('intro'); S.introFxAt = performance.now();
    showIntro({ index: f.index, total: f.total, type: f.qtype, category: f.category, double: f.double }, true);
    clearGuesses(); sound.play('intro'); mood('happy', 2200, 'point');
  },
  reveal(f) { if (openTile(Number(f.pos), f.ch, false)) glance(rnd(-0.6, 0.6), 900); else sound.play('flip'); },
  guess(f) { addGuess(f); },
  solved(f) {
    setPhase('solved'); stopDrum(); dropNear();
    setWinner(f.user, f.points, f);
    sound.play('ding'); setTimeout(() => sound.play('applause'), 180);
    // Tolerans süresinde başkaları hâlâ yazıyor: konfeti ipucunu ve kutuları örtmesin, sunucu bölgesinden fışkırsın.
    fxh.confetti(150, 1500, 70, { angle: -1.2, spread: 1.3, power: 950 }); fxh.confetti(930, 1500, 70, { angle: -1.94, spread: 1.3, power: 950 });
    fx.sparkle(162, 418, 16);
    mood('excited', 3200, 'clap'); flashRow(f.user);
  },
  answer(f) {
    mergeWinners(f.winners);
    const fresh = revealAll(f.answer, true);
    sound.play('shine'); if (fresh) setTimeout(() => sound.play('ding'), 380);
    S.tiles.forEach((rec, i) => { if (!rec.space && i % 2 === 0) { const b = stageBox(rec.el); setTimeout(() => fx.sparkle(b.x + b.w / 2, b.y + b.h / 2, 5, '#FFD34D', 260), 300 + i * 50); } });
    fx.confetti(540, 860, 60, { spread: 2.2, power: 780 });
    mood('happy', 2200);
  },
  alsoCorrect(f) {
    if (!S.win) return;
    const rank = Number(f.rank); if (rank !== 2 && rank !== 3) return;
    S.win.also.set(rank, { user: f.user, points: Number(f.points) || 0, behind: f.behind }); renderAlso(); sound.play('chip'); flashRow(f.user);
  },
  others(f) { if (!S.win) return; S.win.others = Math.max(0, Number(f.count) || 0); renderAlso(); },
  timeout(f) { setPhase('timeout'); stopDrum(); revealAll(f.answer, false); sound.play('olmadi'); mood('sad', 3200, 'shrug'); },
  questionEnd(f) { if (f.fact) toast('fact', '💡', [String(f.fact)], 4200); },
  levelUp(f) {
    toast('level', '⭐', [nickOf(f.user) + ' artık ', [up(f.title)], '!'], 2800, [nickOf(f.user), `artık ${up(f.title)}!`]); sound.play('levelup'); flashRow(f.user);
    if (S.phase !== 'ask') fx.sparkle(540, 900, 22, '#FFD34D', 520);
    mood('wow', 2000);
  },
  record(f) {
    toast('record', '🏅', [['YENİ REKOR!'], ` Bu gece ${f.solved} soru bilindi`], 2800, ['YENİ REKOR!', `Bu gece ${f.solved} soru bilindi`]); sound.play('record');
    if (S.phase !== 'ask') fx.confetti(540, 900, 70, { spread: 2.4, power: 800 });
  },
  roundEnd(f) {
    setPhase('podium'); setPodium(f.podium, f.round);
    sound.play('fanfare'); setTimeout(() => sound.play('applause'), 1150);
    const has = Array.isArray(f.podium) && f.podium.length > 0;
    if (has) { setTimeout(() => { if (S.phase === 'podium') { fx.confetti(540, 560, 130, { spread: 2.6, power: 1250 }); fx.rain(2600, { rate: 70 }); } }, 1250); }
    mood('excited', 4000, has ? 'clap' : 'shrug');
  },
  breakStart() { setPhase('break'); sound.play('whoosh'); mood('happy', 2500, 'knead'); },
  catHello() { mood('wink', 1200, 'boop'); sound.catCall(); },
  join(f) {
    const back = f.returning ? (f.title ? `yine burada · ${f.title}` : 'yine burada!') : 'hoş geldin!';
    socialChip('join', 1, f.user, '👋', back, '#2ED3B7', (n) => `+${n} kişi katıldı`, 'hoş geldiniz!'); if (Math.random() < 0.3) mood('happy', 1600, f.returning ? 'boop' : 'wave');
  },
  follow(f) { socialChip('follow', 2, f.user, '⭐', 'takip etti!', '#FFD34D', (n) => `+${n} yeni takipçi`, 'aramıza hoş geldiniz!'); fxh.sparkle(1000, 1700, 10, '#FFD34D', 300); mood('happy', 2000, 'wave'); },
  share(f) { socialChip('share', 2, f.user, '📣', 'yayını paylaştı!', '#FF8FB0', (n) => `+${n} kişi paylaştı`, 'elinize sağlık!'); mood('wink', 2000); },
  like(f) {
    const n = clamp(Math.round(2 + (Number(f.count) || 1) / 3), 2, 12);
    fxh.hearts(n, 1062, 1640, 8); sound.play('heart'); restart($('meter'), 'pop');   // kalpler sıralamanın sağındaki boşlukta yükselir
  },
  cheer() { cheer(); },
};
function deliver(m) {
  if (!m || typeof m !== 'object') return;
  try {
    if (m.t === 'hello') onHello(m);
    else if (m.t === 'state') onState(m);
    else if (m.t === 'say' && S.phase !== 'ended') onSay(m);
    else if (m.t === 'fx' && S.phase !== 'ended' && Array.isArray(m.list)) {
      for (const f of m.list) {
        const fn = f && FX[f.type];   // bilinmeyen türler sessizce atlanır (sunucu yenilerini ekleyebilir)
        if (fn) { try { fn(f); } catch (e) { console.error('Efekt işlenemedi: ' + f.type, e); } }
      }
    }
  } catch (e) { console.error('Sahne iletisi işlenemedi', e); }
}

/* ---------- bağlantı ---------- */
let socket = null, retries = 0, retryTimer = 0, closing = false;
function connect() {
  if (closing) return;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); socket = ws;
  ws.onopen = () => { if (ws !== socket) return; retries = 0; S.socketUp = true; updateConn(); };
  ws.onmessage = (e) => { if (ws !== socket) return; let m; try { m = JSON.parse(e.data); } catch { return; } deliver(m); };
  ws.onclose = () => { if (ws !== socket || closing) return; S.socketUp = false; updateConn(); retryTimer = setTimeout(connect, Math.min(8000, 1000 * 2 ** retries++)); };
  ws.onerror = () => ws.close();
}
window.addEventListener('pagehide', () => { closing = true; clearTimeout(retryTimer); if (socket) socket.close(); });
window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });

/* ---------- ses düğmesi: tarayıcı sesi askıya aldıysa görünür; OBS'te ses kendiliğinden başlar ---------- */
const soundBtn = $('sound');
const syncSound = () => { soundBtn.hidden = sound.state !== 'suspended'; };
sound.onState(syncSound); soundBtn.onclick = () => sound.unlock().then(syncSound);
sound.music(true); setTimeout(syncSound, 300);

async function main() {
  try { await Promise.race([Promise.all([document.fonts.load('900 40px Nunito'), document.fonts.ready]), new Promise((r) => setTimeout(r, 2500))]); } catch { /* yazı tipi gecikse de sahne açılır */ }
  setTitle(S.title); updateConn();
  if (MOCK) { const { startMock } = await import('./mock.js'); startMock(deliver, { scene: params.get('scene') }); }
  else connect();
}
window.__show = { deliver, host, sound, fx, fxh, get state() { return S.st; }, get phase() { return S.phase; } };
main();
