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
