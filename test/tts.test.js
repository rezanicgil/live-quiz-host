import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { wavInfo, prosodyFor, buildSsml, cacheKey, createTts } from '../server/tts.js';

// ---------------------------------------------------------------------------------------------------------------------
// Yardımcılar: sahte WAV, sahte PowerShell işçisi, sahte fetch. Gerçek ses yalnız en sondaki tek testte kullanılır.

function chunk(id, payload) {
  const head = Buffer.alloc(8);
  head.write(id, 0, 'latin1');
  head.writeUInt32LE(payload.length, 4);
  return Buffer.concat([head, payload, Buffer.alloc(payload.length & 1)]); // tek uzunluk bir dolgu baytı alır
}

function makeWav({ ms = 500, sampleRate = 16000, channels = 1, bits = 16, tag = 1, fmtSize = 16, before = [], declared } = {}) {
  const fmt = Buffer.alloc(fmtSize);
  fmt.writeUInt16LE(tag, 0); fmt.writeUInt16LE(channels, 2); fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * channels * bits / 8, 8); fmt.writeUInt16LE(channels * bits / 8, 12); fmt.writeUInt16LE(bits, 14);
  const data = chunk('data', Buffer.alloc(Math.round(sampleRate * channels * (bits / 8) * ms / 1000)));
  if (declared !== undefined) data.writeUInt32LE(declared, 4);
  const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), chunk('fmt ', fmt), ...before, data]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'latin1');
  riff.writeUInt32LE(declared === undefined ? body.length : declared, 4);
  return Buffer.concat([riff, body]);
}

const textOf = (ssml) => ssml.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tick = (ms = 2) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeout = 3000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error('beklenen durum oluşmadı');
    await tick();
  }
}

/**
 * tts-local.ps1 yerine geçen sahte işçi. `behave(request, index)` → 'ok' | 'die' | 'hang' | 'garbage' | {ok:false, err} | {n}.
 * `manual: true` ise yanıtlar `release()` çağrılana kadar bekletilir (sıra testleri zamana bağlı olmasın).
 */
function fakeWorker({ ready = { ready: true, voice: 'Sahte Tolga' }, behave = () => 'ok', manual = false, wavMs = 700 } = {}) {
  const calls = { spawns: [], requests: [], children: [] };
  const held = [];
  function spawnImpl(command, args, options) {
    calls.spawns.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.dead = false;
    const emit = (object) => { if (!child.dead) child.stdout.emit('data', Buffer.from(JSON.stringify(object) + '\n')); };
    child.die = (code = 1) => {
      if (child.dead) return;
      child.dead = true;
      setImmediate(() => child.emit('exit', code));
    };
    child.kill = () => { child.die(null); return true; };
    let pending = '';
    child.stdin.end = () => {};
    child.stdin.write = (piece) => {
      pending += piece;
      for (let i = pending.indexOf('\n'); i >= 0; i = pending.indexOf('\n')) {
        const line = pending.slice(0, i);
        pending = pending.slice(i + 1);
        const request = JSON.parse(line);
        const index = calls.requests.push({ ...request, line, text: request.text ?? textOf(request.ssml) });
        const mode = behave(request, index);
        if (mode === 'die') { child.die(1); continue; }
        if (mode === 'hang') continue;
        const answer = () => {
          if (child.dead) return;
          if (mode && mode.ok === false) { emit({ id: request.id, ...mode }); return; }
          fs.writeFileSync(request.file, mode === 'garbage' ? Buffer.from('bu bir ses dosyası değil') : makeWav({ ms: wavMs }));
          emit({ id: request.id, ok: true, ms: wavMs, n: request.ssml?.length, ...(typeof mode === 'object' ? mode : {}) });
        };
        if (manual) held.push(answer); else setImmediate(answer);
      }
      return true;
    };
    calls.children.push(child);
    if (ready) setImmediate(() => emit(ready));
    return child;
  }
  return { spawnImpl, calls, held, release: () => held.shift()?.() };
}

function fakeFetch(respond) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return respond(calls.length, url, init);
  };
  return { fetchImpl, calls };
}

const KEY = 'gizli-anahtar-0123456789abcdef';
const PINNED_KEY = 'af473c818cb35b2489feee882938b108392b2e29'; // cacheKey({local, tr-TR, neutral, 'Merhaba, ben Tarçın!'})
const AZURE_ENV = { AZURE_SPEECH_KEY: KEY, AZURE_SPEECH_REGION: 'westeurope' };

/** Geçici önbellek klasörüyle bir tts kurar; test bitince işçiyi kapatır ve klasörü siler. */
function setup(t, options = {}) {
  const dir = options.cacheDir || fs.mkdtempSync(path.join(os.tmpdir(), 'bb-tts-'));
  const logs = [];
  const tts = createTts({ cacheDir: dir, pocketDir: path.join(dir, 'no-model'), env: {}, platform: 'win32', log: (line) => logs.push(line), timings: { restart: 5 }, ...options });
  t.after(() => {
    tts.close();
    if (!options.cacheDir) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  return { tts, dir, logs };
}
const local = (t, fake, options = {}) => setup(t, { provider: 'local', spawnImpl: fake.spawnImpl, ...options });
const wavs = (dir) => fs.readdirSync(dir).filter((name) => name.endsWith('.wav')).sort();

function preparedPocket(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-pocket-'));
  fs.mkdirSync(path.join(dir, 'venv/Scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'venv/Scripts/python.exe'), '');
  fs.writeFileSync(path.join(dir, 'ready-v1'), '');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('Pocket: otomatik seçim, Türkçe duygu, ses değişimi ve WAV önbelleği', async (t) => {
  const fake = fakeWorker();
  const { tts } = setup(t, { pocketDir: preparedPocket(t), spawnImpl: fake.spawnImpl, env: AZURE_ENV, delivery: 'natural' });
  const clue = 'Bu şehrin plakası otuz dört.';
  assert.equal(tts.provider, 'pocket');
  const warm = await tts.warm([clue]);
  assert.equal(warm, 1);
  const first = await tts.speak(clue);
  assert.equal(fake.calls.requests.length, 1);
  assert.equal(fake.calls.requests[0].emotion, 'sakin');
  assert.equal(fake.calls.requests[0].voice, 'female_2');
  assert.equal(fake.calls.spawns[0].options.env.HF_HUB_OFFLINE, '1');
  tts.setPocketVoice('male_2');
  const second = await tts.speak(clue);
  assert.notEqual(first.name, second.name);
  await tts.speak('Bildin!', { emotion: 'excited' });
  assert.equal(fake.calls.requests.at(-1).emotion, 'mutlu');
  assert.equal(fake.calls.requests.at(-1).voice, 'male_2');
  assert.equal(tts.status().voice, 'male_2');
});

/** python.exe çağrıları sırayla `pythons` listesindeki sahte işçilere (sonuncusu yinelenir), powershell `shell`e gider. */
function route(pythons, shell) {
  let n = 0;
  const spawnImpl = (cmd, ...rest) => (/python/i.test(cmd) ? pythons[Math.min(n++, pythons.length - 1)] : shell).spawnImpl(cmd, ...rest);
  return { spawnImpl, pythonStarts: () => n };
}

test('Pocket: açılamayan işçi artan aralıklarla yeniden denenir; o sırada Windows sesi konuşur, Pocket dönünce ona geçilir', async (t) => {
  const bad = fakeWorker({ ready: { ready: false, err: 'model eksik' } });
  const good = fakeWorker({ wavMs: 900 });
  const shell = fakeWorker({ wavMs: 500 });
  const routed = route([bad, bad, bad, good], shell);
  const { tts, logs } = setup(t, { pocketDir: preparedPocket(t), spawnImpl: routed.spawnImpl, timings: { restart: 5, backoff: [60, 120] } });
  assert.equal(tts.provider, 'pocket');
  const early = tts.speak('Yayın açılıyor.'); // Pocket'in açılamadığı henüz bilinmiyor: sırada bekler, sonra yedeğe aktarılır
  await until(() => tts.status().unavailable);
  const viaWindows = await tts.speak('Tarçın burada.', { emotion: 'happy' });
  assert.deepEqual([viaWindows.provider, viaWindows.ms, (await early).provider], ['local', 500, 'local'], 'Pocket yokken canlı replik Windows sesiyle söylenir');
  await until(() => (tts.status().retryInMs ?? 0) > 10); // iki deneme arasındaki bekleme penceresi
  const down = tts.status();
  assert.deepEqual([down.provider, down.active, down.voice, down.fallback, down.ready, down.unavailable, down.pocketVoice], ['pocket', 'local', 'Sahte Tolga', true, false, true, 'female_2']);
  assert.match(down.reason, /Pocket çalışmıyor \(model eksik\); Windows sesi konuşuyor; .* sonra yeniden denenecek/);
  assert.ok(down.retryInMs >= 0);
  const warming = tts.warm(['Arka plan repliği']); // ısıtma yedek sesle yapılmaz: Pocket'i bekler
  await tick(20);
  assert.deepEqual(shell.calls.requests.map((r) => r.text), ['Yayın açılıyor.', 'Tarçın burada.']);

  await until(() => tts.status().active === 'pocket' && tts.status().ready); // 5 ms, 60 ms, 120 ms sonra dördüncü deneme tutar
  assert.equal(routed.pythonStarts(), 4, 'iki başarısızlıktan sonra da denemeye devam eder');
  assert.equal(await warming, 1);
  const back = await tts.speak('Tarçın burada.', { emotion: 'happy' });
  assert.deepEqual([back.provider, back.voice, back.ms], ['pocket', 'female_2', 900], 'Pocket dönünce yeni replikler yine onunla');
  assert.notEqual(back.name, viaWindows.name, 'iki sesin kayıtları ayrı anahtarlarda durur');
  const up = tts.status();
  assert.deepEqual([up.active, up.voice, up.fallback, up.reason, up.unavailable], ['pocket', 'female_2', false, null, undefined]);
  assert.deepEqual(good.calls.requests.map((r) => r.text).sort(), ['Arka plan repliği', 'Tarçın burada.']);
  assert.equal(shell.calls.requests.length, 2, 'Pocket dönünce Windows sesine iş gitmez');
  assert.ok(logs.some((line) => /60 ms sonra yeniden denenecek, o zamana kadar Windows sesi konuşur/.test(line)), logs.join('\n'));
  assert.ok(logs.some((line) => line.includes('Pocket yeniden hazır')));
});

test('Pocket: konuşurken ölen işçinin repliği Windows sesiyle tamamlanır; işçi her seferinde ölse de yayın susmaz', async (t) => {
  const dying = fakeWorker({ behave: () => 'die' });
  const shell = fakeWorker({ wavMs: 400 });
  const routed = route([dying], shell);
  const { tts } = setup(t, { pocketDir: preparedPocket(t), spawnImpl: routed.spawnImpl, timings: { restart: 5, backoff: [30, 60] } });
  await until(() => tts.status().ready);
  const first = await tts.speak('Bildin Ayşe!', { emotion: 'excited' });
  assert.deepEqual([first.provider, first.ms], ['local', 400], 'yarıda kalan replik yedek sesle tamamlanır');
  await until(() => tts.status().active === 'pocket' && tts.status().ready); // hemen yeniden açıldı
  const second = await tts.speak('Sıradaki soru geliyor!');
  assert.equal(second.provider, 'local', 'ikinci ölümde de replik kaybolmaz');
  assert.equal(tts.status().unavailable, true);
  assert.match(tts.status().lastError, /pocket: işçi kapandı .* 30 ms sonra yeniden denenecek/);
  for (let i = 0; routed.pythonStarts() < 4 && i < 300; i++) { // işçi her açılışında yine ölür; replikler yine de söylenir
    assert.equal((await tts.speak('Replik ' + i)).provider, 'local');
    await tick(5);
  }
  assert.ok(routed.pythonStarts() >= 4, 'denemekten vazgeçilmez');
  assert.equal(tts.provider, 'pocket', 'seçilen sağlayıcı değişmez');
  assert.ok(dying.calls.requests.length >= 2);
});

test('Pocket: yedek ses yoksa replik boş döner ama işçi denenmeye devam eder', async (t) => {
  const bad = fakeWorker({ ready: { ready: false, err: 'model eksik' } });
  const good = fakeWorker({ wavMs: 800 });
  const noVoice = fakeWorker({ ready: { ready: false, err: 'no-voice', lang: 'tr-TR' } });
  // Windows dışında yedek hiç yok
  const linux = setup(t, { pocketDir: preparedPocket(t), platform: 'linux', spawnImpl: route([bad, bad, bad, good], noVoice).spawnImpl, timings: { restart: 5, backoff: [20, 30] } }).tts;
  await until(() => linux.status().unavailable);
  assert.equal(await linux.speak('Kimse duymuyor'), null);
  assert.deepEqual([linux.status().active, linux.status().fallback, linux.status().ready], ['pocket', false, false]);
  assert.match(linux.status().reason, /yedek ses yok/);
  assert.equal(noVoice.calls.spawns.length, 0);
  await until(() => linux.status().ready);
  assert.equal((await linux.speak('Şimdi duyuluyor')).provider, 'pocket', 'Pocket dönünce konuşur');
  // Windows'ta Türkçe ses kurulu değil: yedek bir kez denenir, Pocket denenmeye devam eder
  const routed = route([bad, bad, bad, good], noVoice);
  const { tts: win, logs } = setup(t, { pocketDir: preparedPocket(t), spawnImpl: routed.spawnImpl, timings: { restart: 5, backoff: [40, 60] } });
  await until(() => win.status().unavailable);
  assert.equal(await win.speak('Yedek de yok'), null);
  assert.ok(logs.some((line) => /yedek ses yok: Windows'ta Türkçe ses kurulu değil/.test(line)), logs.join('\n'));
  assert.equal(await win.speak('Hâlâ yok'), null);
  assert.equal(noVoice.calls.spawns.length, 1, 'olmayan ses için yeniden başlatma döngüsü yok');
  assert.equal(win.provider, 'pocket');
  await until(() => win.status().ready && win.status().active === 'pocket');
  assert.ok(await win.speak('Pocket geri geldi'));
  // yedek istenmezse hiç açılmaz
  const strict = setup(t, { pocketDir: preparedPocket(t), fallback: false, spawnImpl: route([bad], fakeWorker()).spawnImpl, timings: { restart: 5, backoff: [500] } }).tts;
  await until(() => strict.status().unavailable);
  assert.equal(await strict.speak('Yedeksiz'), null);
});

test('tts işçileri: ortamdan yalnız gerekenler geçer, API anahtarları geçmez', async (t) => {
  const secrets = { AZURE_SPEECH_KEY: KEY, AZURE_SPEECH_REGION: 'westeurope', ANTHROPIC_API_KEY: 'sk-ant-cok-gizli', ANTHROPIC_AUTH_TOKEN: 'gizli-belirtec', OPENAI_API_KEY: 'baska-cok-gizli', HF_TOKEN: 'hf_cok_gizli', SHOW_CLAUDE_MODEL: 'gizli-model-adi', NODE_OPTIONS: '--inspect-gizli' };
  const needed = { Path: 'C:\\Windows\\system32', SystemRoot: 'C:\\Windows', TEMP: 'C:\\Temp', TMP: 'C:\\Temp', USERPROFILE: 'C:\\Users\\deneme' };
  const python = fakeWorker({ ready: { ready: false, err: 'model eksik' } });
  const shell = fakeWorker();
  const pocketDir = preparedPocket(t);
  const { tts } = setup(t, { pocketDir, env: AZURE_ENV, workerEnv: { ...needed, ...secrets }, spawnImpl: route([python], shell).spawnImpl, timings: { restart: 5, backoff: [500] } });
  await until(() => tts.status().unavailable);
  assert.ok(await tts.speak('Yedek ses de sade ortamla açılır'));
  const pythonEnv = python.calls.spawns[0].options.env, shellEnv = shell.calls.spawns[0].options.env;
  assert.deepEqual(pythonEnv, { ...needed, HF_HOME: path.join(pocketDir, 'hf'), HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', PYTHONUTF8: '1' });
  assert.deepEqual(shellEnv, needed);
  for (const value of Object.values(secrets)) assert.ok(!JSON.stringify([pythonEnv, shellEnv]).includes(value), 'sızan değer: ' + value);
  // Varsayılan kaynak process.env'dir: oradaki anahtarlar da geçmez.
  process.env.BB_TEST_SECRET_API_KEY = 'sizmamali';
  t.after(() => { delete process.env.BB_TEST_SECRET_API_KEY; });
  const plain = fakeWorker();
  local(t, plain);
  const inherited = plain.calls.spawns[0].options.env;
  assert.equal(inherited.BB_TEST_SECRET_API_KEY, undefined);
  assert.ok(Object.keys(inherited).some((name) => name.toUpperCase() === 'PATH'), 'PATH geçer');
  assert.ok(!Object.keys(inherited).some((name) => /KEY|TOKEN|SECRET/i.test(name)), Object.keys(inherited).join());
});

// ---------------------------------------------------------------------------------------------------------------------
// wavInfo

test('tts wavInfo: reads duration and format from a plain PCM header', () => {
  assert.deepEqual(wavInfo(makeWav({ ms: 500 })), { ms: 500, sampleRate: 16000, channels: 1, bits: 16 });
  assert.deepEqual(wavInfo(makeWav({ ms: 1250, sampleRate: 24000 })), { ms: 1250, sampleRate: 24000, channels: 1, bits: 16 });
  assert.deepEqual(wavInfo(makeWav({ ms: 2000, sampleRate: 44100, channels: 2, bits: 8 })), { ms: 2000, sampleRate: 44100, channels: 2, bits: 8 });
  // The Windows voice writes an 18-byte fmt chunk, so "data" does not start at byte 36.
  assert.deepEqual(wavInfo(makeWav({ ms: 440, fmtSize: 18 })), { ms: 440, sampleRate: 16000, channels: 1, bits: 16 });
  const wav = makeWav({ ms: 300 });
  assert.equal(wavInfo(new Uint8Array(wav)).ms, 300, 'a plain Uint8Array works too');
});

test('tts wavInfo: finds the real "data" chunk behind other chunks', () => {
  // An odd-sized LIST chunk whose payload contains the bytes "data": a naive search would land inside it.
  const list = chunk('LIST', Buffer.from('INFOdata\u0004\u0000\u0000\u0000junk!', 'latin1'));
  const fact = chunk('fact', Buffer.alloc(4));
  assert.equal(list.length % 2, 0, 'padded to an even length');
  assert.deepEqual(wavInfo(makeWav({ ms: 800, before: [list, fact] })), { ms: 800, sampleRate: 16000, channels: 1, bits: 16 });
});

test('tts wavInfo: streamed headers (size 0 or 0xFFFFFFFF) and truncated files use the bytes that are really there', () => {
  assert.equal(wavInfo(makeWav({ ms: 600, sampleRate: 24000, declared: 0 })).ms, 600);
  assert.equal(wavInfo(makeWav({ ms: 600, sampleRate: 24000, declared: 0xffffffff })).ms, 600);
  const full = makeWav({ ms: 1000 });
  assert.equal(wavInfo(full.subarray(0, 44 + 16000)).ms, 500, 'half of the samples are missing');
});

test('tts wavInfo: garbage is null, never an exception', () => {
  const noData = Buffer.concat([makeWav({ ms: 100 }).subarray(0, 36), chunk('LIST', Buffer.alloc(40))]);
  const notWave = makeWav({ ms: 100 });
  notWave.write('AVI ', 8, 'latin1');
  const dataBeforeFmt = Buffer.concat([Buffer.from('RIFF\u0000\u0000\u0000\u0000WAVE', 'latin1'), chunk('data', Buffer.alloc(64))]);
  for (const bad of [null, undefined, '', 'RIFF....WAVE', 42, {}, [], Buffer.alloc(0), Buffer.alloc(200), Buffer.from('bu bir ses dosyası değil, yalnızca uzunca bir yazı parçası'),
    noData, notWave, dataBeforeFmt, makeWav({ tag: 3 }), makeWav({ tag: 85 }), makeWav({ bits: 12 }), makeWav({ ms: 100 }).subarray(0, 30)]) {
    assert.equal(wavInfo(bad), null);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// prosodyFor, buildSsml, cacheKey

test('tts prosodyFor: signed percentages; excited and happy are faster and higher, sad and think slower', () => {
  const num = (s) => Number(s.replace('%', ''));
  for (const provider of ['local', 'azure']) {
    const of = (emotion) => { const p = prosodyFor(emotion, provider); return { rate: num(p.rate), pitch: num(p.pitch) }; };
    for (const emotion of ['neutral', 'happy', 'excited', 'wow', 'think', 'sad', 'love', 'wink']) {
      const p = prosodyFor(emotion, provider);
      assert.match(p.rate, /^[+-]\d+%$/, `${provider} ${emotion} rate`);
      assert.match(p.pitch, /^[+-]\d+%$/, `${provider} ${emotion} pitch`);
    }
    const neutral = of('neutral');
    assert.ok(neutral.rate > 0 && neutral.rate <= 15, 'the default is slightly faster than the voice default');
    for (const lively of ['happy', 'excited']) {
      assert.ok(of(lively).rate > neutral.rate, `${provider} ${lively} is faster`);
      assert.ok(of(lively).pitch > neutral.pitch, `${provider} ${lively} is higher`);
    }
    assert.ok(of('excited').pitch > of('happy').pitch);
    for (const calm of ['sad', 'think']) assert.ok(of(calm).rate < neutral.rate, `${provider} ${calm} is slower`);
    assert.deepEqual(prosodyFor('bilinmeyen', provider), prosodyFor('neutral', provider));
    assert.deepEqual(prosodyFor(undefined, provider), prosodyFor('neutral', provider));
  }
  assert.deepEqual(prosodyFor('excited'), prosodyFor('excited', 'local'), 'local syntax is the default');
  // Measured on Microsoft Tolga: the rate is rounded to steps, so each value must sit inside the intended step.
  const step = (emotion) => { const r = num(prosodyFor(emotion, 'local').rate); return r <= -6 ? -1 : r <= 5 ? 0 : r <= 17 ? 1 : r <= 31 ? 2 : 3; };
  assert.deepEqual(['sad', 'think', 'neutral', 'happy', 'excited'].map(step), [-1, 0, 1, 2, 2]);
});

test('tts buildSsml: escapes & < > " \' in text and attributes', () => {
  const ssml = buildSsml('Tom & Jerry <b>"hızlı"</b> Ayşe\'nin 3 > 2', { voice: 'ses"<x>', rate: '+10%', pitch: '+0%' });
  assert.ok(ssml.includes('Tom &amp; Jerry &lt;b&gt;&quot;hızlı&quot;&lt;/b&gt; Ayşe&apos;nin 3 &gt; 2'), ssml);
  assert.ok(ssml.includes('<voice name="ses&quot;&lt;x&gt;">'), ssml);
  assert.ok(!ssml.includes('<b>') && !ssml.includes("'"));
  assert.equal(textOf(ssml), 'Tom & Jerry <b>"hızlı"</b> Ayşe\'nin 3 > 2', 'unescaping gives the original text back');
  assert.equal(buildSsml('&amp;'), '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="tr-TR">&amp;amp;</speak>');
  assert.ok(buildSsml('a' + String.fromCharCode(1) + 'b' + String.fromCharCode(0xd83d) + 'c').includes('>a b'), 'control characters cannot break the XML');
});

test('tts buildSsml: Turkish text stays as it is; voice, language and prosody are placed around it', () => {
  const text = 'Çığlık atan şoför İstanbul\'da öğle üzeri IĞDIR ağacına güldü';
  const azure = buildSsml(text, { voice: 'tr-TR-EmelNeural', rate: '+6%', pitch: '+0%' });
  assert.equal(azure, '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="tr-TR"><voice name="tr-TR-EmelNeural">'
    + '<prosody rate="+6%" pitch="+0%">Çığlık atan şoför İstanbul&apos;da öğle üzeri IĞDIR ağacına güldü</prosody></voice></speak>');
  const local = buildSsml('Merhaba, ben Tarçın!', { rate: '+10%', pitch: '+0%' });
  assert.equal(local, '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="tr-TR"><prosody rate="+10%" pitch="+0%">Merhaba, ben Tarçın!</prosody></speak>');
  assert.ok(buildSsml('hi', { lang: 'en-US' }).includes('xml:lang="en-US">hi</speak>'));
  assert.doesNotThrow(() => buildSsml(undefined));
});

test('tts cacheKey: a stable sha1 that changes with every field', () => {
  const base = { provider: 'local', voice: 'tr-TR', emotion: 'neutral', text: 'Merhaba, ben Tarçın!' };
  const key = cacheKey(base);
  assert.match(key, /^[0-9a-f]{40}$/);
  assert.equal(cacheKey({ ...base }), key);
  assert.equal(cacheKey({ text: base.text, emotion: 'neutral', voice: 'tr-TR', provider: 'local' }), key, 'field order does not matter');
  // Pinned: if this changes, every WAV already in data/tts-cache is orphaned.
  assert.equal(key, PINNED_KEY);
  const others = [{ provider: 'azure' }, { voice: 'tr-TR-EmelNeural' }, { emotion: 'excited' }, { text: 'Merhaba, ben Tarcin!' }, { text: 'merhaba, ben Tarçın!' }].map((change) => cacheKey({ ...base, ...change }));
  assert.equal(new Set([key, ...others]).size, 6);
  assert.notEqual(cacheKey({ provider: 'a', voice: 'b', emotion: 'c', text: 'd' }), cacheKey({ provider: 'a', voice: 'bc', emotion: '', text: 'd' }), 'fields cannot bleed into each other');
});

// ---------------------------------------------------------------------------------------------------------------------
// Sağlayıcı seçimi

test('tts provider: auto picks azure with a key, the Windows voice without one, and off elsewhere', (t) => {
  const pick = (options) => setup(t, { spawnImpl: fakeWorker().spawnImpl, fetchImpl: fakeFetch(() => new Response(null, { status: 500 })).fetchImpl, ...options }).tts;
  assert.equal(pick({ provider: 'auto', env: AZURE_ENV, platform: 'win32' }).provider, 'azure');
  assert.equal(pick({ provider: 'auto', env: AZURE_ENV, platform: 'linux' }).provider, 'azure');
  assert.equal(pick({ env: {}, platform: 'win32' }).provider, 'local', 'auto is the default');
  assert.equal(pick({ provider: 'auto', env: {}, platform: 'linux' }).provider, 'off');
  assert.equal(pick({ provider: 'auto', env: {}, platform: 'darwin' }).provider, 'off');
  // Both variables are needed.
  assert.equal(pick({ provider: 'auto', env: { AZURE_SPEECH_KEY: KEY }, platform: 'win32' }).provider, 'local');
  assert.equal(pick({ provider: 'auto', env: { AZURE_SPEECH_REGION: 'westeurope' }, platform: 'linux' }).provider, 'off');
  assert.equal(pick({ provider: 'auto', env: { AZURE_SPEECH_KEY: '   ', AZURE_SPEECH_REGION: 'westeurope' }, platform: 'win32' }).provider, 'local');
  // Unknown or oddly cased values.
  assert.equal(pick({ provider: 'AZURE', env: AZURE_ENV }).provider, 'azure');
  assert.equal(pick({ provider: 'bilinmeyen', env: {}, platform: 'win32' }).provider, 'local');
  assert.equal(pick({ provider: null, env: AZURE_ENV }).provider, 'azure');
});

test('tts provider: explicit choices are respected and an impossible one turns the voice off with a reason', (t) => {
  const fake = fakeWorker();
  const fetched = fakeFetch(() => new Response(null, { status: 500 }));
  const pick = (options) => setup(t, { spawnImpl: fake.spawnImpl, fetchImpl: fetched.fetchImpl, ...options }).tts;
  assert.equal(pick({ provider: 'local', env: AZURE_ENV, platform: 'win32' }).provider, 'local', 'local even though a key exists');
  assert.equal(pick({ provider: 'azure', env: AZURE_ENV, platform: 'linux' }).provider, 'azure');
  const spawnsSoFar = fake.calls.spawns.length;

  const noKey = pick({ provider: 'azure', env: {}, platform: 'win32' });
  assert.equal(noKey.provider, 'off', 'azure without a key does not silently become another voice');
  assert.match(noKey.status().lastError, /AZURE_SPEECH_KEY/);
  const noWindows = pick({ provider: 'local', env: {}, platform: 'linux' });
  assert.equal(noWindows.provider, 'off');
  assert.match(noWindows.status().lastError, /Windows/);
  const badRegion = pick({ provider: 'auto', env: { AZURE_SPEECH_KEY: KEY, AZURE_SPEECH_REGION: 'evil.example/x?' }, platform: 'linux' });
  assert.equal(badRegion.provider, 'off', 'a region that is not a plain name never reaches a URL');
  const off = pick({ provider: 'off', env: AZURE_ENV, platform: 'win32' });
  assert.equal(off.provider, 'off');
  assert.deepEqual(off.status(), { provider: 'off', active: 'off', voice: null, ready: false, fallback: false, reason: null, delivery: 'presenter', cached: 0, queued: 0, failures: 0, lastError: null });
  assert.equal(fake.calls.spawns.length, spawnsSoFar, 'no worker is started when the voice is off');
});

test('tts provider off: speak and warm answer at once with nothing, and nothing is created on disk', async (t) => {
  const fake = fakeWorker();
  const fetched = fakeFetch(() => new Response(null, { status: 500 }));
  const dir = path.join(os.tmpdir(), `bb-tts-off-${process.pid}-${Date.now()}`);
  const { tts } = setup(t, { provider: 'off', cacheDir: dir, env: AZURE_ENV, spawnImpl: fake.spawnImpl, fetchImpl: fetched.fetchImpl });
  assert.equal(await tts.speak('Merhaba'), null);
  assert.equal(await tts.warm(['bir', 'iki']), 0);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(fake.calls.spawns.length + fetched.calls.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------
// local sağlayıcı (sahte işçiyle)

test('tts local: starts one PowerShell worker and turns a line into a cached WAV', async (t) => {
  const fake = fakeWorker({ wavMs: 1234 });
  const { tts, dir } = local(t, fake);
  assert.equal(tts.status().ready, false, 'not ready before the worker says so');
  const result = await tts.speak('Merhaba, ben Tarçın!', { emotion: 'happy' });

  assert.equal(fake.calls.spawns.length, 1);
  const { command, args, options } = fake.calls.spawns[0];
  assert.equal(command, 'powershell.exe');
  assert.deepEqual(args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']);
  assert.equal(path.basename(args[5]), 'tts-local.ps1');
  assert.ok(fs.existsSync(args[5]), 'the worker script exists next to tts.js');
  assert.equal(args.length, 6);
  assert.equal(options.windowsHide, true);

  const key = cacheKey({ provider: 'local', voice: 'tr-TR', emotion: 'happy', text: 'Merhaba, ben Tarçın!' });
  assert.deepEqual(result, { name: key + '.wav', file: path.join(dir, key + '.wav'), ms: 1234, provider: 'local', voice: 'tr-TR' });
  assert.equal(path.isAbsolute(result.file), true);
  assert.deepEqual(wavs(dir), [key + '.wav']);
  assert.deepEqual(fs.readdirSync(dir), [key + '.wav'], 'no temporary file is left behind');
  assert.deepEqual(tts.status(), { provider: 'local', active: 'local', voice: 'Sahte Tolga', ready: true, fallback: false, reason: null, delivery: 'presenter', cached: 1, queued: 0, failures: 0, lastError: null });

  const request = fake.calls.requests[0];
  assert.equal(request.ssml, buildSsml('Merhaba, ben Tarçın!', prosodyFor('happy', 'local')));
  assert.equal(path.dirname(request.file), dir, 'the worker is only ever told to write inside the cache folder');
});

test('tts local: Turkish letters travel to the worker as pure ASCII and arrive unchanged', async (t) => {
  const fake = fakeWorker();
  const { tts } = local(t, fake);
  const text = 'Çığlık atan şoför İstanbul\'da öğle üzeri IĞDIR ağacına güldü';
  assert.ok(await tts.speak(text));
  const { line, ssml } = fake.calls.requests[0];
  assert.match(line, /^[\x20-\x7e]+$/, 'no byte above 0x7E on the wire, so no code page can damage it');
  assert.ok(line.includes('\\u015f') && line.includes('\\u0130') && line.includes('\\u011e'), 'ş, İ, Ğ are sent as \\u escapes');
  assert.equal(textOf(ssml), text);
});

test('tts local: a line that reaches the worker with a different length is not kept', async (t) => {
  const fake = fakeWorker({ behave: (request, index) => (index === 1 ? { n: request.ssml.length + 2 } : 'ok') });
  const { tts, dir } = local(t, fake);
  assert.equal(await tts.speak('çağ'), null);
  assert.match(tts.status().lastError, /bozuk/);
  assert.deepEqual(fs.readdirSync(dir), [], 'the mispronounced file is removed');
  assert.ok(await tts.speak('çağ'), 'and the next attempt can succeed');
});

test('tts cache: a hit returns without synthesizing, also for a new instance with no working voice', async (t) => {
  const fake = fakeWorker({ wavMs: 900 });
  const { tts, dir } = local(t, fake);
  const first = await tts.speak('Hoş geldin Ayşe!');
  const again = await tts.speak('Hoş geldin Ayşe!');
  const spaced = await tts.speak('  Hoş   geldin\nAyşe!  ');
  assert.deepEqual(again, first);
  assert.deepEqual(spaced, first, 'whitespace differences are the same line');
  assert.equal(fake.calls.requests.length, 1);
  assert.notEqual((await tts.speak('Hoş geldin Ayşe!', { emotion: 'excited' })).name, first.name, 'another emotion is another file');
  assert.equal(fake.calls.requests.length, 2);

  // A second instance over the same folder whose worker never becomes ready: the cache alone answers.
  const dead = fakeWorker({ ready: null });
  const second = local(t, dead, { cacheDir: dir }).tts;
  assert.equal(second.status().cached, 2);
  assert.deepEqual(await second.speak('Hoş geldin Ayşe!', { timeoutMs: 50 }), first);
  assert.equal(dead.calls.requests.length, 0);
});

test('tts cache: a damaged file is replaced instead of being served', async (t) => {
  const fake = fakeWorker();
  const { tts, dir } = local(t, fake);
  const key = cacheKey({ provider: 'local', voice: 'tr-TR', emotion: 'neutral', text: 'bozuk dosya' });
  fs.writeFileSync(path.join(dir, key + '.wav'), 'yarım kalmış');
  const result = await tts.speak('bozuk dosya');
  assert.equal(result.ms, 700);
  assert.equal(wavInfo(fs.readFileSync(result.file)).ms, 700);
  assert.equal(fake.calls.requests.length, 1);
});

test('tts cache: on startup only the newest maxFiles WAVs are kept; files that are not ours are left alone', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-tts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const name = (i) => String(i).repeat(40) + '.wav';
  for (let i = 0; i < 6; i++) {
    fs.writeFileSync(path.join(dir, name(i)), makeWav({ ms: 100 }));
    const at = new Date(Date.UTC(2026, 10, 1 + [3, 0, 5, 1, 4, 2][i])); // age order: 1, 3, 5 are the oldest
    fs.utimesSync(path.join(dir, name(i)), at, at);
  }
  const old = new Date(Date.UTC(2020, 0, 1));
  for (const foreign of ['notlar.txt', 'baska-bir-ses.wav', 'a'.repeat(40) + '.4242.tmp']) {
    fs.writeFileSync(path.join(dir, foreign), 'x');
    fs.utimesSync(path.join(dir, foreign), old, old);
  }
  const { tts } = setup(t, { provider: 'local', cacheDir: dir, maxFiles: 3, spawnImpl: fakeWorker().spawnImpl });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['baska-bir-ses.wav', 'notlar.txt', name(0), name(2), name(4)].sort(), 'oldest three WAVs and the stale temp file are gone');
  assert.equal(tts.status().cached, 3);

  const roomy = setup(t, { provider: 'local', cacheDir: dir, maxFiles: 3, spawnImpl: fakeWorker().spawnImpl }).tts;
  assert.equal(roomy.status().cached, 3, 'exactly at the limit nothing more is deleted');
  assert.equal(wavs(dir).length, 4);
});

test('tts speak: concurrent requests for the same line share one synthesis', async (t) => {
  const fake = fakeWorker({ manual: true });
  const { tts } = local(t, fake);
  const all = [tts.speak('Helal Ayşe!'), tts.speak('Helal Ayşe!'), tts.speak(' Helal  Ayşe! '), tts.warm(['Helal Ayşe!']), tts.speak('Helal Ayşe!', { emotion: 'neutral' })];
  await until(() => fake.held.length === 1);
  assert.equal(tts.status().queued, 1);
  await tick(20);
  assert.equal(fake.calls.requests.length, 1, 'one request although five callers are waiting');
  fake.release();
  const [a, b, c, warmed, d] = await Promise.all(all);
  assert.ok(a && a.ms === 700);
  assert.deepEqual([b, c, d], [a, a, a]);
  assert.equal(warmed, 1);
  assert.equal(fake.calls.requests.length, 1);
  assert.equal(tts.status().queued, 0);
});

test('tts speak: a timeout answers null but the work finishes and is cached for next time', async (t) => {
  const fake = fakeWorker({ manual: true });
  const { tts } = local(t, fake);
  await until(() => tts.status().ready);
  const started = Date.now();
  assert.equal(await tts.speak('Geç kalan replik', { timeoutMs: 40 }), null);
  const waited = Date.now() - started;
  assert.ok(waited >= 30 && waited < 1500, `returned after ${waited} ms`);
  assert.equal(tts.status().failures, 0, 'being late is not a failure of the voice');
  assert.equal(fake.calls.requests.length, 1);
  fake.release();
  await until(() => tts.status().cached === 1);
  const result = await tts.speak('Geç kalan replik', { timeoutMs: 0 });
  assert.equal(result.ms, 700, 'a cached line is returned even with no time budget');
  assert.equal(fake.calls.requests.length, 1);
});

test('tts speak: a worker that is not ready yet makes the line wait, then time out, not fail', async (t) => {
  const fake = fakeWorker({ ready: null });
  const { tts } = local(t, fake);
  assert.equal(await tts.speak('Hazır değil', { timeoutMs: 30 }), null);
  assert.equal(tts.status().queued, 1);
  assert.equal(fake.calls.requests.length, 0);
});

test('tts speak: yüksek öncelik sırada öne geçer; vazgeçilen ve henüz başlamamış replik hiç üretilmez', async (t) => {
  const fake = fakeWorker({ manual: true });
  const { tts } = local(t, fake);
  await until(() => tts.status().ready);
  const first = tts.speak('ilk');
  await until(() => fake.held.length === 1); // işçi meşgul: sonrakiler sırada bekler
  const stale = new AbortController(), shared = new AbortController();
  const low = tts.speak('dolgu', { priority: 1 });
  const gone = tts.speak('süresi dolan', { priority: 4, signal: stale.signal });
  const urgent = tts.speak('ipucu', { priority: 5 });
  const normal = tts.speak('olağan');
  const kept = tts.speak('iki kişi bekliyor', { priority: 2, signal: shared.signal });
  const other = tts.speak('iki kişi bekliyor', { priority: 2 });
  const warming = tts.warm(['ısınma da istiyor']);
  const dropped = tts.speak('ısınma da istiyor', { priority: 5, signal: shared.signal });
  stale.abort(); shared.abort();
  assert.deepEqual(await Promise.all([gone, kept, dropped]), [null, null, null], 'vazgeçen hemen boş döner');
  assert.equal(await tts.speak('baştan iptal', { signal: stale.signal }), null);
  let finished = false;
  const everything = Promise.all([first, low, urgent, normal, other, warming]).then((values) => { finished = true; return values; });
  while (!finished) { fake.release(); await tick(); }
  assert.deepEqual((await everything).map((v) => (typeof v === 'number' ? v : Boolean(v))), [true, true, true, true, true, 1]);
  assert.deepEqual(fake.calls.requests.map((r) => r.text), ['ilk', 'ipucu', 'olağan', 'iki kişi bekliyor', 'dolgu', 'ısınma da istiyor'],
    'öncelik sırası; iptal edilen üretilmedi; başkası da bekleyen replik üretildi; yalnız ısınmanın beklediği arka plana döndü');
  assert.equal(tts.status().queued, 0);

  // onStart: üretim işçiye verildiği an haber verilir; önbellekten gelen replikte verilmez; yoldaki işe katılana hemen verilir.
  const started = [];
  const one = tts.speak('haberli bir', { onStart: () => started.push('bir') });
  const two = tts.speak('haberli iki', { onStart: () => { started.push('iki'); throw new Error('çağıranın hatası'); } });
  await until(() => fake.held.length === 1);
  assert.deepEqual(started, ['bir'], 'sıradaki iş henüz başlamadı');
  const joined = tts.speak('haberli bir', { onStart: () => started.push('katılan') });
  assert.deepEqual(started, ['bir', 'katılan']);
  fake.release(); await until(() => fake.held.length === 1);
  assert.deepEqual(started, ['bir', 'katılan', 'iki']);
  fake.release();
  assert.ok((await one) && (await two) && (await joined));
  assert.ok(await tts.speak('haberli bir', { onStart: () => started.push('önbellek') }));
  assert.equal(started.length, 3, 'önbellekten gelen için haber verilmez');

  // Çalışmaya başlamış iş iptal edilse de biter ve önbelleğe girer; çağıran yine hemen boş döner.
  const late = new AbortController();
  const running = tts.speak('yolda olan', { signal: late.signal });
  await until(() => fake.held.length === 1);
  late.abort();
  assert.equal(await running, null);
  fake.release();
  await until(() => tts.status().cached === 9);
  assert.ok(await tts.speak('yolda olan', { timeoutMs: 0 }));
});

test('tts cache: sınır çalışırken de korunur; son dakikalarda üretilen dosyaya dokunulmaz', async (t) => {
  const fake = fakeWorker();
  const { tts, dir, logs } = local(t, fake, { maxFiles: 3, sweepEvery: 2, timings: { restart: 5, keep: 0 } });
  for (const text of ['bir', 'iki', 'üç', 'dört', 'beş', 'altı']) {
    assert.ok(await tts.speak(text));
    await tick(15); // dosya tarihleri sıralı olsun
    await until(() => wavs(dir).length <= 4);
  }
  await until(() => wavs(dir).length === 3);
  assert.equal(tts.status().cached, 3);
  assert.ok(logs.some((line) => /önbellek: \d+ eski kayıt silindi/.test(line)));
  const key = (text) => cacheKey({ provider: 'local', voice: 'tr-TR', emotion: 'neutral', text }) + '.wav';
  assert.deepEqual(wavs(dir), ['dört', 'beş', 'altı'].map(key).sort(), 'en eskiler gider, en yeniler kalır');
  assert.equal(fake.calls.requests.length, 6);
  assert.ok(await tts.speak('bir'), 'silinen replik yeniden üretilebilir');
  assert.equal(fake.calls.requests.length, 7);

  // Varsayılan koruma (10 dk): sınır aşılsa da yeni dosyalar silinmez.
  const fresh = local(t, fakeWorker(), { maxFiles: 1, sweepEvery: 1 });
  for (const text of ['x bir', 'x iki', 'x üç']) assert.ok(await fresh.tts.speak(text));
  assert.equal(await fresh.tts.sweep(), 0);
  assert.equal(wavs(fresh.dir).length, 3);
  // Tarihi eski görünen ama az önce oluşturulmuş dosya da korunur; kullanılan dosyanın tarihi tazelenir.
  const old = new Date(Date.now() - 3600_000);
  for (const name of wavs(fresh.dir)) fs.utimesSync(path.join(fresh.dir, name), old, old);
  assert.equal(await fresh.tts.sweep(), 0, 'oluşturulma zamanı yeni');
});

test('tts warm: speak() jumps ahead of warm work', async (t) => {
  const fake = fakeWorker({ manual: true });
  const { tts } = local(t, fake);
  await until(() => tts.status().ready);
  const warming = tts.warm(['ısınma bir', 'ısınma iki', 'ısınma üç']);
  await until(() => fake.held.length === 1); // the first warm line is already at the worker
  const live = tts.speak('canlı replik');
  const second = tts.speak('ikinci canlı replik', { emotion: 'excited' });
  let finished = false;
  const everything = Promise.all([warming, live, second]).then((values) => { finished = true; return values; });
  while (!finished) {
    fake.release();
    await tick();
  }
  const [warmed, liveResult, secondResult] = await everything;
  assert.equal(warmed, 3);
  assert.ok(liveResult && secondResult);
  assert.deepEqual(fake.calls.requests.map((r) => r.text), ['ısınma bir', 'canlı replik', 'ikinci canlı replik', 'ısınma iki', 'ısınma üç']);
});

test('tts warm: lines queued before the worker is ready still let speak() go first, and a waiting warm line can be promoted', async (t) => {
  const fake = fakeWorker({ manual: true, ready: null });
  const { tts } = local(t, fake);
  const warming = tts.warm(['arka plan', 'sonraki']);
  const live = tts.speak('önce ben');
  const promoted = tts.speak('arka plan'); // same line as the queued warm job: one synthesis, moved to the front
  fake.calls.children[0].stdout.emit('data', Buffer.from('{"ready":true,"voice":"Sahte Tolga"}\n'));
  let finished = false;
  const everything = Promise.all([warming, live, promoted]).then((values) => { finished = true; return values; });
  while (!finished) {
    fake.release();
    await tick();
  }
  assert.deepEqual((await everything).map((v) => (typeof v === 'number' ? v : Boolean(v))), [2, true, true]);
  assert.deepEqual(fake.calls.requests.map((r) => r.text), ['önce ben', 'arka plan', 'sonraki']);
});

test('tts warm: synthesizes only what is missing, one at a time, and reports how many lines are ready', async (t) => {
  const fake = fakeWorker({ behave: (request) => (textOf(request.ssml) === 'olmayan' ? { ok: false, err: 'FormatException' } : 'ok') });
  const { tts } = local(t, fake);
  await tts.speak('hazır olan');
  const count = await tts.warm(['hazır olan', 'yeni bir', 'olmayan', '', '   ', null, { text: 'duygulu', emotion: 'wow' }, 'yeni bir'], { emotion: 'neutral' });
  assert.equal(count, 4, 'hazır olan + yeni bir + duygulu + yeni bir (again, from the cache)');
  assert.deepEqual(fake.calls.requests.map((r) => r.text), ['hazır olan', 'yeni bir', 'olmayan', 'duygulu']);
  assert.equal(fake.calls.requests[3].ssml, buildSsml('duygulu', prosodyFor('wow', 'local')));
  assert.equal(await tts.warm('tek satır'), 1);
  assert.equal(await tts.warm(undefined), 0);
  assert.equal(tts.status().failures, 1);
});

test('tts local: a failed line is null with a recorded reason; the next line still works', async (t) => {
  const fake = fakeWorker({ behave: (request, index) => (index === 1 ? { ok: false, err: 'FormatException: bozuk SSML' } : index === 2 ? 'garbage' : 'ok') });
  const { tts, dir, logs } = local(t, fake);
  assert.equal(await tts.speak('ilk'), null);
  assert.equal(tts.status().failures, 1);
  assert.match(tts.status().lastError, /FormatException/);
  assert.equal(await tts.speak('ikinci'), null, 'a file that is not a WAV is rejected');
  assert.match(tts.status().lastError, /geçersiz ses/);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.ok(await tts.speak('üçüncü'));
  assert.equal(tts.status().failures, 2);
  assert.ok(logs.some((line) => line.includes('FormatException')));
});

test('tts local: a worker that dies is restarted; the line it was speaking is tried once more', async (t) => {
  const fake = fakeWorker({ behave: (request, index) => (index === 1 || textOf(request.ssml) === 'işçiyi hep düşüren replik' ? 'die' : 'ok') });
  const { tts } = local(t, fake);
  const first = await tts.speak('tam o sırada söylenen replik');
  assert.ok(first && first.ms === 700, 'the new worker speaks the line the old one died on');
  assert.deepEqual(fake.calls.requests.map((r) => r.text), ['tam o sırada söylenen replik', 'tam o sırada söylenen replik']);
  assert.equal(fake.calls.spawns.length, 2);
  assert.equal(tts.status().failures, 1, 'one death is one failure');
  assert.match(tts.status().lastError, /işçi kapandı/);

  assert.equal(await tts.speak('işçiyi hep düşüren replik'), null, 'a line that kills the worker twice is given up');
  assert.equal(fake.calls.requests.length, 4);
  const after = await tts.speak('yeniden başladıktan sonra');
  assert.ok(after && after.ms === 700);
  assert.equal(fake.calls.spawns.length, 4);
  assert.equal(tts.status().ready, true);

  fake.calls.children[3].die(1); // dies while idle
  await until(() => fake.calls.spawns.length === 5 && tts.status().ready);
  assert.ok(await tts.speak('beşinci işçi'));
  assert.equal(tts.status().queued, 0);
});

test('tts local: a worker that cannot be started or never answers does not break the caller', async (t) => {
  let attempts = 0;
  const broken = setup(t, { provider: 'local', spawnImpl: () => { attempts++; throw new Error('spawn EPERM'); } }).tts;
  assert.equal(broken.provider, 'local');
  assert.equal(await broken.speak('ses yok', { timeoutMs: 60 }), null);
  assert.ok(attempts >= 2, 'it keeps trying with a growing pause');
  assert.match(broken.status().lastError, /başlatılamadı/);

  const fake = fakeWorker({ behave: (request, index) => (index === 1 ? 'hang' : 'ok') });
  const { tts } = local(t, fake, { timings: { job: 40, restart: 5 } });
  assert.equal(await tts.speak('takılan replik', { timeoutMs: 2000 }), null, 'the watchdog gives up on the stuck request');
  assert.match(tts.status().lastError, /yanıt vermedi/);
  assert.ok(await tts.speak('sonraki replik'), 'a fresh worker takes over');
  assert.equal(fake.calls.spawns.length, 2);
});

test('tts local: no Turkish voice installed turns the provider off', async (t) => {
  const fake = fakeWorker({ ready: { ready: false, err: 'no-voice', lang: 'tr-TR' } });
  const { tts } = local(t, fake);
  const waiting = tts.speak('Kimse duymayacak');
  const warming = tts.warm(['bir', 'iki']);
  assert.equal(await waiting, null);
  assert.equal(await warming, 0);
  assert.equal(tts.provider, 'off');
  assert.equal(tts.status().provider, 'off');
  assert.equal(tts.status().ready, false);
  assert.match(tts.status().lastError, /Türkçe ses/);
  await tick(30);
  assert.equal(fake.calls.spawns.length, 1, 'no restart loop for a voice that does not exist');
  assert.equal(await tts.speak('hâlâ yok'), null);
});

test('tts local: output arriving in pieces (even inside a Turkish letter) is put back together', async (t) => {
  const fake = fakeWorker({ ready: null });
  const { tts } = local(t, fake);
  const bytes = Buffer.from('{"ready":true,"voice":"Türkçe Ses"}\r\n');
  const cut = bytes.indexOf(0xc3, bytes.indexOf(0xc3) + 1) + 1; // between the two bytes of "ç"
  const out = fake.calls.children[0].stdout;
  out.emit('data', Buffer.from('PowerShell bir uyarı yazdı\n{"ready"'));
  out.emit('data', bytes.subarray(8, cut));
  assert.equal(tts.status().ready, false);
  out.emit('data', bytes.subarray(cut));
  assert.equal(tts.status().ready, true);
  assert.equal(tts.status().voice, 'Türkçe Ses');
});

test('tts local: a voice name is passed to the worker, an Azure voice name is not', (t) => {
  const named = fakeWorker();
  local(t, named, { voice: 'Tolga' });
  assert.deepEqual(named.calls.spawns[0].args.slice(6), ['-Voice', 'Tolga']);
  const azureName = fakeWorker();
  const { tts } = local(t, azureName, { voice: 'tr-TR-AhmetNeural' });
  assert.equal(azureName.calls.spawns[0].args.length, 6);
  assert.equal(tts.status().voice, null);
});

test('tts: never throws or rejects, whatever it is given', async (t) => {
  assert.doesNotThrow(() => createTts().close());
  assert.equal(createTts({ provider: 'local', platform: 'win32', spawnImpl: fakeWorker().spawnImpl }).provider, 'off', 'no cache folder, no voice');
  const fake = fakeWorker();
  const { tts } = local(t, fake, { log: () => { throw new Error('günlük bozuk'); } });
  for (const text of [undefined, null, '', '   ', {}, [], () => {}, Symbol('x')]) assert.equal(await tts.speak(text), null);
  assert.equal(fake.calls.requests.length, 0, 'nothing worth saying, nothing synthesized');
  assert.ok(await tts.speak('seçenek yok', null));
  assert.ok(await tts.speak('garip seçenek', { emotion: 'yok-böyle-duygu', timeoutMs: 'abc' }));
  assert.equal(fake.calls.requests[1].ssml, buildSsml('garip seçenek', prosodyFor('neutral', 'local')), 'unknown emotion speaks as neutral');
  assert.ok(await tts.speak(81), 'a number is read as text');
  const long = await tts.speak('a'.repeat(5000));
  assert.ok(long && textOf(fake.calls.requests.at(-1).ssml).length === 400, 'very long input is cut');
  assert.equal(await tts.warm([{}, 5, null, undefined, ['x']]), 1);
});

test('tts close: stops the worker, releases everyone who is waiting and stays quiet afterwards', async (t) => {
  const fake = fakeWorker({ manual: true });
  const { tts } = local(t, fake);
  await until(() => tts.status().ready);
  const running = tts.speak('yarıda kalan');
  const queued = tts.speak('sırada bekleyen');
  const warming = tts.warm(['arka plan']);
  await until(() => fake.held.length === 1);
  tts.close();
  assert.deepEqual(await Promise.all([running, queued, warming]), [null, null, 0]);
  assert.equal(fake.calls.children[0].dead, true);
  assert.equal(await tts.speak('kapandıktan sonra'), null);
  assert.equal(tts.status().ready, false);
  assert.equal(tts.status().queued, 0);
  await tick(30);
  assert.equal(fake.calls.spawns.length, 1, 'a closed module does not restart its worker');
  assert.doesNotThrow(() => tts.close());
});

// ---------------------------------------------------------------------------------------------------------------------
// azure sağlayıcı (sahte fetch ile; gerçek servis çağrılmaz)

const azure = (t, fetched, options = {}) => setup(t, { provider: 'azure', env: AZURE_ENV, fetchImpl: fetched.fetchImpl, spawnImpl: () => { throw new Error('azure kipinde işçi başlatılmamalı'); }, timings: { warmGap: 0 }, ...options });

test('tts azure: request shape (URL, headers, SSML body) and the WAV that comes back', async (t) => {
  const audio = makeWav({ ms: 1500, sampleRate: 24000 });
  const fetched = fakeFetch(() => new Response(audio, { status: 200, headers: { 'content-type': 'audio/x-wav' } }));
  const { tts, dir } = azure(t, fetched);
  assert.deepEqual(tts.status(), { provider: 'azure', active: 'azure', voice: 'tr-TR-EmelNeural', ready: true, fallback: false, reason: null, delivery: 'presenter', cached: 0, queued: 0, failures: 0, lastError: null });

  const text = 'Tom & Jerry <3 "İzmir" dedi, Ayşe\'nin çağrısı';
  const result = await tts.speak(text, { emotion: 'excited' });
  assert.equal(fetched.calls.length, 1);
  const { url, init } = fetched.calls[0];
  assert.equal(url, 'https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1');
  assert.equal(init.method, 'POST');
  assert.deepEqual(init.headers, {
    'Ocp-Apim-Subscription-Key': KEY,
    'Content-Type': 'application/ssml+xml',
    'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',
    'User-Agent': 'bil-bakalim',
  });
  const { rate, pitch } = prosodyFor('excited', 'azure');
  assert.equal(init.body, '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="tr-TR"><voice name="tr-TR-EmelNeural">'
    + `<prosody rate="${rate}" pitch="${pitch}">Tom &amp; Jerry &lt;3 &quot;İzmir&quot; dedi, Ayşe&apos;nin çağrısı</prosody></voice></speak>`);
  assert.ok(init.signal instanceof AbortSignal, 'the request can be cancelled when it takes too long');

  const key = cacheKey({ provider: 'azure', voice: 'tr-TR-EmelNeural', emotion: 'excited', text });
  assert.deepEqual(result, { name: key + '.wav', file: path.join(dir, key + '.wav'), ms: 1500, provider: 'azure', voice: 'tr-TR-EmelNeural' });
  assert.deepEqual(fs.readFileSync(result.file), audio);
  assert.deepEqual(fs.readdirSync(dir), [key + '.wav']);

  assert.deepEqual(await tts.speak(text, { emotion: 'excited' }), result);
  assert.equal(fetched.calls.length, 1, 'the second time comes from the cache');
});

test('tts azure: the voice is configurable and the region is cleaned up', async (t) => {
  const fetched = fakeFetch(() => new Response(makeWav({ ms: 400, sampleRate: 24000 }), { status: 200 }));
  const { tts } = azure(t, fetched, { voice: 'tr-TR-AhmetNeural', env: { AZURE_SPEECH_KEY: `  ${KEY}\n`, AZURE_SPEECH_REGION: ' West Europe ' } });
  assert.equal(tts.status().voice, 'tr-TR-AhmetNeural');
  assert.ok(await tts.speak('Merhaba'));
  assert.equal(fetched.calls[0].url, 'https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1');
  assert.equal(fetched.calls[0].init.headers['Ocp-Apim-Subscription-Key'], KEY);
  assert.ok(fetched.calls[0].init.body.includes('<voice name="tr-TR-AhmetNeural">'));

  const other = azure(t, fakeFetch(() => new Response(null, { status: 500 })), { voice: 'Microsoft Tolga' }).tts;
  assert.equal(other.status().voice, 'tr-TR-EmelNeural', 'a local voice name is not sent to Azure');
});

test('tts azure: 429, 5xx and network errors are null with a recorded reason and no leaked key', async (t) => {
  const replies = [
    () => new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '1' } }),
    () => new Response('Internal Server Error', { status: 500 }),
    () => new Response(makeWav({ ms: 300, sampleRate: 24000 }), { status: 200 }),
    () => { throw new TypeError(`fetch failed: ECONNRESET while sending key ${KEY}`); },
    () => new Response('<html>yanlış kapı</html>', { status: 200 }),
    () => new Response(null, { status: 503 }),
  ];
  const fetched = fakeFetch((n) => replies[n - 1]());
  const { tts, dir, logs } = azure(t, fetched);

  assert.equal(await tts.speak('bir'), null);
  assert.match(tts.status().lastError, /HTTP 429/);
  assert.equal(await tts.speak('iki'), null);
  assert.match(tts.status().lastError, /HTTP 500/);
  assert.equal(tts.status().failures, 2);
  assert.deepEqual(fs.readdirSync(dir), [], 'a failure leaves nothing in the cache');

  assert.ok(await tts.speak('bir'), 'a failed line is tried again the next time it is needed');
  assert.equal(await tts.speak('üç'), null);
  assert.match(tts.status().lastError, /ağ hatası/);
  assert.equal(await tts.speak('dört'), null, 'HTTP 200 with something that is not a WAV');
  assert.match(tts.status().lastError, /geçersiz ses/);
  assert.equal(await tts.speak('beş'), null);
  assert.match(tts.status().lastError, /HTTP 503/);
  assert.equal(fetched.calls.length, 6);
  assert.equal(tts.status().failures, 5);
  assert.deepEqual(wavs(dir).length, 1);

  const everything = JSON.stringify([logs, tts.status()]);
  assert.equal(everything.includes(KEY), false, 'the key is never logged or reported');
  assert.ok(everything.includes('***'), 'it is masked where an error message contained it');
});

test('tts azure: a rejected key stops asking for a while instead of hammering the service', async (t) => {
  const fetched = fakeFetch(() => new Response('Access denied', { status: 401 }));
  const { tts } = azure(t, fetched);
  assert.equal(await tts.speak('bir'), null);
  assert.match(tts.status().lastError, /HTTP 401.*anahtar/);
  assert.equal(await tts.speak('iki'), null);
  assert.equal(await tts.speak('üç'), null);
  assert.equal(fetched.calls.length, 1);
  assert.equal(tts.status().queued, 0);

  // Three failures in a row (service or network down): fail fast for a moment so the queue cannot pile up.
  const down = fakeFetch(() => new Response(null, { status: 503 }));
  const second = azure(t, down).tts;
  for (const line of ['bir', 'iki', 'üç', 'dört', 'beş']) assert.equal(await second.speak(line), null);
  assert.equal(down.calls.length, 3);
  assert.equal(second.status().failures, 3);
});

test('tts azure: a request that hangs is given up on', async (t) => {
  let aborted = false;
  const fetched = fakeFetch((n, url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
  }));
  const { tts } = azure(t, fetched, { timings: { azure: 40, warmGap: 0 } });
  assert.equal(await tts.speak('cevap gelmeyecek', { timeoutMs: 2000 }), null);
  assert.match(tts.status().lastError, /zaman aşımı/);
  assert.equal(aborted, true);
  assert.equal(tts.status().queued, 0);
});

test('tts azure: a streamed WAV header with no sizes is repaired before it is cached', async (t) => {
  const fetched = fakeFetch(() => new Response(makeWav({ ms: 900, sampleRate: 24000, declared: 0 }), { status: 200 }));
  const { tts } = azure(t, fetched);
  const result = await tts.speak('akış başlığı');
  assert.equal(result.ms, 900);
  const saved = fs.readFileSync(result.file);
  assert.equal(saved.readUInt32LE(4), saved.length - 8, 'RIFF size');
  assert.equal(saved.readUInt32LE(40), saved.length - 44, 'data size');
  assert.deepEqual(saved, makeWav({ ms: 900, sampleRate: 24000 }));
});

test('tts azure: warm goes through the same queue and a live line overtakes it', async (t) => {
  const order = [];
  const gates = [];
  const fetched = fakeFetch((n, url, init) => new Promise((resolve) => {
    order.push(textOf(init.body));
    gates.push(() => resolve(new Response(makeWav({ ms: 200, sampleRate: 24000 }), { status: 200 })));
  }));
  const { tts } = azure(t, fetched);
  const warming = tts.warm(['ısınma bir', 'ısınma iki']);
  await until(() => gates.length === 1);
  const live = tts.speak('canlı replik');
  await until(() => gates.length === 2);
  assert.deepEqual(order, ['ısınma bir', 'canlı replik'], 'the live line does not wait for the warm request to finish');
  let finished = false;
  const everything = Promise.all([warming, live]).then((values) => { finished = true; return values; });
  while (!finished) {
    gates.shift()?.();
    await tick();
  }
  const [warmed, liveResult] = await everything;
  assert.equal(warmed, 2);
  assert.ok(liveResult);
  assert.deepEqual(order, ['ısınma bir', 'canlı replik', 'ısınma iki']);
});

// ---------------------------------------------------------------------------------------------------------------------
// Gerçek ses: yalnız Windows'ta ve kurulu bir Türkçe ses varsa çalışır.

test('tts integration: the real Windows voice says "Merhaba, ben Tarçın!"', { skip: process.platform !== 'win32' ? 'yalnız Windows' : false, timeout: 60_000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-tts-gercek-'));
  const tts = createTts({ provider: 'local', cacheDir: dir, env: {} });
  t.after(async () => {
    tts.close();
    await tick(200); // powershell.exe dosyaları bıraksın
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  const started = Date.now();
  while (tts.provider === 'local' && !tts.status().ready && tts.status().failures === 0 && Date.now() - started < 30_000) await tick(20);
  if (!tts.status().ready) {
    t.skip('Türkçe Windows sesi yok ya da işçi açılamadı: ' + (tts.status().lastError || 'hazır olmadı'));
    return;
  }

  const result = await tts.speak('Merhaba, ben Tarçın!', { timeoutMs: 15_000 });
  assert.ok(result, 'no audio: ' + tts.status().lastError);
  assert.match(result.name, /^[0-9a-f]{40}\.wav$/);
  assert.equal(result.file, path.join(dir, result.name));
  const info = wavInfo(fs.readFileSync(result.file));
  assert.ok(info, 'a real RIFF/WAVE PCM file');
  assert.equal(info.ms, result.ms);
  assert.ok(info.ms >= 700 && info.ms <= 4000, `plausible duration for three words, got ${info.ms} ms`);
  assert.ok(info.sampleRate >= 16000 && info.channels >= 1 && info.bits === 16, JSON.stringify(info));
  const samples = fs.readFileSync(result.file).subarray(64);
  let loud = 0;
  for (let i = 0; i + 1 < samples.length; i += 2) if (Math.abs(samples.readInt16LE(i)) > 1000) loud++;
  assert.ok(loud > 2000, 'the file contains sound, not silence');
  assert.deepEqual(await tts.speak('Merhaba, ben Tarçın!'), result, 'second time from the cache');

  // Turkish letters must reach the voice: the same word with and without them sounds different.
  for (const [turkish, plain] of [['çağ', 'cag'], ['şiş', 'sis'], ['kış', 'kis'], ['İğne', 'Igne']]) {
    const a = await tts.speak(turkish, { timeoutMs: 15_000 }), b = await tts.speak(plain, { timeoutMs: 15_000 });
    assert.ok(a && b, `${turkish} / ${plain}`);
    assert.equal(fs.readFileSync(a.file).equals(fs.readFileSync(b.file)), false, `"${turkish}" and "${plain}" must not be the same audio`);
  }
  // Emotions change the delivery: excited is shorter than neutral, sad is longer.
  const line = 'Helal olsun Ayşe, İzmir doğru cevap, seksen puan senin oldu!';
  const [neutral, excited, sad] = [await tts.speak(line, { timeoutMs: 15_000 }), await tts.speak(line, { emotion: 'excited', timeoutMs: 15_000 }), await tts.speak(line, { emotion: 'sad', timeoutMs: 15_000 })];
  assert.ok(excited.ms < neutral.ms && neutral.ms < sad.ms, `excited ${excited.ms} < neutral ${neutral.ms} < sad ${sad.ms}`);
  assert.equal(tts.status().failures, 0, tts.status().lastError || '');
  assert.deepEqual(fs.readdirSync(dir).filter((name) => !/^[0-9a-f]{40}\.wav$/.test(name)), [], 'only finished cache files in the folder');
});

test('sohbet tonunda nötr hız normaldir ve iki tonun kayıtları ayrıdır', () => {
  const line = { provider: 'local', voice: 'Tolga', emotion: 'happy', text: 'Hoş geldin!' };
  assert.equal(prosodyFor('neutral', 'local', 'natural').rate, '+0%');
  assert.notEqual(cacheKey(line), cacheKey({ ...line, delivery: 'natural' }));
  assert.ok(parseInt(prosodyFor('excited', 'azure', 'natural').pitch) <= 4);
});
