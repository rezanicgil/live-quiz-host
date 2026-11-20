// Bil Bakalım: olay kaynakları. Prova izleyicisi ve dışarıdan takılan kaynak modülü (SHOW_SOURCE).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDemoAudience } from '../server/sources/demo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('prova izleyicisi: yalnız bilinen olay türlerini üretir, önce katılır, sıfırlanınca baştan başlar', (t) => {
  let seed = 11; t.mock.method(Math, 'random', () => (seed = (seed * 16807) % 2147483647) / 2147483647);
  const events = [], state = { phase: 'ask', answer: 'İZMİR', opened: 2 };
  const audience = createDemoAudience({ emit: (ev) => events.push(ev), peek: () => state, answers: ['ANKARA', 'BURSA'] });
  for (let i = 0; i < 600; i++) audience.tick();
  assert.equal(events[0].type, 'join', 'kimse katılmadan olay üretilmez');
  assert.deepEqual([...new Set(events.map((e) => e.type))].sort(), ['chat', 'follow', 'join', 'like', 'share']);
  assert.ok(events.every((e) => /^sim-\d+$/.test(e.user.id) && e.user.nick), 'herkes prova kullanıcısıdır');
  const chats = events.filter((e) => e.type === 'chat').map((e) => e.text);
  assert.ok(events.filter((e) => e.type === 'chat').every((e) => Number.isFinite(e.at) && e.at <= Date.now()), 'her yorum platform damgası taşır');
  assert.ok(chats.includes('izmir'), 'soru açıkken doğru cevabı yazan çıkar'); assert.ok(chats.includes('ankara') || chats.includes('bursa'), 'yanlış tahminler de gelir');
  assert.equal(new Set(events.filter((e) => e.type === 'join').map((e) => e.user.id)).size, events.filter((e) => e.type === 'join').length, 'aynı kişi iki kez katılmaz');
  state.phase = 'break'; const before = events.length; for (let i = 0; i < 200; i++) audience.tick();
  assert.ok(events.slice(before).some((e) => e.type === 'chat'), 'molada sohbet sürer');
  audience.reset(); events.length = 0; for (let i = 0; i < 40 && !events.length; i++) audience.tick();
  assert.equal(events[0].type, 'join', 'sıfırlanınca izleyiciler yeniden katılır');
});

/** Sunucuyu geçici veri klasörüyle açar; `use(base)` bitince kapatır. */
async function withServer(env, use) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bil-kaynak-'));
  const child = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: { ...process.env, PORT: '0', DATA_DIR: dir, SHOW_TTS: 'off', ANTHROPIC_API_KEY: '', LAN: '', ...env(dir) } });
  try {
    const base = await new Promise((resolve, reject) => {
      let out = ''; const timer = setTimeout(() => reject(new Error('sunucu açılmadı: ' + out)), 15000);
      child.stdout.on('data', (d) => { out += d; const m = /http:\/\/localhost:(\d+)\/panel/.exec(out); if (m) { clearTimeout(timer); resolve('http://127.0.0.1:' + m[1]); } });
      child.stderr.on('data', (d) => { out += d; }); child.on('exit', (c) => reject(new Error('sunucu kapandı ' + c + ': ' + out)));
    });
    await use(base);
  } finally { child.kill(); await new Promise((r) => setTimeout(r, 200)); fs.rmSync(dir, { recursive: true, force: true }); }
}
const stateOf = async (base) => (await fetch(base + '/api/state')).json();

test('dış kaynak: SHOW_SOURCE ile verilen modül bağlanır, olayları şova girer, ilk bağlanışta şov baştan başlar', async () => {
  await withServer((dir) => {
    const file = path.join(dir, 'kaynak.mjs');
    fs.writeFileSync(file, `export function createSource({ onEvent, onStatus }) {
      return { connect() { onStatus({ state: 'connected', detail: 'deneme kaynağı' });
        setTimeout(() => { const user = { id: 'k1', nick: 'Kaynaktan' }; onEvent({ type: 'join', user }); onEvent({ type: 'chat', user, text: 'merhaba', at: Date.now() }); onEvent({ type: 'viewers', count: 7 }); }, 150); },
        disconnect() {} }; }`);
    return { SHOW_SOURCE: file };
  }, async (base) => {
    await new Promise((r) => setTimeout(r, 900));
    const state = await stateOf(base);
    assert.deepEqual(state.live, { state: 'connected', detail: 'deneme kaynağı' }); assert.equal(state.demo, false);
    assert.equal(state.viewers, 7); assert.equal(state.participation.people, 1, 'sohbet yazan kişi sayıldı');
    assert.ok(state.log.some((l) => /Kaynak bağlandı: şov açılıştan başlıyor/.test(l.text)), 'ilk bağlanışta açılış yeniden oynar');
    const known = 't phase round index total double q outcomes takingGuesses nextHintIn graceLeft timeLeft timeTotal winners leaders podium night paused highlights chat viewers likes live demo settings log participation tts ai bank'.split(' ');
    assert.deepEqual(Object.keys(state).filter((key) => !known.includes(key)), [], 'durumda belgelenmemiş alan yok (docs/PROTOCOL.md)');
  });
});

test('dış kaynak: yüklenemeyen modül şovu durdurmaz, durum uyarıya döner; kaynak yoksa durum boştur', async () => {
  await withServer(() => ({ SHOW_SOURCE: './olmayan-kaynak.mjs' }), async (base) => {
    await new Promise((r) => setTimeout(r, 500));
    const state = await stateOf(base);
    assert.equal(state.live.state, 'warning'); assert.match(state.live.detail, /^Kaynak yüklenemedi: /); assert.equal(state.phase, 'lobby');
  });
  await withServer(() => ({ SHOW_SOURCE: '' }), async (base) => {
    const state = await stateOf(base); assert.deepEqual(state.live, { state: 'idle', detail: '' });
  });
});
