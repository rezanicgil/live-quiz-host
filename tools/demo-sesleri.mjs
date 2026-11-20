// Sunucusuz demonun (sahne ?mock=1) ses paketini üretir: public/mock.js içindeki demoLines() listesindeki her cümleyi
// yerel Pocket sesiyle seslendirir, MP3'e çevirir ve public/demo-voice/ altına manifest.json ile birlikte yazar.
// Kullanım: node tools/demo-sesleri.mjs      (Pocket kurulu olmalı: POCKET_SES_KUR.bat ya da POCKET_DIR=başka/kurulum)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTts } from '../server/tts.js';
import { demoLines } from '../public/mock.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pocketDir = process.env.POCKET_DIR ? path.resolve(process.env.POCKET_DIR) : path.join(root, 'data', 'pocket-tts');
const python = path.join(pocketDir, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!fs.existsSync(python)) { console.log('Pocket kurulu değil: ' + pocketDir); process.exit(1); }
const out = path.join(root, 'public', 'demo-voice'), work = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-ses-'));
const voice = process.env.DEMO_VOICE || 'female_2', delivery = process.env.DEMO_DELIVERY || 'presenter';
const tts = createTts({ provider: 'pocket', pocketDir, pocketVoice: voice, delivery, cacheDir: work, fallback: false });

const lines = demoLines(), jobs = [], manifest = {};
try {
  for (const [i, line] of lines.entries()) {
    const clip = await tts.speak(line.text, { emotion: line.emotion, timeoutMs: 180000 });
    if (!clip) throw new Error('seslendirilemedi: ' + line.text);
    const file = crypto.createHash('sha1').update(voice + '|' + delivery + '|' + line.emotion + '|' + line.text).digest('hex').slice(0, 12) + '.mp3';
    jobs.push([path.join(work, clip.name), path.join(out, file)]); manifest[line.text] = { file, ms: clip.ms };
    process.stdout.write(`\r${i + 1}/${lines.length}`);
  }
} finally { tts.close(); }
// WAV → MP3: Pocket ortamındaki soundfile (libsndfile) ile; ayrı bir araç kurmak gerekmez.
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const list = path.join(work, 'jobs.json'); fs.writeFileSync(list, JSON.stringify(jobs));
execFileSync(python, ['-c', 'import json,sys,soundfile as sf\nfor src,dst in json.load(open(sys.argv[1],encoding="utf-8")):\n    data,rate=sf.read(src)\n    sf.write(dst,data,rate,format="MP3")', list], { stdio: 'inherit' });
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
const bytes = fs.readdirSync(out).reduce((n, f) => n + fs.statSync(path.join(out, f)).size, 0);
fs.rmSync(work, { recursive: true, force: true });
console.log(`\n${lines.length} cümle · ${voice} · ${delivery} · ${(bytes / 1048576).toFixed(1)} MB → ${out}`);
