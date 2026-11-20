// Bil Bakalım yayın sunucusu: oyun makinesini, sunucu karakterin beynini ve sesi çalıştırır; izleyici olaylarını içeri alır,
// sahneyi (yayın yazılımının tarayıcı kaynağı, /stage) ve paneli (/panel) besler. Bu dosya yalnız bağlantıları kurar:
// kurallar engine.js, replikler host.js, ses tts.js içindedir.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { createFilter } from './filter.js';
import { isLocal } from './lan.js';
import { loadBank, createPicker } from './questions.js';
import { createEngine, SHOW_DEFAULTS } from './engine.js';
import { createPlayers } from './players.js';
import { createHost } from './host.js';
import { createTts, POCKET_VOICES } from './tts.js';
import { createAi } from './ai.js';
import { createJournal } from './journal.js';
import { createDemoAudience } from './sources/demo.js';
import { PROVINCES } from './provinces.js';
import { matchIntent, addressesHost } from './intents.js';
import { guessLike, fold } from './normalize.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const show = { title: 'Bil Bakalım', host: { name: 'Tarçın' }, likeGoal: 300, tts: {}, ai: {}, blockedWords: [], ...(cfg.show || {}) };
const PORT = process.env.PORT !== undefined ? Number(process.env.PORT) : cfg.port || 8181;
const LAN = process.env.LAN === '1';
const BUILD = String(Date.now());
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.ogg':'audio/ogg', '.txt':'text/plain; charset=utf-8', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.ico': 'image/x-icon' };

const filter = createFilter([...(cfg.blockedWords || []), ...(show.blockedWords || [])]);
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const write = (file, data) => { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 1)); return true; } catch { return false; } };

/* ---------- içerik ---------- */
const bank = loadBank(path.join(HERE, 'data', 'sorular.json'));
const lines = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'replikler.json'), 'utf8')).olaylar;

/* ---------- ayarlar ve kalıcı durum ---------- */
const SETTINGS_FILE = path.join(DATA, 'show-settings.json'), STATE_FILE = path.join(DATA, 'show-state.json');
const saved = read(SETTINGS_FILE, {});
const unit = (v, d) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);
const settings = {
  look: ['classic', 'detective', 'dj'].includes(saved.look) ? saved.look : 'classic',
  murmur: ['miyav', 'bip', 'off'].includes(saved.murmur) ? saved.murmur : 'miyav',
  pace: ['standard', 'quick', 'relaxed'].includes(saved.pace) ? saved.pace : 'standard',
  delivery: saved.delivery === 'presenter' ? 'presenter' : 'natural',
  pocketVoice: POCKET_VOICES.includes(saved.pocketVoice) ? saved.pocketVoice : 'female_2',
  volumes: { voice: unit(saved.volumes?.voice, 1), music: unit(saved.volumes?.music, 0.22), fx: unit(saved.volumes?.fx, 0.8) },
  followReminder: saved.followReminder !== false, spokenFacts: saved.spokenFacts !== false,
  ai: saved.ai === undefined ? show.ai?.on === true : !!saved.ai,
};
let persisted = read(STATE_FILE, { record: 0, recent: [] });

/* ---------- çalışma durumu ---------- */
let demo = process.argv.includes('--demo');
const IDLE = { state: 'idle', detail: '' };   // dış kaynak yok: olaylar panelden ya da /api/sim ile gelir
let live = { ...IDLE }, source = null, generation = 0;
let viewers = 0, likes = 0, meter = 0, lastCheer = -1e9, outFx = [];
const clients = new Set(), log = [], likeSeen = new Map();
const nowSec = () => Date.now() / 1000;
const note = (tag, text) => { log.push({ at: Date.now(), tag, text }); if (log.length > 200) log.shift(); };
const send = (msg) => { const data = JSON.stringify(msg); for (const ws of clients) if (ws.readyState === 1) ws.send(data); };

const tts = createTts({ delivery: settings.delivery, pocketVoice: settings.pocketVoice, provider: process.env.SHOW_TTS || show.tts?.provider || 'auto', voice: show.tts?.voice || undefined, cacheDir: path.join(DATA, 'tts-cache'), maxFiles: 3000, log: (m) => note('ses', m) });
let lastSpeech = null;
const journal = createJournal({ dir: path.join(DATA, 'show-log'), enabled: !demo });
let participants = new Set(), breakHistory = [];
let hostSession = 0;
const chatSeen = new Map();
const activeCount = () => { const t = nowSec(); let n = 0; for (const at of chatSeen.values()) if (t - at <= 120) n++; return n; };
let players, picker, engine, host;
const aiOptions = { model: process.env.SHOW_CLAUDE_MODEL || show.ai?.model, hostName: show.host.name, isBlocked: filter.isBlocked, log: (m) => note('yz', m) };
let ai = createAi(aiOptions);
let aiSource = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? 'kalici' : null;   // anahtar nereden geldi: kalıcı kayıt (CLAUDE_ANAHTARI.bat) ya da panelden bu oturum için

function build() {
  const session = ++hostSession;
  breakHistory = !demo && Array.isArray(persisted.breakHistory) ? [...persisted.breakHistory] : [];
  participants = new Set(); outFx = [];
  players = createPlayers({ file: path.join(DATA, 'show-players.json'), readOnly: demo });
  picker = createPicker({ items: bank.items, recent: demo ? [] : persisted.recent || [] });
  engine = createEngine({ picker, players, config: Object.fromEntries(Object.keys(SHOW_DEFAULTS).filter((k) => Number.isFinite(show[k])).map((k) => [k, show[k]])), night: { solved: 0, record: demo ? 0 : persisted.record || 0 } });
  host = createHost({ lines, tts, now: nowSec, isBlocked: filter.isBlocked, breakHistory, standing: (id) => engine.standing(id),
    options: { followReminder: settings.followReminder, spokenFacts: settings.spokenFacts },
    emit: (msg) => {
      if (session !== hostSession || engine.phase() === 'ended') return;
      journal.count('says'); if (!msg.url) journal.count('silent');
      lastSpeech = { provider: msg.speechProvider, voice: msg.voice, text: msg.speech };
      send(msg); note('tarçın', msg.text);
    } });
  chatSeen.clear();
  engine.command({ type: 'pace', pace: settings.pace });
  viewers = 0; likes = 0; meter = 0;
}
build();

const stateMsg = () => { const snap = engine.snapshot(); return { t: 'state', ...snap, highlights: { ...snap.highlights, active: activeCount() }, chat: ['lobby', 'podium', 'break'].includes(snap.phase) ? host.asked() : null,
  viewers, likes: { count: likes, fill: Math.min(1, meter) }, live, demo,
  settings: { volumes: settings.volumes, look: settings.look, murmur: settings.murmur } }; };
const helloMsg = () => ({ t: 'hello', build: BUILD, demo, title: show.title, host: show.host });

/** Şovu açılıştan başlatır: yayına ilk bağlanışta (izleyici açılışı görsün diye) ve panelden istenince. */
function restartShow(why) { saveState(); players.close(); build(); realEvents = 0; send(helloMsg()); send(stateMsg()); note('sistem', why); journal.event('yeniden', { why }); }
function saveState() {
  if (demo || realEvents === 0) return;   // izleyici yokken dönen sorular "sorulmuş" sayılmaz, kayda geçmez
  const night = engine.night(); persisted = { record: Math.max(persisted.record || 0, night.record), recent: picker.recent(), breakHistory: [...breakHistory] };
  write(STATE_FILE, persisted); players.saveSoon();
}

/** Motor olaylarını yönetmene ve sahneye dağıtır. */
function handle(fx) {
  if (!fx.length) return;
  host.onFx(fx, engine.snapshot());
  for (const f of fx) {
    if (f.type === 'ask') continue;   // iç olay: sahne ipucunu durumdan okur
    outFx.push(f);
    if (f.type === 'answer') journal.event('soru', { solved: true, answer: f.answer, winners: f.winners.length, first: f.winners[0]?.user.nick, gaps: f.winners.slice(1).map((w) => w.behind ?? null) });
    else if (f.type === 'timeout') journal.event('soru', { solved: false, answer: f.answer });
    else if (f.type === 'roundEnd') journal.event('tur', { round: f.round, champion: f.champion?.nick || null, points: f.champion?.points || 0 });
    else if (f.type === 'solved' || f.type === 'alsoCorrect') journal.count('correct');
    else if (f.type === 'guess') journal.count('guesses');
    if (f.type === 'lobby') presynth();
    else if (f.type === 'solved') { note('oyun', `${f.user.nick} bildi (+${f.points})`); host.prepareReveal(engine.answerForDemo()); presynth(); }
    else if (f.type === 'timeout') { note('oyun', `Süre bitti: ${f.answer}`); presynth(); }
    else if (f.type === 'questionEnd') saveState();
    else if (f.type === 'roundEnd') note('oyun', `${f.round}. tur bitti` + (f.champion ? `, şampiyon ${f.champion.nick}` : ''));
  }
}
/** Sıradaki ipucunu şimdiden seslendirir (soru açılınca beklemesin). */
function presynth() {
  const next = engine.peekNext();
  if (!next?.say) return;
  const { index, total } = engine.snapshot();
  const prefix = index % total + 1 === total ? 'Çifte puanlı soru! ' : '';
  tts.speak(prefix + next.say, { emotion: 'neutral' }).catch(() => {});
}

// Tahmin şeridine yalnız tahmine benzeyen, harflerden oluşan ve reklam/istek kokmayan yorumlar düşer.
const UNSAFE = /(takip|abone|link|http|www|insta|telegram|whatsapp|numara|satilik|bahis|casino|bonus|iddaa|kazan)/;
// Sunucunun sohbet sorusuna verilen cevap sesli anılacaksa: kısa, sade ve istek/reklam kokmayan bir söz olmalı.
// Tarçın'ın sesli tekrar edebileceği kelimeler: soru bankasının cevapları, iller ve küçük bir onaylı liste. Bunların dışındaki söz tekrar edilmez.
const VOCAB = new Set([...bank.items.flatMap((q) => [q.answer, ...(q.accept || [])]), ...PROVINCES.map((p) => p.name),
  'çay', 'kahve', 'ayran', 'su', 'süt', 'limonata', 'evet', 'hayır', 'iyi', 'güzel', 'harika', 'süper', 'yorgun', 'mutlu', 'keyifli', 'sakin', 'yoğun', 'güneşli', 'yağmurlu', 'karlı', 'bulutlu', 'rüzgarlı', 'sıcak', 'soğuk', 'serin',
  'tek', 'yalnız', 'ailem', 'annem', 'babam', 'kardeşim', 'arkadaşım', 'eşim', 'çocuklar', 'kedim', 'iki', 'üç', 'dört', 'beş', 'kişi', 'kişiyiz', 've', 'ile', 'var', 'yok', 'çok', 'biraz', 'içiyorum', 'yiyorum', 'izliyorum',
  'memleket', 'yemek', 'futbol', 'müzik', 'tarih', 'doğa', 'dizi', 'film'].flatMap((w) => fold(w).split(' ')));
// Ekranda ve seste yer almaması gereken hassas konular (siyaset, örgüt, mezhep, etnik gerilim). Bankada geçen kelimeler (ör. bir ülke adı) tahmin olarak serbesttir.
const SENSITIVE = /(akp|chp|mhp|hdp|dem parti|iyi parti|erdogan|kilicdaroglu|imamoglu|bahceli|demirtas|ocalan|pkk|feto|isid|dhkp|hamas|hizbullah|siyonist|yahudi|ermeni|kurdistan|alevi|sunni|seriat|darbe|sehit|terorist|secim|oy ver|bayrak|irkci|fasist|komunist)/;
const inVocab = (text) => { const words = fold(text).split(' ').filter(Boolean); return words.length > 0 && words.every((w) => VOCAB.has(w)); };
/** Sohbet sorusuna cevap sayılacak kısa, sade söz mü (reklam, istek ve hassas konu değil)? */
const chatLike = (text) => { const s = String(text).trim(), n = [...s].length; return n >= 2 && n <= 40 && s.split(/\s+/).length <= 6 && /^[\p{L}\p{N} ,.!?'-]+$/u.test(s) && !UNSAFE.test(fold(s)) && !SENSITIVE.test(fold(s)); };
/** Sesli tekrar edilebilecek söz: en çok üç kelime ve hepsi onaylı listeden; değilse null (kişi yalnız adıyla anılır). */
const safeEcho = (text) => { const s = String(text).trim().replace(/[,.!?'-]+/g, ' ').replace(/\s+/g, ' ').trim(); return s && s.split(' ').length <= 3 && inVocab(s) ? s : null; };
const safeGuess = (text) => guessLike(text) && /^[\p{L} ]+$/u.test(String(text).trim()) && !UNSAFE.test(fold(text)) && (inVocab(text) || !SENSITIVE.test(fold(text)));

function person(u) {
  const nick = filter.cleanNick(u.nick), user = { id: String(u.id), nick: nick === 'yolcu' ? 'misafir' : nick };
  return user;
}

/** Yayından (ya da provadan, panel denemesinden) gelen her olay buradan geçer. */
let realEvents = 0;   // canlı yayından gelen olay sayısı: sıfırsa şov henüz kimseye oynamadı
function ingest(ev, from = 'canlı') {
  if (engine.phase() === 'ended') { if (ev.type === 'viewers') viewers = ev.count; return; }
  if (from === 'canlı') realEvents += 1;   // panel denemeleri ve prova sayılmaz: yayına bağlanınca açılış yine kendiliğinden başlar
  if (ev.type === 'viewers') { viewers = ev.count; host.social.viewers(viewers); return; }
  if (!ev.user) return;
  const user = person(ev.user);
  const measured = demo || from === 'canlı';
  switch (ev.type) {
    case 'join': { const info = players.seen(user); if (info.first) { journal.count('joins'); outFx.push({ type: 'join', user, returning: info.returning, title: info.returning ? info.title : null }); host.social.join(user, info); } break; }
    case 'chat': {
      const text = String(ev.text || '').trim(); if (!text || filter.isBlocked(text)) return;
      if (measured) participants.add(user.id);
      players.seen(user); chatSeen.set(user.id, nowSec()); journal.count('chats'); if (chatSeen.size > 5000) { const t = nowSec(); for (const [id, at] of chatSeen) if (t - at > 600) chatSeen.delete(id); }
      const v = engine.verdict(text);
      if (v === 'correct' || v === 'near' || v === 'late') { handle(engine.chat({ user, text, at: ev.at })); host.activity(); return; }
      const intent = matchIntent(text, { phase: engine.phase() });
      if (intent && host.onIntent(user, intent)) return;
      host.activity();
      // Sunucu sohbete soru sorduysa (mola, açılış) kısa cevaplar tahmin değil sohbettir: adıyla karşılık bulur.
      const breakChat = engine.phase() === 'break' && text.length <= 160 && !UNSAFE.test(fold(text)) && !SENSITIVE.test(fold(text));
      if (!intent && (breakChat || (host.listening() && !['ask', 'solved'].includes(engine.phase()) && chatLike(text)))) {
        const speaker = host, client = ai, echo = safeEcho(text); journal.count('answers');
        if (settings.ai && client.ready()) {
          client.reply({ user, text, phase: engine.phase(), asked: host.asked() }).then((r) => {
            if (host !== speaker) return;
            if (r && client === ai && settings.ai) { journal.count('ai'); journal.event('yz', { nick: user.nick, soru: text.slice(0, 120), cevap: r, asked: true }); speaker.custom(r, { kind: 'sohbet', ttl: 10 }); } else speaker.onBreakAnswer(user, echo);
          });
        } else host.onBreakAnswer(user, echo);
        return;
      }
      if (!intent && addressesHost(text, show.host.name)) {
        const speaker = host, client = ai;
        if (settings.ai && client.ready()) {
          client.reply({ user, text, phase: engine.phase() }).then((r) => {
            if (r && host === speaker && client === ai && settings.ai) { journal.count('ai'); journal.event('yz', { nick: user.nick, soru: text.slice(0, 120), cevap: r }); speaker.custom(r, { kind: 'sohbet', ttl: 10 }); }
          });
        }
      } else if (!intent && safeGuess(text)) handle(engine.chat({ user, text }));
      break;
    }
    case 'follow': journal.count('follows'); journal.event('takip', { nick: user.nick }); outFx.push({ type: 'follow', user }); host.social.follow(user); note(from, `${user.nick} takip etti`); break;
    case 'share': journal.count('shares'); outFx.push({ type: 'share', user }); host.social.share(user); note(from, `${user.nick} paylaştı`); break;
    case 'like': {
      const n = Math.max(1, Number(ev.count) || 1), t = nowSec(); likes += n; meter += n / (show.likeGoal || 300); journal.count('likes', n);
      if (t - (likeSeen.get(user.id) || 0) > 2) { likeSeen.set(user.id, t); outFx.push({ type: 'like', user, count: n }); if (likeSeen.size > 3000) likeSeen.clear(); }
      host.social.like(user, n);
      if (meter >= 1 && t - lastCheer > 20) { meter = 0; lastCheer = t; outFx.push({ type: 'cheer' }); host.social.cheer(); }
      break;
    }
  }
}

/* ---------- olay kaynağı (isteğe bağlı) ---------- */
// İzleyici olayları üç yoldan gelir: prova izleyicisi (sources/demo.js), HTTP ile gönderilen olaylar (/api/sim) ve isteğe
// bağlı bir dış kaynak. Dış kaynak, SHOW_SOURCE ortam değişkeninde ya da config.json içindeki show.source alanında yolu
// verilen bir ES modülüdür: `createSource({ onEvent, onStatus })` dışa aktarır, `{ connect(), disconnect() }` döndürür.
// Olay biçimi ve durum adları docs/PROTOCOL.md içindedir. Şov bir sohbet platformunu tanımaz; yalnız bu olayları tanır.
const SOURCE_PATH = process.env.SHOW_SOURCE || show.source || '';
function sourceStatus(gen, s) {
  if (gen !== generation) return;
  const next = { state: String(s?.state || 'idle'), detail: String(s?.detail || '') }, waiting = (x) => ['connecting', 'waiting'].includes(x);
  if (next.state !== live.state && !(waiting(next.state) && waiting(live.state))) journal.event('baglanti', next);   // beklerken yinelenen yoklamalar günlüğü doldurmasın
  // Kaynak ilk kez bağlanınca şov baştan başlar: sunucu yayından önce açıldığı için açılışı o ana kadar kimse görmedi.
  // Yayın ortasındaki kopup bağlanmalarda (olay gelmişse) dokunulmaz.
  const first = next.state === 'connected' && live.state !== 'connected' && realEvents === 0 && engine.phase() !== 'ended';
  live = next; if (first) restartShow('Kaynak bağlandı: şov açılıştan başlıyor'); note('sistem', `Kaynak: ${next.state}${next.detail ? ' · ' + next.detail : ''}`);
}
async function connect() {
  if (!SOURCE_PATH || demo) return;
  const gen = ++generation, previous = source; source = null;
  if (previous) await previous.disconnect?.();
  if (gen !== generation) return;
  try {
    const mod = await import(pathToFileURL(path.resolve(ROOT, SOURCE_PATH)).href);
    if (gen !== generation) return;
    source = mod.createSource({ onEvent: (ev) => { if (gen === generation && !demo) ingest(ev, 'canlı'); }, onStatus: (st) => sourceStatus(gen, st) });
    await source.connect?.();
  } catch (e) { sourceStatus(gen, { state: 'warning', detail: 'Kaynak yüklenemedi: ' + e.message }); }
}
async function disconnect() { const gen = ++generation, previous = source; source = null; if (previous) await previous.disconnect?.(); if (gen === generation) live = { ...IDLE }; }

/* ---------- prova izleyicisi (yalnız --demo ya da panelden) ---------- */
const audience = createDemoAudience({ emit: (ev) => ingest(ev, 'prova'), answers: bank.items.map((q) => q.answer),
  peek: () => ({ phase: engine.phase(), answer: engine.answerForDemo(), opened: engine.opened() }) });
const rnd = (list) => list[Math.floor(Math.random() * list.length)];

/* ---------- HTTP ---------- */
const json = (res, code, body) => { res.writeHead(code, { 'content-type': MIME['.json'], 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
function serveFile(req, res, file) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end('Bulunamadı'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': stat.size, 'cache-control': 'no-cache' });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}
const inside = (base, rel) => { const file = path.resolve(base, '.' + path.sep + rel); return file === base || file.startsWith(base + path.sep) ? file : null; };
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 64 * 1024) { reject(new Error('Gövde çok büyük')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('Geçersiz JSON')); } });
    req.on('error', reject);
  });
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/boot') return json(res, 200, { mode: 'show', build: BUILD, demo, title: show.title, host: show.host });
  if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, { ...stateMsg(), settings, log: log.slice(-60),
    participation: { people: participants.size },
    tts: { ...tts.status(), lastSpeech }, ai: { ...ai.status(), source: aiSource }, bank: { count: bank.items.length, skipped: bank.errors.length } });
  if (req.method !== 'POST') return json(res, 405, { error: 'Yalnızca POST' });
  if (url.pathname === '/api/claude-key') {
    const localHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(req.headers.host || '');
    if (!localHost || !isLocal(req.socket.remoteAddress) || req.headers.origin !== 'http://' + req.headers.host ||
        req.headers['content-type'] !== 'application/json') return json(res, 403, { error: 'Paneli localhost üzerinden aç.' });
    const { key } = await readBody(req);
    if (typeof key !== 'string' || !/^sk-ant-[A-Za-z0-9_-]{20,500}$/.test(key)) return json(res, 400, { error: 'Anthropic API anahtarının biçimini kontrol et.' });
    const candidate = createAi({ ...aiOptions, apiKey: key });
    await candidate.initialized;
    if (!candidate.status().available) return json(res, 503, { error: candidate.status().lastError });
    ai = candidate; aiSource = 'oturum';
    settings.ai = true;
    write(SETTINGS_FILE, settings);
    return json(res, 200, { ok: true });
  }
  const body = await readBody(req);
  if (url.pathname === '/api/voice-preview') {
    if (tts.provider === 'pocket' && !tts.status().ready) return json(res, 503, { error: tts.status().unavailable ? tts.status().lastError : 'Pocket yükleniyor. Panelde Pocket Türkçe göründüğünde tekrar dinle.' });
    const emotion = tts.provider === 'pocket' && settings.delivery === 'natural' ? 'neutral' : 'happy';
    // Örnek replik: bankadan rastgele bir cümle, örnek adlarla doldurulur (yayında söylenenle aynı ses ve duygu).
    const SAMPLES = { acilis: ['acilis', {}, 'happy'], bildi: ['bildi', { ad: 'Ayşe', cevap: 'İzmir', puan: 88 }, 'excited'],
      mola: ['molaSoru', {}, 'neutral'], takip: ['takip', { ad: 'Elif' }, 'happy'], hosgeldin: ['hosgeldin', { ad: 'Mert' }, 'happy'] };
    const pickOne = SAMPLES[body.sample], pool = pickOne ? lines[pickOne[0]] || [] : [];
    const text = pool.length ? rnd(pool).replace(/\{(\w+)\}/g, (_, k) => pickOne[1][k] ?? '') : 'Merhaba, ben Tarçın. Hazırsan ilk ipucuna birlikte bakalım.';
    const clip = await tts.speak(text, { emotion: pool.length ? pickOne[2] : emotion, timeoutMs: 8000 });
    return clip ? json(res, 200, { url: '/tts/' + clip.name, ms: clip.ms, text }) : json(res, 503, { error: 'Ses hazırlanamadı. Ses sağlayıcısının durumunu kontrol et.' });
  }
  if (url.pathname === '/api/sim') {
    const nick = String(body.nick || 'Deneme').slice(0, 24), user = { id: 'test-' + fold(nick), nick };
    if (body.type === 'answer') { const a = engine.answerForDemo(); if (!a) return json(res, 409, { error: 'Açık soru yok' }); ingest({ type: 'chat', user, text: a.toLocaleLowerCase('tr-TR'), ...(Number(body.at) > 0 ? { at: Number(body.at) } : {}) }, 'deneme'); }   // `at`: foto-finişi provada denemek için
    else if (body.type === 'chat') ingest({ type: 'chat', user, text: String(body.text || '').slice(0, 150) }, 'deneme');
    else if (body.type === 'like') ingest({ type: 'like', user, count: Math.max(1, Math.min(500, Number(body.count) || 15)) }, 'deneme');
    else if (['join', 'follow', 'share'].includes(body.type)) ingest({ type: body.type, user }, 'deneme');
    else return json(res, 400, { error: 'Bilinmeyen deneme' });
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/cmd') {
    switch (body.type) {
      case 'pause': case 'skip': handle(engine.command(body)); break;
      case 'restart': restartShow('Şov panelden açılıştan başlatıldı'); break;
      case 'catHello': if (engine.phase() !== 'ended') send({ t:'fx', list:[{ type:'catHello' }] }); break;
      case 'finish':
        if (engine.phase() !== 'ended') {
          engine.command({ type: 'finish' }); outFx = []; saveState();
          note('oyun', 'Final ekranı açıldı'); journal.event('final', { solved: engine.night().solved });
        }
        break;
      case 'murmurTest':   // ses kaydı yetişmediğinde duyulan yedek sesi (miyav/bip) sahnede dener
        send({ t: 'say', id: Date.now(), kind: 'deneme', text: 'Miyav! Ses kaydı yetişmezse böyle konuşurum.', speech: 'Miyav! Ses kaydı yetişmezse böyle konuşurum.', url: null, ms: 3600,
          emotion: 'happy', gesture: 'wave', voiceEnabled: true, allowSystemVoice: false, speechProvider: null, voice: null });
        break;
      case 'demo': {
        const on = !!body.on; if (on === demo) break;
        if (on) await disconnect();
        demo = on; journal.setEnabled(!demo); audience.reset(); build(); send(helloMsg()); note('sistem', demo ? 'Prova başladı' : 'Prova kapandı');
        if (!on) connect();   // prova kapanınca dış kaynak (tanımlıysa) yeniden bağlanır
        break;
      }
      case 'settings':
        if (['classic', 'detective', 'dj'].includes(body.look)) settings.look = body.look;
        if (['miyav', 'bip', 'off'].includes(body.murmur)) settings.murmur = body.murmur;
        if (['standard', 'quick', 'relaxed'].includes(body.pace)) {
          settings.pace = body.pace;
          engine.command({ type: 'pace', pace: settings.pace });
        }
        if (['natural', 'presenter'].includes(body.delivery)) {
          settings.delivery = body.delivery;
          tts.setDelivery(settings.delivery);
        }
        if (POCKET_VOICES.includes(body.pocketVoice)) {
          settings.pocketVoice = body.pocketVoice;
          tts.setPocketVoice(settings.pocketVoice);
          presynth();
        }
        if (['natural', 'presenter'].includes(body.delivery) || POCKET_VOICES.includes(body.pocketVoice)) host.warm();   // yeni ses ya da anlatım için hazır replikler yeniden seslendirilir (değişmediyse iş başlamaz)
        for (const k of ['voice', 'music', 'fx']) if (Number.isFinite(body.volumes?.[k])) settings.volumes[k] = unit(body.volumes[k], settings.volumes[k]);
        for (const k of ['followReminder', 'spokenFacts', 'ai']) if (typeof body[k] === 'boolean') settings[k] = body[k];
        host.setOptions({ followReminder: settings.followReminder, spokenFacts: settings.spokenFacts });
        write(SETTINGS_FILE, settings);
        break;
      default: return json(res, 400, { error: 'Bilinmeyen komut' });
    }
    send(stateMsg());
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'Bulunamadı' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // Telefon kipi (LAN=1): ağdaki cihazlar yalnız sahneyi ve onun okuduklarını görür; panel ve komutlar bu bilgisayarda kalır.
  if (!isLocal(req.socket.remoteAddress) && (!['GET', 'HEAD'].includes(req.method) || ['/', '/panel', '/api/state'].includes(url.pathname) || url.pathname.startsWith('/panel'))) return json(res, 403, { error: 'Bu sayfa yalnız yayın bilgisayarından açılır' });
  if (url.pathname.startsWith('/tts/')) {
    const name = url.pathname.slice(5); if (!/^[a-f0-9]{40}\.wav$/.test(name)) { res.writeHead(404); res.end(); return; }
    return serveFile(req, res, path.join(DATA, 'tts-cache', name));
  }
  if (url.pathname.startsWith('/api/')) { api(req, res, url).catch((e) => json(res, 500, { error: e.message })); return; }
  if (url.pathname === '/') { res.writeHead(302, { location: '/panel' }); res.end(); return; }
  if (url.pathname === '/stage') return serveFile(req, res, path.join(PUBLIC, 'index.html'));
  if (url.pathname === '/panel') return serveFile(req, res, path.join(PUBLIC, 'panel.html'));
  let rel; try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
  const file = inside(PUBLIC, rel.slice(1));
  if (!file) { res.writeHead(403); res.end(); return; }
  serveFile(req, res, file);
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify(helloMsg())); ws.send(JSON.stringify(stateMsg()));
  ws.on('close', () => clients.delete(ws)); ws.on('error', () => clients.delete(ws));
});

let last = Date.now();
const loop = setInterval(() => {
  const now = Date.now(), dt = Math.min(1, (now - last) / 1000); last = now;
  handle(engine.tick(dt));
  if (engine.phase() !== 'ended') host.tick(engine.snapshot());
  if (outFx.length) { send({ t: 'fx', list: outFx }); outFx = []; send(stateMsg()); }
}, 100);
const beat = setInterval(() => send(stateMsg()), 500);
const sim = setInterval(() => { if (demo) audience.tick(); }, 600);
const minute = setInterval(() => journal.minute({ viewers, active: activeCount(), phase: engine.phase() }), 60000);

function shutdown() { journal.event('kapanis'); journal.flush(); clearInterval(minute); clearInterval(loop); clearInterval(beat); clearInterval(sim); saveState(); players.close(); tts.close(); process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} kullanımda. Başka bir Bil Bakalım penceresi açık olabilir; onu kapat.` : e.message); process.exit(1); });
server.listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
  const port = server.address().port;
  console.log(`Bil Bakalım çalışıyor${demo ? ' (PROVA)' : ''} · ${bank.items.length} soru · ses: ${tts.provider}`);
  if (bank.errors.length) console.log(`  Uyarı: ${bank.errors.length} soru biçim hatası yüzünden atlandı (ilk: ${bank.errors[0]})`);
  console.log(`  Kontrol paneli : http://localhost:${port}/panel`);
  console.log(`  OBS sahnesi    : http://localhost:${port}/stage   (tarayıcı kaynağı, 1080×1920)`);
  if (process.platform === 'win32' && process.argv.includes('--open')) {
    for (const page of demo ? ['stage', 'panel'] : ['panel']) {
      const opener = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', 'http://localhost:' + port + '/' + page], { stdio: 'ignore', windowsHide: true });
      opener.on('error', () => note('sistem', 'Tarayıcı açılamadı. Konsoldaki bağlantıyı açabilirsin.'));
      opener.unref();
    }
  }
  if (LAN) for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) console.log(`  Telefondan     : http://${a.address}:${port}/stage`);
  journal.event('acilis', { build: BUILD, tts: tts.provider, questions: bank.items.length });
  host.warm().then((n) => { if (n) note('ses', `${n} replik önceden seslendirildi`); });
  connect();   // dış kaynak tanımlıysa bağlanır (provada beklemez)
});
