// Bir günün yayın günlüğünden (data/show-log/GÜN.jsonl) adsız, dakikalık toplamları çıkarır: izleyici, yorum, doğru cevap,
// replik sayıları. Takma ad, yorum metni ya da soru cevabı yazılmaz; çıktı paylaşılabilir.
// Kullanım: node tools/yayin-verisi.mjs YYYY-AA-GG [çıktı.json]   (DATA_DIR ile başka bir veri klasörü okunabilir)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const day = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) { console.log('Kullanım: node tools/yayin-verisi.mjs YYYY-AA-GG [çıktı.json]'); process.exit(1); }
const file = path.join(process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data'), 'show-log', day + '.jsonl');
if (!fs.existsSync(file)) { console.log('Günlük yok: ' + file); process.exit(1); }
const events = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
const hm = (iso) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

// Oturum: izleyicisi ve hareketi olan ardışık dakikalar; beş dakikadan uzun boşluk yeni oturum sayılır.
const sessions = [];
for (const m of events.filter((e) => e.type === 'dakika' && (e.viewers || 0) > 0 && (e.chats || 0) + (e.says || 0) > 0)) {
  const t = new Date(m.t).getTime(); let s = sessions.at(-1);
  if (!s || t - s.end > 5 * 60000) { s = { start: t, end: t, rows: [] }; sessions.push(s); }
  s.end = t; s.rows.push(m);
}
const sum = (rows, key) => rows.reduce((n, r) => n + (r[key] || 0), 0);
const out = {
  date: day,
  note: 'Per-minute aggregates from the show\'s own journal. No usernames, message texts or answers.',
  columns: ['time', 'viewers', 'activeChatters', 'chatMessages', 'correctAnswers', 'hostLines', 'silentLines'],
  sessions: sessions.map((s) => {
    const questions = events.filter((e) => e.type === 'soru' && new Date(e.t).getTime() >= s.start - 60000 && new Date(e.t).getTime() <= s.end + 60000);
    return { from: hm(s.rows[0].t), to: hm(s.rows.at(-1).t), minutes: s.rows.length,
      peakViewers: Math.max(...s.rows.map((r) => r.viewers || 0)), peakActiveChatters: Math.max(...s.rows.map((r) => r.active || 0)),
      joins: sum(s.rows, 'joins'), chatMessages: sum(s.rows, 'chats'), guesses: sum(s.rows, 'guesses'), correctAnswers: sum(s.rows, 'correct'),
      follows: sum(s.rows, 'follows'), shares: sum(s.rows, 'shares'), hostLines: sum(s.rows, 'says'), silentLines: sum(s.rows, 'silent'), llmReplies: sum(s.rows, 'ai'),
      questionsSolved: questions.filter((q) => q.solved).length, questionsTimedOut: questions.filter((q) => !q.solved).length,
      rows: s.rows.map((r) => [hm(r.t), r.viewers || 0, r.active || 0, r.chats || 0, r.correct || 0, r.says || 0, r.silent || 0]) };
  }),
};
const target = process.argv[3] || path.join(root, 'docs', 'metrics', day + '.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out, null, 1).replace(/\[\n\s+("[\d:]+"),\n\s+(\d+),\n\s+(\d+),\n\s+(\d+),\n\s+(\d+),\n\s+(\d+),\n\s+(\d+)\n\s+\]/g, '[$1, $2, $3, $4, $5, $6, $7]') + '\n');
console.log(`${out.sessions.length} oturum → ${target}`);
for (const s of out.sessions) console.log(`  ${s.from}–${s.to} · ${s.minutes} dk · zirve ${s.peakViewers} izleyici · ${s.chatMessages} yorum · ${s.questionsSolved} soru bilindi`);
