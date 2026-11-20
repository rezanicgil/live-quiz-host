import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createSound } from '../public/sound.js';
import { createHost } from '../server/host.js';
import { createTts } from '../server/tts.js';

// Konuşma sırası testleri: saat elle ilerler, her ses isteği test istediğinde (ya da hiç) sonuçlanır.
const REZAN = { id: '1', nick: 'Rezan' }, MERT = { id: '2', nick: 'Mert' }, ECE = { id: '3', nick: 'Ece' };
const BANK = { takip: ['Teşekkürler {ad}!'], paylasim: ['{ad} paylaştı!'], bildiKisa: ['{ad} bildi!'], 'niyet.selam': ['Selam {ad}!'], cosku: ['Harikasınız!'] };
function stage({ provider = 'pocket', lines = BANK, ...over } = {}) {
  let t = 100, voice = 'female_2';
  const events = [], calls = [], extras = [], warmed = [];   // extras: yedek ses istekleri (ana replik isteklerinden ayrı tutulur)
  const tts = { provider, status: () => ({ provider, voice, pocketVoice: voice, delivery: 'presenter' }),
    speak(text, options) {
      let resolve; const promise = new Promise((r) => { resolve = r; });
      (options?.fallback ? extras : calls).push({ text, options, start: () => options.onStart?.(), clip: (ms = 1000, extra = {}) => resolve({ name: 'c'.repeat(40) + '.wav', ms, provider, voice, ...extra }), fail: () => resolve(null) });
      return promise;
    },
    warm: async (list, options) => { warmed.push({ list, signal: options?.signal }); return list.length; } };
  const host = createHost({ lines, tts, now: () => t, rng: () => 0, emit: (m) => events.push(m), ...over });
  const settle = () => new Promise((r) => setImmediate(r)); // bekleyen söz zincirleri bitsin
  return { host, events, calls, extras, warmed, settle, add: (s) => { t += s; }, setVoice: (v) => { voice = v; }, call: (text) => calls.find((c) => c.text === text),
    tick: async (phase = 'lobby') => { host.tick({ phase, timeLeft: 30 }); await settle(); } };
}

test('sıra: sesi hazır olan replik, sesi geciken daha öncelikliyi beklemeden söylenir; her replik sıraya girince üretilmeye başlar', async () => {
  const s = stage();
  s.host.social.follow(REZAN);                      // öncelik 3, sesi gecikiyor
  s.host.onIntent(MERT, { intent: 'selam' });       // öncelik 2
  await s.settle();
  assert.deepEqual(s.calls.map((c) => [c.text, c.options.priority]), [['Teşekkürler Rezan!', 3], ['Selam Mert!', 2]], 'ikisi de hemen istenir, önceliğiyle');
  assert.ok(s.calls.every((c) => c.options.signal instanceof AbortSignal));
  assert.equal(s.events.length, 0, 'ikisi de hazır değil, payları da dolmadı');
  s.call('Selam Mert!').clip(900); await s.settle();
  assert.deepEqual(s.events.map((e) => [e.kind, e.url, e.waited]), [['niyet', '/tts/' + 'c'.repeat(40) + '.wav', 0]], 'hazır olan düşük öncelikli replik öne geçti');
  s.call('Teşekkürler Rezan!').clip(1200); await s.settle();
  assert.equal(s.events.length, 1, 'konuşurken yeni replik başlamaz');
  s.add(1.2); await s.tick();
  assert.deepEqual([s.events[1].text, s.events[1].speech, s.events[1].speechProvider, s.events[1].voice], ['Teşekkürler Rezan!', 'Teşekkürler Rezan!', 'pocket', 'female_2'], 'bu arada hazırlanan replik kendi sesiyle söylenir');
});

test('sıra: sesi geciken replik payı dolunca hazır kısa kayıtla söylenir, sonradan gelen ses yeniden çalınmaz (iki Pocket sesi)', async () => {
  for (const voice of ['female_2', 'male_2']) {
    const s = stage(); s.setVoice(voice);
    s.host.social.follow(REZAN);
    s.add(2.4); await s.tick();
    assert.equal(s.events.length, 0, 'pay (2,5 sn) dolmadan vazgeçilmez');
    s.add(0.2); await s.tick();
    const [event] = s.events;
    assert.deepEqual([event.text, event.speech, event.url, event.allowSystemVoice, event.speechProvider, event.voice],
      ['Teşekkürler Rezan!', 'Takibin için teşekkür ederim!', '/tarcin-' + voice + '-takip.wav', false, 'pocket', voice]);
    assert.ok(event.waited >= 2500 && event.waited <= 2700, 'sırada replik varken sessiz geçen süre iletide: ' + event.waited);
    assert.equal(s.calls[0].options.signal.aborted, true, 'artık gerekmeyen ses isteği iptal edilir');
    s.calls[0].clip(1500); await s.settle(); s.add(5); await s.tick(); s.add(5); await s.tick();
    assert.equal(s.events.length, 1, 'geciken ses sonradan çalınmaz');
  }
});

test('sıra: öncelik 5 replik en çok ~1,2 sn beklenir; o beklerken onu süresinden edecek replik araya girmez', async () => {
  const s = stage();
  s.host.onFx([{ type: 'solved', user: REZAN, points: 80, streak: 1 }], { phase: 'solved' });   // "bildi" anı: öncelik 5, ömrü 3 sn
  s.host.social.follow(MERT);
  s.call('Teşekkürler Mert!').clip(4000); await s.settle();
  assert.equal(s.events.length, 0, '4 sn\'lik teşekkür şimdi başlarsa "bildi" anı kaçar: beklenir');
  s.add(1.1); await s.tick('solved');
  assert.equal(s.events.length, 0);
  s.add(0.2); await s.tick('solved');
  assert.deepEqual([s.events[0].kind, s.events[0].text, s.events[0].url, s.events[0].speech], ['bildiAni', 'Rezan bildi!', '/tarcin-female_2-bildiAni.wav', 'Bildin, tebrikler!']);
  assert.ok(s.events[0].waited >= 1200 && s.events[0].waited <= 1400, String(s.events[0].waited));
  s.add(2.1); await s.tick('solved');
  assert.deepEqual([s.events[1].kind, s.events[1].url], ['takip', '/tts/' + 'c'.repeat(40) + '.wav'], 'bekleyen teşekkür ardından kendi sesiyle');

  // Sesi zamanında gelen "bildi" anı beklemeden kendi sesiyle söylenir.
  const fast = stage();
  fast.host.onFx([{ type: 'solved', user: ECE, points: 80, streak: 1 }], { phase: 'solved' });
  fast.add(0.6); fast.calls[0].clip(1700); await fast.settle();
  assert.deepEqual([fast.events[0].text, fast.events[0].speech, fast.events[0].url], ['Ece bildi!', 'Ece bildi!', '/tts/' + 'c'.repeat(40) + '.wav']);
  // Ömrü uzun bir replik sesini beklerken hazır olan kısa replik öne geçebilir: bekleyen yine söylenir.
  const calm = stage();
  calm.host.social.share(REZAN);                                   // öncelik 3, ömrü 10 sn, sesi gecikiyor
  calm.host.onIntent(MERT, { intent: 'selam' }); calm.call('Selam Mert!').clip(1500); await calm.settle();
  assert.equal(calm.events[0].kind, 'niyet');
  calm.call('Rezan paylaştı!').clip(2000); calm.add(1.8); await calm.tick();
  assert.deepEqual([calm.events[1].kind, calm.events[1].speech], ['paylasim', 'Rezan paylaştı!']);
});

test('sıra: ipucu hazırsa kendi sesiyle, ~2 sn içinde gelmezse sessiz ama mutlaka gösterilir', async () => {
  const s = stage();
  s.host.onFx([{ type: 'ask', clue: 'Ege\'nin incisi', say: 'Egenin incisi hangisi' }], { phase: 'ask' });
  assert.deepEqual([s.calls[0].text, s.calls[0].options.priority, s.calls[0].options.emotion], ['Egenin incisi hangisi', 5, 'neutral']);
  s.add(1.9); await s.tick('ask');
  assert.equal(s.events.length, 0);
  s.add(0.2); await s.tick('ask');
  assert.deepEqual([s.events[0].kind, s.events[0].text, s.events[0].url, s.events[0].speechProvider, s.events[0].voiceEnabled], ['ipucu', 'Ege\'nin incisi', null, null, true], 'ipucu düşmez, alt yazıyla gösterilir');
  s.calls[0].clip(2400); await s.settle(); s.add(6); await s.tick('ask');
  assert.equal(s.events.length, 1);

  const ready = stage();
  ready.host.onFx([{ type: 'ask', clue: 'Çay demlenir', say: 'Çay nerede demlenir' }], { phase: 'ask' });
  ready.calls[0].clip(2400); await ready.settle();
  assert.deepEqual([ready.events[0].kind, ready.events[0].url, ready.events[0].ms, ready.events[0].waited], ['ipucu', '/tts/' + 'c'.repeat(40) + '.wav', 2400, 0]);

  // Sesi geciken teşekkür ipucunu bekletmez: ipucu sırası gelince hemen okunur (eskiden 10 sn'ye kadar tıkanırdı).
  const busy = stage();
  busy.host.social.follow(REZAN);
  busy.add(1); await busy.tick('intro');
  busy.host.onFx([{ type: 'ask', clue: 'Karadeniz\'in çayı', say: 'Karadenizin çayı' }], { phase: 'ask' });
  busy.call('Karadenizin çayı').clip(2000); await busy.settle();
  assert.deepEqual(busy.events.map((e) => e.kind), ['ipucu'], 'hazır ipucu, sesi gelmeyen teşekkürü beklemez');
});

test('sıra: sesi o an üretilen replik için sınırlı ek süre beklenir; üretimi başlamamış ya da yetişmeyecek replik payında bırakılır', async () => {
  // "bildi" anı: pay 1,2 sn, üretim başlamışsa en çok 2,2 sn.
  const s = stage();
  s.host.onFx([{ type: 'solved', user: REZAN, points: 80, streak: 1 }], { phase: 'solved' });
  s.add(0.2); s.calls[0].start();                      // işçi repliği üretmeye başladı
  s.add(1.1); await s.tick('solved');                  // 1,3 sn: pay doldu ama ses yolda
  assert.equal(s.events.length, 0, 'yoldaki ses için beklenir');
  s.add(0.4); s.calls[0].clip(1700); await s.settle(); // 1,7 sn'de geldi
  assert.deepEqual([s.events[0].speech, s.events[0].url, s.events[0].waited], ['Rezan bildi!', '/tts/' + 'c'.repeat(40) + '.wav', 1700]);
  assert.equal(s.calls[0].options.signal.aborted, false);

  const never = stage();                               // üretim başladı ama ses hiç gelmedi: ek süre de sınırlı
  never.host.onFx([{ type: 'solved', user: REZAN, points: 80, streak: 1 }], { phase: 'solved' });
  never.calls[0].start();
  never.add(2.1); await never.tick('solved');
  assert.equal(never.events.length, 0);
  never.add(0.2); await never.tick('solved');          // 2,3 sn > 2,2 sn
  assert.deepEqual([never.events[0].url, never.events[0].speech], ['/tarcin-female_2-bildiAni.wav', 'Bildin, tebrikler!']);

  const queued = stage();                              // üretim hiç başlamadı (işçi başka işte): pay dolunca beklenmez
  queued.host.onFx([{ type: 'solved', user: REZAN, points: 80, streak: 1 }], { phase: 'solved' });
  queued.add(1.25); await queued.tick('solved');
  assert.equal(queued.events[0].url, '/tarcin-female_2-bildiAni.wav');

  const long = stage({ lines: { ...BANK, bildiKisa: ['{ad} bildi! ' + 'Çok uzun bir cümle bu. '.repeat(8)] } });   // ölçülen hıza göre ek süreye sığmaz
  long.host.onFx([{ type: 'solved', user: REZAN, points: 80, streak: 1 }], { phase: 'solved' });
  long.calls[0].start();
  long.add(1.25); await long.tick('solved');
  assert.equal(long.events[0].url, '/tarcin-female_2-bildiAni.wav', 'yetişmeyecek ses boşuna beklenmez');

  // Sunucu konuşurken sıraya giren replik: sunucu boşaldığında sesi yoldaysa, payı dolmuş olsa da kısa süre beklenir.
  const busy = stage();
  busy.host.social.follow(REZAN); busy.calls[0].clip(1750); await busy.settle();        // 100 → 102,0 arası konuşuyor
  busy.add(0.1); busy.host.social.share(MERT);                                          // 100,1'de sırada; payı 102,6'da dolar
  busy.add(0.9); busy.call('Mert paylaştı!').start();
  busy.add(1.7); await busy.tick();                                                      // 102,7: pay doldu, ses yolda
  assert.equal(busy.events.length, 1);
  busy.add(0.8); busy.call('Mert paylaştı!').clip(1400); await busy.settle();            // 103,5'te geldi
  assert.deepEqual([busy.events[1].speech, busy.events[1].url], ['Mert paylaştı!', '/tts/' + 'c'.repeat(40) + '.wav']);
  assert.ok(busy.events[1].waited >= 700 && busy.events[1].waited <= 1600, String(busy.events[1].waited));
});

test('sıra: sırada replik varken sunucu en çok 2,5 sn (ipucu beklerken 2 sn) susar; paylar art arda eklenmez', async () => {
  // X'in payı dolarken yeni gelen öncelik 5 replik Y sırasını korumak ister: üst sınır dolduğu için X bekletilmez.
  const s = stage();
  s.host.social.follow(REZAN);                                              // X: 100'de sırada, sesi gelmiyor
  s.add(2.0); s.host.custom('Önemli bir duyuru var', { priority: 5, ttl: 8 }); // Y: 102'de sırada, hazır kaydı yok
  s.add(0.4); await s.tick();
  assert.equal(s.events.length, 0, '2,4 sn: X\'in payı dolmadı');
  s.add(0.15); await s.tick();                                              // 102,55: üst sınır doldu
  assert.deepEqual([s.events[0].kind, s.events[0].url, s.events[0].waited], ['takip', '/tarcin-female_2-takip.wav', 2550], 'Y\'nin 1,2 sn\'lik sıra hakkı sessizliği uzatmaz');

  // Sessiz söylemek son çare: sırada sesi hazır başka replik yoksa ve bu repliğin sesi üretilmekteyse 4,5 sn'ye kadar beklenir.
  const idle = stage();
  idle.host.custom('Bu cümlenin sesi bir türlü gelmiyor', { priority: 2, ttl: 9 });
  idle.calls[0].start();
  idle.add(2.55); await idle.tick();
  assert.equal(idle.events.length, 0, 'ses yolda, başka hazır replik yok: 2,5 sn\'de sessiz söylenmez');
  idle.add(2.0); await idle.tick();
  assert.deepEqual([idle.events[0].kind, idle.events[0].url, idle.events[0].speech, idle.events[0].waited], ['sohbet', null, 'Bu cümlenin sesi bir türlü gelmiyor', 4550]);
  assert.equal(idle.calls[0].options.signal.aborted, true);

  // Sesi gecikirken sırada sesi hazır başka replik varsa önce o söylenir (sessiz alt yazı yerine).
  const swap = stage();
  swap.host.custom('Bu cümlenin sesi gecikiyor', { priority: 3, ttl: 9 });
  swap.calls[0].start();
  swap.add(0.5); swap.host.custom('Hazır cümle', { priority: 2, ttl: 9 }); swap.calls[1].clip(900);
  swap.add(2.1); await swap.tick();
  assert.deepEqual([swap.events[0]?.text, swap.events[0]?.url != null], ['Hazır cümle', true]);

  // Yeni gelen ipucu, başka bir repliğin biriktirdiği bekleme yüzünden sessiz geçilmez; sesi gelince kendi sesiyle okunur.
  const late = stage();
  late.host.custom('Sesi gelmeyen cümle', { priority: 2, ttl: 9 }); late.calls[0].start();
  late.add(2.2); await late.tick('intro');
  late.host.onFx([{ type: 'ask', clue: 'İpucu', say: 'İpucu oku' }], { phase: 'ask' }); await late.tick('ask');
  assert.equal(late.events.length, 0, 'ipucu sıraya girer girmez sessiz geçilmez');
  late.call('İpucu oku').clip(1500); await late.settle();
  assert.deepEqual([late.events[0].kind, late.events[0].url != null], ['ipucu', true]);

  // İpucu beklerken sınır 2 sn: sesi yolda olsa da ipucu 2 sn'de gösterilir.
  const clue = stage();
  clue.host.onFx([{ type: 'ask', clue: 'Ege\'nin incisi', say: 'Egenin incisi hangisi' }], { phase: 'ask' });
  clue.calls[0].start();
  clue.add(1.9); await clue.tick('ask');
  assert.equal(clue.events.length, 0);
  clue.add(0.15); await clue.tick('ask');
  assert.deepEqual([clue.events[0].kind, clue.events[0].url], ['ipucu', null]);
  // Tarayıcı sesiyle çalışan sağlayıcılarda (local/azure) sınır 1,5 sn'dir.
  const local = stage({ provider: 'local' });
  local.host.social.follow(REZAN);
  local.add(1.4); await local.tick();
  assert.equal(local.events.length, 0);
  local.add(0.15); await local.tick();
  assert.deepEqual([local.events[0].url, local.events[0].allowSystemVoice, local.events[0].speech], [null, true, 'Teşekkürler Rezan!']);
});

test('sıra: süresi dolan ya da sıradan çıkarılan repliğin ses isteği iptal edilir', async () => {
  const s = stage();
  s.host.social.follow(REZAN); s.calls[0].clip(8000); await s.settle();      // sunucu 8 sn konuşacak
  assert.equal(s.events.length, 1);
  s.host.onIntent(MERT, { intent: 'selam' });                                  // açılışta ömrü 12 sn
  s.host.social.cheer();                                                       // öncelik 3, ömrü 5 sn
  await s.tick();
  assert.deepEqual(s.calls.slice(1).map((c) => c.options.signal.aborted), [false, false]);
  s.add(6); await s.tick();
  assert.equal(s.call('Harikasınız!').options.signal.aborted, true, 'süresi dolan');
  assert.equal(s.call('Selam Mert!').options.signal.aborted, false);
  s.host.onFx([{ type: 'solved', user: ECE, points: 50, streak: 1 }], { phase: 'solved' });   // öncelik 2 ve altını sıradan çıkarır
  await s.settle();
  assert.equal(s.call('Selam Mert!').options.signal.aborted, true, 'sıradan çıkarılan');
  assert.equal(s.call('Ece bildi!').options.signal.aborted, false);
});

test('sıra: Pocket seçiliyken yedek sesle (Windows) gelen kayıt çalınır; öbür Pocket sesiyle gelen kayıt çalınmaz', async () => {
  const s = stage();
  s.host.social.follow(REZAN); s.calls[0].clip(1000, { provider: 'local', voice: 'tr-TR' }); await s.settle();
  assert.deepEqual([s.events[0].url, s.events[0].speechProvider, s.events[0].voice, s.events[0].speech, s.events[0].allowSystemVoice], ['/tts/' + 'c'.repeat(40) + '.wav', 'local', 'tr-TR', 'Teşekkürler Rezan!', false]);
  s.add(2); s.host.social.follow(MERT); s.setVoice('male_2');                   // ses panelden değişti; istek eski sesle gitmişti
  s.calls[1].clip(1000, { provider: 'pocket', voice: 'female_2' }); await s.settle();
  assert.deepEqual([s.events[1].url, s.events[1].voice], ['/tarcin-male_2-takip.wav', 'male_2']);
  // Eski tip sonuç (provider/voice alanı yok): istek anındaki seçili sesle üretilmiş sayılır.
  const legacy = stage();
  legacy.host.social.follow(REZAN); legacy.calls[0].clip(1000, { provider: undefined, voice: undefined }); await legacy.settle();
  assert.equal(legacy.events[0].url, '/tts/' + 'c'.repeat(40) + '.wav');
});

test('ön seslendirme: açılışta gerekenler önce; aynı ses için yinelenmez, ses değişince yeniden başlar', async () => {
  const lines = { 'niyet.kimsin': ['Ben Tarçın'], hosgeldinAdsiz: ['Hoş geldin'], molaSoru: ['Nereden izliyorsunuz'], molaBasla: ['Mola'], sureDoluyor: ['Süre doluyor'], bildiAniAdsiz: ['İlk doğru geldi'],
    soruGeliyor: ['Soru geliyor'], acilisKural: ['Erken bilen çok alır'], takip: ['{ad} takip etti'], acilis: ['Selam millet'], cosku: ['Harikasınız'] };
  const s = stage({ lines });
  assert.equal(await s.host.warm(), 10);
  assert.deepEqual(s.warmed[0].list.map((x) => x.text), ['Erken bilen çok alır', 'Selam millet', 'Soru geliyor', 'İlk doğru geldi', 'Süre doluyor', 'Mola', 'Nereden izliyorsunuz', 'Ben Tarçın', 'Hoş geldin', 'Harikasınız']);
  const emotion = Object.fromEntries(s.warmed[0].list.map((x) => [x.text, x.emotion]));
  assert.deepEqual([emotion['İlk doğru geldi'], emotion['Hoş geldin'], emotion['Süre doluyor'], emotion['Ben Tarçın'], emotion['Soru geliyor']], ['excited', 'happy', 'wow', 'happy', 'neutral'], 'canlıda istenen duyguyla');
  assert.equal(await s.host.warm(), 10);
  assert.equal(s.warmed.length, 1, 'aynı ses ve anlatım için yeni iş başlamaz');
  s.setVoice('male_2');
  assert.equal(await s.host.warm(), 10);
  assert.equal(s.warmed.length, 2);
  assert.equal(s.warmed[0].signal.aborted, true, 'eski sesin kalan işleri bırakılır');
  assert.equal(s.warmed[1].signal.aborted, false);
});

test('uçtan uca (sahte işçilerle gerçek tts.js): Pocket ölünce sunucu Windows sesiyle konuşur, Pocket dönünce ona geçer', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-speech-'));
  fs.mkdirSync(path.join(dir, 'pocket/venv/Scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pocket/ready-v1'), '');
  const wav = (ms) => { const data = Buffer.alloc(32 * ms), b = Buffer.alloc(44); b.write('RIFF', 0); b.writeUInt32LE(36 + data.length, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(data.length, 40); return Buffer.concat([b, data]); };
  let pocketAlive = true;
  const starts = { python: 0, shell: 0 };
  const spawnImpl = (cmd) => { // tts.js'in işçi protokolünü konuşan en küçük sahte süreç
    const python = /python/i.test(cmd), child = new EventEmitter();
    starts[python ? 'python' : 'shell']++;
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    let dead = false;
    const die = () => { if (!dead) { dead = true; setImmediate(() => child.emit('exit', 1)); } };
    const out = (o) => setImmediate(() => { if (!dead) child.stdout.emit('data', Buffer.from(JSON.stringify(o) + '\n')); });
    child.kill = die; child.stdin.end = () => {};
    child.stdin.write = (line) => {
      const job = JSON.parse(line);
      if (python && !pocketAlive) { die(); return true; }
      fs.writeFileSync(job.file, wav(python ? 900 : 500));
      out({ id: job.id, ok: true, n: job.ssml?.length });
      return true;
    };
    if (python && !pocketAlive) die(); else out({ ready: true, voice: python ? 'Pocket TTS Turkish' : 'Sahte Tolga' });
    return child;
  };
  const tts = createTts({ pocketDir: path.join(dir, 'pocket'), cacheDir: path.join(dir, 'cache'), spawnImpl, env: {}, platform: 'win32', timings: { restart: 5, backoff: [40] } });
  t.after(() => { tts.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const until = async (check) => { const end = Date.now() + 3000; while (!check()) { if (Date.now() > end) throw new Error('beklenen durum oluşmadı'); await new Promise((r) => setTimeout(r, 2)); } };
  let now = 100;
  const events = [];
  const host = createHost({ lines: BANK, tts, now: () => now, rng: () => 0, emit: (m) => events.push(m) });
  await until(() => tts.status().ready);

  host.social.follow(REZAN); await until(() => events.length === 1);
  assert.deepEqual([events[0].speechProvider, events[0].voice, events[0].ms], ['pocket', 'female_2', 900]);
  pocketAlive = false; now += 10;
  host.social.follow(MERT); await until(() => events.length === 2);                 // işçi tam bu replikte ölür
  assert.deepEqual([events[1].text, events[1].speech, events[1].speechProvider, events[1].ms, events[1].allowSystemVoice], ['Teşekkürler Mert!', 'Teşekkürler Mert!', 'local', 500, false], 'replik kaybolmadı: Windows sesiyle söylendi');
  assert.match(events[1].url, /^\/tts\/[0-9a-f]{40}\.wav$/);
  assert.ok(fs.existsSync(path.join(dir, 'cache', events[1].url.slice(5))));
  assert.deepEqual([tts.status().active, tts.status().fallback, tts.provider], ['local', true, 'pocket']);
  now += 10; host.social.share(ECE); await until(() => events.length === 3);
  assert.equal(events[2].speechProvider, 'local');
  pocketAlive = true;
  await until(() => tts.status().active === 'pocket' && tts.status().ready);
  now += 10; host.onIntent(REZAN, { intent: 'selam' }); await until(() => events.length === 4);
  assert.deepEqual([events[3].speechProvider, events[3].voice, tts.status().fallback], ['pocket', 'female_2', false], 'Pocket dönünce yeni replikler yine onunla');
  assert.ok(starts.python >= 3 && starts.shell === 1, JSON.stringify(starts));
  assert.equal(new Set(events.map((e) => e.url)).size, 4, 'iki sesin kayıtları ayrı dosyalarda');
});

test('sohbet için ses üretilemediğinde başka bir cümle veya ses kullanılmaz', async () => {
  const events = [];
  const tts = { provider:'pocket', status:()=>({voice:'female_2'}), speak:async()=>null };
  const host = createHost({lines:{},tts,now:()=>1,emit:m=>events.push(m)});
  host.custom('Merhaba Rezan!');
  await host.idle();
  assert.equal(events[0].speech, 'Merhaba Rezan!');
  assert.equal(events[0].url, null);
  assert.equal(events[0].allowSystemVoice, false);
});

test('sahne: eksik kayıtta repliği Türkçe okur, iptal eder ve ses kapalıyken okumaz', async t => {
  const spoken = [], tr = { lang:'tr-TR', localService:true };
  let cancellations = 0;
  const synth = { getVoices:()=>[{lang:'en-US',localService:true},tr], speak:u=>spoken.push(u), cancel:()=>cancellations++ };
  const oldWindow=globalThis.window;
  globalThis.window={speechSynthesis:synth,SpeechSynthesisUtterance:class {constructor(text){this.text=text;}}};
  t.after(()=>{ if (oldWindow === undefined) delete globalThis.window; else globalThis.window=oldWindow; });
  const sound=createSound();
  sound.say({text:'Yalnız Pocket'}).stop();
  assert.equal(spoken.length,0);
  const first=sound.say({text:'Rezan, takibin için teşekkürler!',allowSystemVoice:true});
  assert.equal(spoken[0].text,'Rezan, takibin için teşekkürler!');
  assert.equal(spoken[0].voice,tr);
  const next=sound.say({text:'Bildin!',allowSystemVoice:true});
  await first.done; assert.equal(cancellations,1);
  sound.setVolumes({voice:0}); await next.done;
  assert.equal(cancellations,2);
  sound.say({text:'Sessiz'}).stop();
  sound.setVolumes({voice:1});
  sound.say({text:'Kapalı',voiceEnabled:false}).stop();
  assert.equal(spoken.length,2);
});
