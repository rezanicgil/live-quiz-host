// Sunucusuz demoyu tek bir statik klasöre derler: sahne dosyaları ve hazır ses paketi. Panel ve canlı şovun kısa ses
// kayıtları girmez; sayfa sunucu aramadan doğrudan prova döngüsünü oynatır. Çıkan klasör herhangi bir statik sunucuya,
// herhangi bir alt klasöre kopyalanabilir.
// Kullanım: node tools/demo-derle.mjs [çıktı klasörü]      (varsayılan: dist/demo)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['index.html', 'main.js', 'host.js', 'fx.js', 'sound.js', 'mock.js', 'show.css', 'final.css'];
const FOLDERS = ['assets', 'demo-voice'];

/** `out` klasörünü baştan kurar ve derlenen dosyaların listesini döndürür. */
export function buildDemo(out) {
  const source = path.join(root, 'public');
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  for (const name of FILES) fs.copyFileSync(path.join(source, name), path.join(out, name));
  for (const name of FOLDERS) fs.cpSync(path.join(source, name), path.join(out, name), { recursive: true });
  const page = path.join(out, 'index.html'), html = fs.readFileSync(page, 'utf8');
  if (!html.includes('<html lang="tr">')) throw new Error('index.html başlığı beklenen biçimde değil');
  fs.writeFileSync(page, html.replace('<html lang="tr">', '<html lang="tr" data-mock="1">'));
  return fs.readdirSync(out, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(out, f)).isFile()).sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(process.argv[2] || path.join(root, 'dist', 'demo')), files = buildDemo(out);
  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(out, f)).size, 0);
  console.log(`${files.length} dosya · ${(bytes / 1048576).toFixed(1)} MB → ${out}`);
}
