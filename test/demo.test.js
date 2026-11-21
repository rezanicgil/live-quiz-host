// Bil Bakalım: sunucusuz demo (sahne ?mock=1). Ses paketi, demonun söylediği cümlelerle birebir örtüşmeli;
// sahne dosyaları alt klasörden de açılabilmeli (kök dizine bağlı adres kullanmamalı).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoLines } from '../public/mock.js';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

test('demo ses paketi: tam döngünün her cümlesinin kaydı var, fazlası yok', () => {
  const lines = demoLines(), manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'demo-voice', 'manifest.json'), 'utf8'));
  assert.ok(lines.length >= 50, 'cümle listesi: ' + lines.length);
  assert.equal(new Set(lines.map((l) => l.text)).size, lines.length, 'yinelenen cümle yok');
  assert.deepEqual(Object.keys(manifest).sort(), lines.map((l) => l.text).sort(), 'paket eskidi: node tools/demo-sesleri.mjs ile yeniden üret');
  for (const [text, clip] of Object.entries(manifest)) {
    assert.match(clip.file, /^[a-f0-9]{12}\.mp3$/, text); assert.ok(clip.ms >= 500 && clip.ms <= 12000, text + ': ' + clip.ms);
    assert.ok(fs.statSync(path.join(PUBLIC, 'demo-voice', clip.file)).size > 2000, text);
  }
  const files = fs.readdirSync(path.join(PUBLIC, 'demo-voice')).filter((f) => f.endsWith('.mp3'));
  assert.equal(files.length, lines.length, 'kullanılmayan kayıt yok');
});

test('demo derlemesi: yalnız sahne ve ses paketi girer, sayfa sunucusuz kipte açılır', async (t) => {
  const { buildDemo } = await import('../tools/demo-derle.mjs');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-derle-')); t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const files = buildDemo(out).map((f) => f.replaceAll('\\', '/'));
  assert.ok(files.includes('index.html') && files.includes('mock.js') && files.includes('demo-voice/manifest.json') && files.includes('assets/fonts/Nunito-Variable.ttf'));
  assert.deepEqual(files.filter((f) => /panel|studio|\.wav$/.test(f)), [], 'panel ve canlı şov kayıtları demoya girmez');
  assert.match(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), /<html lang="tr" data-mock="1">/);
  assert.doesNotMatch(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), /data-mock/, 'kaynak sayfa değişmez');
});

test('sahne alt klasörden açılabilir: sayfa, betikler ve stiller kök dizine bağlı adres kullanmaz', () => {
  for (const name of ['index.html', 'main.js', 'mock.js', 'sound.js', 'fx.js', 'host.js', 'show.css', 'final.css']) {
    const source = fs.readFileSync(path.join(PUBLIC, name), 'utf8');
    const rooted = [...source.matchAll(/(?:href|src)="\/[^"/][^"]*"|from '\/[^']+'|import\('\/[^']+'\)|url\('\/[^']+'\)|fetch\('\/[^']+'/g)].map((m) => m[0]);
    assert.deepEqual(rooted, [], name);
  }
});

/* ---------- ses kilidi (mobil) ---------- */
/** sound.js'in kurulurken dokunduğu kadarını karşılayan sahte ses bağlamı. */
function fakeAudio(initial) {
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = () => new Proxy({ connect() {}, disconnect() {}, start() {}, stop() {} }, { get: (t, k) => (k in t ? t[k] : (t[k] = param())), set: (t, k, v) => { t[k] = v; return true; } });
  return class {
    constructor() { this.state = initial; this.sampleRate = 100; this.currentTime = 0; this.destination = node(); this.resumes = 0; }
    createGain() { return node(); } createDynamicsCompressor() { return node(); } createAnalyser() { return node(); } createBiquadFilter() { return node(); }
    createOscillator() { return node(); } createBufferSource() { return node(); } createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    resume() { this.resumes += 1; this.state = 'running'; this.onstatechange?.(); return Promise.resolve(); }
  };
}
test('ses: bağlam çalışmıyorsa kilitli sayılır, sayfaya ilk dokunuş açar; iPhone sessiz tuşu için oturum türü ayarlanır', async (t) => {
  const { createSound } = await import('../public/sound.js');
  const old = globalThis.window; t.after(() => { if (old === undefined) delete globalThis.window; else globalThis.window = old; });
  for (const initial of ['suspended', 'interrupted']) {
    const events = {}, session = { type: 'auto' };
    globalThis.window = { AudioContext: fakeAudio(initial), navigator: { audioSession: session }, addEventListener: (type, fn) => { events[type] = fn; } };
    const sound = createSound(), states = []; sound.onState((s) => states.push(s));
    assert.equal(session.type, 'playback', 'sessiz tuşu Web Audio sesini kısmasın');
    assert.equal(sound.locked, true, initial + ' durumunda ses kilitli');
    assert.deepEqual(Object.keys(events).sort(), ['click', 'keydown', 'pointerdown', 'pointerup', 'touchend'], 'iOS dokunuşun bitişini hareket sayar');
    events.touchend(); assert.equal(sound.locked, false); assert.deepEqual(states, ['running']);
  }
  globalThis.window = { AudioContext: fakeAudio('running'), addEventListener() {} };
  assert.equal(createSound().locked, false, 'ses baştan çalışıyorsa düğme hiç görünmez');
  globalThis.window = {};
  assert.equal(createSound().locked, false, 'ses bağlamı olmayan tarayıcıda düğme görünmez');
});

test('demo: ses sonradan açılınca şov açılıştan yeniden başlar', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const { startMock } = await import('../public/mock.js');
  const seen = [], mock = startMock((m) => seen.push(m));
  const state = () => seen.findLast((m) => m.t === 'state');
  const advance = (ms) => { for (let at = 0; at < ms; at += 100) t.mock.timers.tick(100); };   // iç içe kurulan zamanlayıcılar sırayla çalışsın
  advance(30000);
  assert.equal(state().phase, 'ask'); assert.equal(state().index, 1); const clue = state().q.clue;
  seen.length = 0; mock.restart();
  assert.deepEqual([state().phase, state().round, state().index], ['lobby', 1, 0]); assert.ok(seen.some((m) => m.t === 'fx' && m.list.some((f) => f.type === 'lobby')));
  advance(26000);
  assert.deepEqual([state().phase, state().index, state().q.clue], ['ask', 1, clue], 'aynı ilk soruyla baştan');
  assert.deepEqual(startMock(() => {}, { scene: 'ask' }), {}, 'donmuş sahnede yeniden başlatma yok');
});
