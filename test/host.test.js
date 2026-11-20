// Bil Bakalım: sunucunun beyni (yönetmen), serbest sohbet, içerik bankalarının denetimi ve sunucu uçları.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHost } from '../server/host.js';
import { createAi, vet, SYSTEM, DEFAULT_MODEL } from '../server/ai.js';
import { loadBank } from '../server/questions.js';
import { fold } from '../server/normalize.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = { acilis: ['Hoş geldiniz'], bildiKisa: ['{ad} bildi'], bildiDevam: ['Son saniyeler'], bildiAni: ['{ad} bildi'], bildiAniAdsiz: ['İlk doğru geldi'], bildi: ['Helal {ad} {cevap} {puan}'], bildiAdsiz: ['Cevap {cevap} {puan}'],
  hosgeldin: ['Hoş geldin {ad}'], hosgeldinAdsiz: ['Hoş geldin'], hosgeldinCoklu: ['Hoş geldiniz {adlar}'], hosgeldinEski: ['{ad} yine burada {unvan}'],
  yaklasti: ['Yaklaştın {ad}'],
  'niyet.selam': ['Selam {ad}'], 'niyet.memleket': ['Selam olsun {il}'], 'niyet.puanim': ['{ad} {puan} puan {sira}. sıra'], sureBitti: ['Cevap {cevap}'], ikinciTek: ['{ad2} de bildi'],
  molaYanitSade: ['{ad} yazmış, okudum'],
  takip: ['{ad} takip etti'], cosku: ['a', 'b', 'c', 'd', 'e', 'f'], molaBasla: ['Mola'], molaSoru: ['Nereden izliyorsunuz'], molaYanit: ['{ad} diyor ki {soz}'], molaYanitAdsiz: ['Biri yazmış {soz}'],
  acilisKural: ['Erken bilen çok puan alır'], acilisDavet: ['Merhaba yazın'], acilisHazir: ['İlk soru geliyor'], molaTesekkur: ['Teşekkürler {adlar}'], takipHatirlat: ['Takipte kalın'] };
function setup(over = {}) {
  let t = 100; const says = [], spoken = [];
  const tts = { speak: async (text) => { spoken.push(text); return { name: 'a'.repeat(40) + '.wav', ms: 1000 }; }, warm: async (texts) => texts.length };
  const host = createHost({ lines: L, tts, emit: (m) => says.push(m), now: () => t, rng: () => 0, ...over });
  return { host, says, spoken, add: (d) => { t += d; } };
}
const A = { id: '1', nick: 'ayse_94' }, M = { id: '2', nick: 'Mert' }, X = { id: '3', nick: '★★' };

test('yönetmen: tek seferde tek replik; ipucu karşılamanın önüne geçer', async () => {
  const s = setup(); s.host.onFx([{ type: 'lobby' }], { phase: 'lobby' }); await s.host.idle();
  assert.deepEqual([s.says[0].kind, s.says[0].text, s.says[0].url, s.says[0].ms], ['acilis', 'Hoş geldiniz', '/tts/' + 'a'.repeat(40) + '.wav', 1000]);
  s.add(0.5); s.host.social.join(A); s.host.tick({ phase: 'intro' }); await s.host.idle(); assert.equal(s.says.length, 1, 'konuşurken yeni replik başlamaz');
  s.host.onFx([{ type: 'ask', clue: 'Ege\'nin incisi', say: 'Egenin incisi hangisi' }], { phase: 'ask' }); await s.host.idle(); assert.equal(s.says.length, 1);
  s.add(1); s.host.tick({ phase: 'ask', timeLeft: 30 }); await s.host.idle();
  assert.deepEqual([s.says[1].kind, s.says[1].text, s.says[1].gesture], ['ipucu', 'Ege\'nin incisi', 'point']); assert.ok(s.spoken.includes('Egenin incisi hangisi'), 'ipucu okunuş metniyle seslendirilir');
  s.add(1.5); s.host.tick({ phase: 'ask', timeLeft: 28 }); await s.host.idle(); assert.deepEqual([s.says[2].kind, s.says[2].text], ['hosgeldin', 'Hoş geldin Ayse']);
});
test('yönetmen: süresi geçen replik söylenmez', async () => {
  const s = setup(); s.host.onFx([{ type: 'lobby' }]); await s.host.idle();
  s.host.social.join(A); s.host.tick({ phase: 'intro' }); s.add(10); s.host.tick({ phase: 'intro' }); await s.host.idle();
  assert.equal(s.says.length, 1);
});
test('yönetmen: kazanan iki adımda; önce cevapsız, sonra cevaplı; okunamayan ad adsız replik alır', async () => {
  const s = setup(); s.host.onFx([{ type: 'solved', user: A, points: 88, streak: 1 }], { phase: 'solved' }); await s.host.idle();
  assert.equal(s.says[0].text, 'Ayse bildi'); assert.ok(!/izmir/i.test(s.says[0].text));
  s.add(5); s.host.onFx([{ type: 'answer', answer: 'İZMİR', winners: [{ user: A, rank: 1, points: 88 }, { user: M, rank: 2, points: 53 }] }, { type: 'others', count: 0 }], { phase: 'solved' }); await s.host.idle();
  assert.deepEqual([s.says[1].kind, s.says[1].text, s.says[1].emotion], ['bildi', 'Helal Ayse İzmir 88', 'excited']);
  s.add(2); s.host.tick({ phase: 'solved' }); await s.host.idle(); assert.equal(s.says[2].text, 'Mert de bildi');
  const n = setup(); n.host.onFx([{ type: 'solved', user: X, points: 100, streak: 1 }]); await n.host.idle(); assert.equal(n.says[0].text, 'İlk doğru geldi');
});
test('yönetmen: sohbet niyeti bekleme süresine uyar; puan sorusu sıralamadan okur', async () => {
  const s = setup({ standing: (id) => (id === '1' ? { points: 140, rank: 2 } : null) });
  assert.equal(s.host.onIntent(A, { intent: 'selam' }), true); await s.host.idle(); assert.equal(s.host.onIntent(A, { intent: 'selam' }), false, 'aynı kişi aynı niyeti 60 sn içinde yineleyemez');
  assert.equal(s.host.onIntent(M, { intent: 'selam' }), false, 'niyet cevapları arasında 6 sn'); s.add(7); assert.equal(s.host.onIntent(M, { intent: 'selam' }), true, 'reddedilen deneme bekleme süresini yemez'); await s.host.idle();
  s.add(7); assert.equal(s.host.onIntent(X, { intent: 'selam' }), true); await s.host.idle(); s.add(7);
  assert.equal(s.host.onIntent(A, { intent: 'memleket', il: 'Sivas' }), true); await s.host.idle(); s.add(7); assert.equal(s.host.onIntent(M, { intent: 'memleket', il: 'Sivas' }), false, 'aynı ile 2 dk içinde ikinci selam yok');
  s.add(7); assert.equal(s.host.onIntent(M, { intent: 'puanim' }), false); assert.equal(s.host.onIntent(A, { intent: 'puanim' }), true); await s.host.idle();
  const slow = setup({ tts: { speak: (text) => (text === 'Selam dostum' ? Promise.resolve({ name: 'd'.repeat(40) + '.wav', ms: 900 }) : new Promise(() => {})), warm: async () => 0 } });
  assert.equal(slow.host.onIntent(A, { intent: 'selam' }), true); await Promise.resolve(); slow.add(2.6); slow.host.tick({ phase: 'break' });
  assert.deepEqual([slow.says[0]?.text, slow.says[0]?.speech, slow.says[0]?.url], ['Selam Ayse', 'Selam dostum', '/tts/' + 'd'.repeat(40) + '.wav'], 'adlı ses yetişmezse "dostum"lu hazır ses çalar');
  const texts = s.says.map((x) => x.text); assert.ok(texts.includes('Selam Ayse')); assert.ok(texts.includes('Selam dostum'), 'adı okunamayana "dostum"'); assert.ok(texts.includes('Ayse 140 puan 2. sıra'));
});
test('yönetmen: aynı replik art arda gelmez; mola akışı teşekkür ve sohbet sorusu içerir', async () => {
  const s = setup(); for (let i = 0; i < 5; i++) s.host.social.cheer();
  assert.equal(new Set(s.spoken.slice(0, 5)).size, 5);
  const b = setup(); b.host.social.follow(A); b.host.social.follow(A); await b.host.idle(); assert.equal(b.says.filter((x) => x.kind === 'takip').length, 1, 'takip teşekkürü kişi başına bir kez');
  b.add(2); b.host.onFx([{ type: 'breakStart' }], { phase: 'break' });
  for (let i = 0; i < 18; i++) { b.add(2); b.host.tick({ phase: 'break' }); await b.host.idle(); }
  const kinds = b.says.map((x) => x.kind); assert.ok(kinds.includes('molaBasla') && kinds.includes('molaTesekkur') && kinds.includes('molaSoru') && kinds.includes('takipHatirlat'), kinds.join());
  assert.ok(kinds.indexOf('molaSoru') < kinds.indexOf('molaTesekkur'), 'sohbet sorusu molanın başında sorulur');
  assert.equal(b.says.find((x) => x.kind === 'molaTesekkur').text, 'Teşekkürler Ayse');
});

test('yönetmen: açılış süre boyunca konuşur; sohbet sorusuna gelen cevaplar adıyla karşılık bulur', async () => {
  const s = setup(); s.host.onFx([{ type: 'lobby' }], { phase: 'lobby' });
  for (let i = 0; i < 14; i++) { s.add(2); s.host.tick({ phase: 'lobby' }); await s.host.idle(); }
  assert.deepEqual(s.says.map((x) => x.kind), ['acilis', 'acilisKural', 'acilisDavet', 'acilisHazir']);
  const short = setup(); short.host.onFx([{ type: 'lobby' }], { phase: 'lobby' }); await short.host.idle();
  for (let i = 0; i < 14; i++) { short.add(2); short.host.tick({ phase: 'ask', timeLeft: 30 }); await short.host.idle(); }
  assert.deepEqual(short.says.map((x) => x.kind), ['acilis'], 'açılış kısa tutulduysa kalan anonslar soruya taşmaz');
  const b = setup(); assert.equal(b.host.listening(), false); assert.equal(b.host.onBreakAnswer(A, 'çay'), false, 'soru sorulmadan cevap anılmaz');
  b.host.onFx([{ type: 'breakStart' }], { phase: 'break' }); await b.host.idle(); b.add(4); b.host.tick({ phase: 'break' }); await b.host.idle();
  assert.equal(b.host.listening(), true); assert.equal(b.host.asked(), 'Nereden izliyorsunuz');
  b.add(3); assert.equal(b.host.onBreakAnswer(A, '  çay   içiyorum '), true); await b.host.idle(); assert.equal(b.says.at(-1).text, 'Ayse diyor ki çay içiyorum');
  assert.equal(b.host.onBreakAnswer(M, 'kahve'), false, 'cevaplar arasında 3,5 sn'); b.add(4);
  assert.equal(b.host.onBreakAnswer(A, 'bir de kek'), false, 'kişi başına bir kez'); assert.equal(b.host.onBreakAnswer(X, 'kahve'), true); await b.host.idle();
  assert.equal(b.says.at(-1).text, 'Biri yazmış kahve', 'adı okunamayan adsız anılır');
  b.add(4); assert.equal(b.host.onBreakAnswer(M, null), true, 'onaysız söz tekrar edilmez, kişi adıyla anılır'); await b.host.idle(); assert.equal(b.says.at(-1).text, 'Mert yazmış, okudum');
  b.add(60); assert.equal(b.host.listening(), false); assert.equal(b.host.onBreakAnswer(M, 'ayran'), false, 'dinleme süresi dolunca kapanır');
});

/* ---------- serbest sohbet ---------- */
test('vet: yayına uygun tek cümle', () => {
  assert.equal(vet('"Selam Ayşe, hoş geldin! 😺"'), 'Selam Ayşe, hoş geldin!'); assert.equal(vet('PAS'), null); assert.equal(vet('pas.'), null); assert.equal(vet(''), null);
  assert.equal(vet('x'.repeat(141)), null); assert.equal(vet('Bana bağış yaparsan sevinirim'), null); assert.equal(vet('Takip etmeyi unutma'), null); assert.equal(vet('kötü söz', () => true), null);
});
test('ai: istek biçimi, hız sınırı, ret, hata', async () => {
  let t = 0; const calls = [];
  const reply = (text, stop = 'end_turn') => ({ stop_reason: stop, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }] });
  const client = { beta: { messages: { create: async (req) => { calls.push(['beta', req]); return reply('Balık demezsem ayıp olur Ayse, sen ne seversin?'); } } }, messages: { create: async (req) => { calls.push(['plain', req]); return reply('x', 'refusal'); } } };
  const ai = createAi({ client, now: () => t, minGap: 25 });
  assert.equal(await ai.reply({ user: A, text: 'Tarçın en sevdiğin yemek ne?', phase: 'ask' }), 'Balık demezsem ayıp olur Ayse, sen ne seversin?');
  const [path0, req] = calls[0]; assert.equal(path0, 'beta'); assert.equal(req.model, DEFAULT_MODEL); assert.equal(req.model, 'claude-opus-5-5');
  assert.deepEqual([req.fallbacks, req.betas, req.output_config, req.system, req.thinking], ['default', ['server-side-fallback-2026-07-01'], { effort: 'low' }, SYSTEM, undefined]);
  assert.match(req.messages[0].content, /Yorum: Tarçın en sevdiğin yemek ne\?/); assert.match(req.messages[0].content, /İzleyicinin adı: Ayse/);
  assert.equal(ai.ready(), false); assert.equal(await ai.reply({ user: A, text: 'bir daha', phase: 'ask' }), null, '25 sn dolmadan ikinci istek gitmez'); assert.equal(calls.length, 1);
  const haiku = createAi({ client, model: 'claude-haiku-5-5', now: () => t }); assert.equal(await haiku.reply({ user: A, text: 'selam?', phase: 'break' }), null, 'ret cevabı söylenmez');
  assert.equal(calls[1][0], 'plain'); assert.equal(calls[1][1].fallbacks, undefined);
  const broken = createAi({ client: { beta: { messages: { create: async () => { throw new Error('ağ yok'); } } } }, now: () => t });
  assert.equal(await broken.reply({ user: A, text: 'selam?', phase: 'ask' }), null); assert.equal(broken.status().failures, 1); assert.match(broken.status().lastError, /ağ yok/);
  const off = createAi({ env: {} }); assert.equal(off.ready(), false); assert.match(off.status().lastError, /anahtar yok/);
  // Anahtar açılışta ücretsiz bir çağrıyla doğrulanır: panel "bağlı" derken gerçekten bağlıdır.
  class Auth extends Error {} class Denied extends Error {} class Missing extends Error {}
  const sdkWith = (retrieve) => async () => ({ default: Object.assign(class { constructor() { this.models = { retrieve }; this.beta = { messages: { create: async () => ({}) } }; } }, { AuthenticationError: Auth, PermissionDeniedError: Denied, NotFoundError: Missing }) });
  const good = createAi({ apiKey: 'sk-ant-deneme', env: {}, loadSdk: sdkWith(async () => ({ id: 'claude-opus-5-5' })) }); assert.equal(good.status().verified, null); await good.initialized;
  assert.deepEqual([good.status().available, good.status().verified, good.status().lastError], [true, true, null]);
  const bad = createAi({ apiKey: 'sk-ant-yanlis', env: {}, loadSdk: sdkWith(async () => { throw new Auth('401'); }) }); await bad.initialized;
  assert.deepEqual([bad.status().available, bad.status().verified, bad.status().lastError], [false, false, 'anahtar geçersiz']);
  const offline = createAi({ apiKey: 'sk-ant-deneme', env: {}, loadSdk: sdkWith(async () => { throw new Error('ağ yok'); }) }); await offline.initialized;
  assert.deepEqual([offline.status().available, offline.status().verified], [true, null], 'bağlantı yokken anahtar yanlış sayılmaz');
  assert.ok(!/cevap(ı)?: /i.test(SYSTEM) && /Para, bağış, ödül, abonelik ya da takip isteme/.test(SYSTEM));
});

/* ---------- içerik bankaları ---------- */
// Sunucu izleyiciden para ya da ödül istemez: banka ve sahne bu kalıplara karşı taranır.
const ASK = /(bagis|para (?:at|gonder|yolla)|destek ol|\bodul)/;
const KEYS = { ilkBenNot: [], 'niyet.ilkBen': [], bildiKisa: ['ad'], bildiDevam: [], molaYanitSade: ['ad'],
  acilis: [], acilisKural: [], acilisDavet: [], acilisHazir: [], molaYanit: ['ad', 'soz'], molaYanitAdsiz: ['soz'], turBasla: ['tur'], soruGeliyor: [], harfAcildi: [], sonHarfler: [], sureDoluyor: [], bildiAni: ['ad'], bildiAniAdsiz: [], bildi: ['ad', 'cevap', 'puan'], bildiAdsiz: ['cevap', 'puan'],
  bildiHizli: ['ad', 'cevap'], bildiSeri: ['ad', 'seri'], bildiIlk: ['ad'], bildiCifte: ['ad', 'puan'], ikinciler: ['ad2', 'ad3'], ikinciTek: ['ad2'], digerleri: ['n'], yaklasti: ['ad'], yanlisTakil: ['ad'],
  sureBitti: ['cevap'], unvan: ['ad', 'unvan'], rekor: ['n'], turSonu: ['tur'], sampiyon: ['ad', 'puan'], molaBasla: [], molaSoru: [], molaTesekkur: ['adlar'], takipHatirlat: [],
  hosgeldin: ['ad'], hosgeldinCoklu: ['adlar'], hosgeldinEski: ['ad', 'unvan'], hosgeldinAdsiz: [], takip: ['ad'], paylasim: ['ad'], begeni: ['ad'], cosku: [], izleyici: ['n'],
  sessiz: [],
  'niyet.selam': ['ad'], 'niyet.nasilsin': ['ad'], 'niyet.kimsin': [], 'niyet.nasilOynanir': [], 'niyet.botMusun': [], 'niyet.veda': ['ad'], 'niyet.tesekkur': ['ad'], 'niyet.iltifat': ['ad'],
  'niyet.zor': [], 'niyet.kolay': [], 'niyet.ipucu': [], 'niyet.kopya': [], 'niyet.diliminUcunda': [], 'niyet.yetisemedim': [], 'niyet.espri': [],
  'niyet.puanim': ['ad', 'puan', 'sira'], 'niyet.memleket': ['il'], 'niyet.yas': [], 'niyet.nereli': [] };
test('replik bankası: bütün olaylar var, değişkenler doğru, hiçbir cümle para ya da ödül istemiyor', () => {
  const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/data/replikler.json'), 'utf8')).olaylar;
  for (const [key, vars] of Object.entries(KEYS)) {
    const pool = bank[key]; assert.ok(Array.isArray(pool) && pool.length >= 5, key + ' en az 5 replik');
    assert.equal(new Set(pool).size, pool.length, key + ' yinelenen replik');
    for (const line of pool) {
      const used = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      assert.ok(used.every((v) => vars.includes(v)), `${key}: tanımsız değişken → ${line}`);
      assert.ok(!/\}['’]/.test(line), `${key}: değişkene ek getirilmiş → ${line}`);
      assert.ok([...line].length <= (key === 'acilis' ? 140 : 95), `${key}: uzun → ${line}`);
      assert.ok(!ASK.test(fold(line)), `${key}: para ya da ödül isteği → ${line}`);
      if (key !== 'takipHatirlat') assert.ok(!/takip et(?!ti)/.test(fold(line)), `${key}: takip isteği → ${line}`);
      if (key === 'bildiAni' || key === 'bildiAniAdsiz') assert.ok(!line.includes('{cevap}'));
    }
  }
});
test('soru bankası: hatasız yüklenir, bütün türler var', () => {
  const { items, errors } = loadBank(path.join(ROOT, 'server/data/sorular.json'));
  assert.deepEqual(errors, []); assert.ok(items.length >= 500, 'en az 500 soru: ' + items.length);
  const count = (type) => items.filter((q) => q.type === type).length;
  assert.equal(count('plaka'), 81); assert.ok(count('kelime') >= 300); assert.ok(count('atasozu') >= 40); assert.ok(count('emoji') >= 30);
  assert.ok(items.filter((q) => q.type === 'kelime' && !q.answer.includes(' ') && [...q.answer].length >= 4 && [...q.answer].length <= 8).length >= 100, 'karışık harf sorusuna uygun kelime');
  for (const q of items) assert.ok(!ASK.test(fold(q.clue + ' ' + (q.fact || ''))), q.id);
});
test('sahne: ekranda para ya da ödül isteği yok', { skip: !fs.existsSync(path.join(ROOT, 'public/main.js')) }, () => {
  for (const name of fs.readdirSync(path.join(ROOT, 'public'))) {
    if (!/\.(js|html|css)$/.test(name) || name === 'panel.html') continue;
    const source = fs.readFileSync(path.join(ROOT, 'public', name), 'utf8');
    const text = fold(source.replace(/\/\*[\s\S]*?\*\/|<!--[^]*?-->|^\s*\/\/.*$/gm, ''));
    assert.ok(!ASK.test(text), name + ': para ya da ödül isteği');
  }
});

/* ---------- sunucu ---------- */
test('sunucu: prova açılır, uçlar çalışır, deneme olayları işlenir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bil-'));
  const child = spawn(process.execPath, ['server/server.js', '--demo'], { cwd: ROOT, env: { ...process.env, PORT: '0', DATA_DIR: dir, SHOW_TTS: 'off', ANTHROPIC_API_KEY: '', LAN: '' } });
  try {
    const base = await new Promise((resolve, reject) => {
      let out = ''; const timer = setTimeout(() => reject(new Error('sunucu açılmadı: ' + out)), 15000);
      child.stdout.on('data', (d) => { out += d; const m = /http:\/\/localhost:(\d+)\/panel/.exec(out); if (m) { clearTimeout(timer); resolve('http://127.0.0.1:' + m[1]); } });
      child.stderr.on('data', (d) => { out += d; }); child.on('exit', (c) => reject(new Error('sunucu kapandı ' + c + ': ' + out)));
    });
    const boot = await (await fetch(base + '/api/boot')).json(); assert.deepEqual([boot.mode, boot.demo, boot.title, boot.host.name], ['show', true, 'Bil Bakalım', 'Tarçın']);
    const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post('/api/sim', { type: 'join', nick: 'Deneme' })).status, 200); assert.equal((await post('/api/sim', { type: 'like', nick: 'Deneme', count: 20 })).status, 200);
    assert.equal((await post('/api/sim', { type: 'yok' })).status, 400); assert.equal((await post('/api/cmd', { type: 'settings', volumes: { music: 0.1 }, spokenFacts: false })).status, 200);
    await new Promise((r) => setTimeout(r, 400));
    const state = await (await fetch(base + '/api/state')).json();
    assert.ok(['lobby', 'intro', 'ask'].includes(state.phase)); assert.equal(state.settings.volumes.music, 0.1); assert.equal(state.settings.spokenFacts, false); assert.equal(state.tts.provider, 'off');
    assert.ok(state.bank.count >= 500); assert.equal(state.ai.available, false); assert.ok(!JSON.stringify(state).includes('answer'), 'durumda cevap alanı yok');
    await new Promise((r) => setTimeout(r, 9000));   // açılış sürerken bir süre geçsin
    const before = await (await fetch(base + '/api/state')).json(); assert.equal(before.phase, 'lobby'); assert.ok(before.timeLeft < 22, 'açılış ilerledi: ' + before.timeLeft);
    assert.equal((await post('/api/cmd', { type: 'restart' })).status, 200);
    await new Promise((r) => setTimeout(r, 400));
    const again = await (await fetch(base + '/api/state')).json(); assert.equal(again.phase, 'lobby'); assert.ok(again.timeLeft > 28, 'şov açılıştan yeniden başladı: ' + again.timeLeft);
    assert.ok(again.log.some((l) => /açılıştan başlatıldı/.test(l.text)));
    assert.equal((await fetch(base + '/tts/../config.json')).status, 404); assert.equal((await fetch(base + '/tts/' + 'a'.repeat(40) + '.wav')).status, 404);
    if (fs.existsSync(path.join(ROOT, 'public/index.html'))) assert.equal((await fetch(base + '/stage')).status, 200);
    assert.ok(!fs.existsSync(path.join(dir, 'show-players.json')), 'prova verisi diske yazılmaz');
  } finally { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ipucu hazırlanırken soru biterse eski ipucu seslendirilmez', async () => {
  let resolveClue;
  const pending = new Promise(resolve => { resolveClue = resolve; });
  const s = setup({ tts: { speak: text => text === 'Bir ipucu' ? pending : Promise.resolve(null) } });
  s.host.onFx([{ type: 'ask', clue: 'Bir ipucu', say: 'Bir ipucu' }], { phase: 'ask' });
  s.host.onFx([{ type: 'timeout', answer: 'ÇAY' }], { phase: 'timeout' });
  resolveClue({ name: 'old.wav', ms: 2400 });
  await s.host.idle();
  s.host.tick({ phase: 'timeout' });
  await s.host.idle();
  assert.deepEqual(s.says.map(m => m.kind), ['sureBitti']);
});
