// Bil Bakalım yayın özeti: data/show-log/GÜN.jsonl dosyasını okur, yayının sayılarını yazar.
// Kullanım: node tools/yayin-ozeti.mjs [YYYY-AA-GG]   (tarih verilmezse en son günlük)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize } from '../server/journal.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', process.env.DATA_DIR || 'data', 'show-log');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort() : [];
const pick = process.argv[2] ? process.argv[2] + '.jsonl' : files.at(-1);
if (!pick || !files.includes(pick)) { console.log(files.length ? 'Bu tarihte günlük yok. Olanlar: ' + files.map((f) => f.slice(0, 10)).join(', ') : 'Henüz yayın günlüğü yok (ilk canlı yayından sonra oluşur).'); process.exit(0); }
const s = summarize(fs.readFileSync(path.join(dir, pick), 'utf8').split('\n').filter(Boolean));
const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '—');
const rate = (a, b) => (b ? '%' + Math.round((100 * a) / b) : '—');
console.log(`Bil Bakalım · ${pick.slice(0, 10)} · ${hm(s.first)}–${hm(s.last)} (${s.minutes} etkin dakika)`);
console.log(`İzleyici zirvesi: ${s.peakViewers} · aynı anda en çok yorum yazan: ${s.peakActive} · katılan: ${s.joins}`);
console.log(`Yorum: ${s.chats} · tahmin: ${s.guesses} · doğru: ${s.correct} · sohbet cevabı: ${s.answers}`);
console.log(`Soru: ${s.solved} bilindi, ${s.timeouts} bilinemedi (${rate(s.solved, s.solved + s.timeouts)} bilinme)`);
console.log(`Beğeni: ${s.likes} · takip: ${s.follows} · paylaşım: ${s.shares}`);
console.log(`Tarçın: ${s.says} replik, ${s.silent} tanesi sessiz (${rate(s.silent, s.says)}) · yapay zekâ cevabı: ${s.ai}`);
const conn = s.events.baglanti || 0; if (conn) console.log(`Olay kaynağının durumu ${conn} kez değişti.`);
