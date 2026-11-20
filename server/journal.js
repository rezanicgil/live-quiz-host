// Bil Bakalım yayın günlüğü: yayın bitince "ne oldu" sorusunu cevaplayabilmek için olayları diske yazar.
// data/show-log/YYYY-AA-GG.jsonl (git dışı, yalnız bu bilgisayarda). Her satır bir olay; dakikada bir sayaç özeti.
// Yorumlar yalnız sayılır; takip, şampiyon gibi olaylarda takma ad yazılır. Tek istisna yapay zekâ cevabıdır: denetlenebilsin
// diye cevabı tetikleyen yorum ve verilen cevap birlikte yazılır. Provada kapalıdır.
import fs from 'node:fs';
import path from 'node:path';

const blank = () => ({ joins: 0, chats: 0, guesses: 0, correct: 0, likes: 0, follows: 0, shares: 0, says: 0, silent: 0, ai: 0, answers: 0 });

export function createJournal({ dir, enabled = true, now = Date.now } = {}) {
  let buf = [], counts = blank();
  const day = () => new Date(now()).toLocaleDateString('sv-SE');   // yerel tarih, YYYY-AA-GG
  function flush() {
    if (!buf.length) return true;
    try { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, day() + '.jsonl'), buf.join('\n') + '\n'); buf = []; return true; } catch { if (buf.length > 5000) buf = buf.slice(-1000); return false; }
  }
  return {
    /** Tek olay: {t, type, ...data}. */
    event(type, data = {}) { if (enabled) buf.push(JSON.stringify({ t: new Date(now()).toISOString(), type, ...data })); },
    count(key, n = 1) { if (enabled) counts[key] = (counts[key] || 0) + n; },
    /** Dakikalık özet: sayaçlar + anlık değerler (izleyici, etkin yorumcu). Boş dakika yazılmaz. */
    minute(extra = {}) {
      if (!enabled) return;
      if (Object.values(counts).some(Boolean) || extra.viewers) this.event('dakika', { ...counts, ...extra });
      counts = blank(); flush();
    },
    flush, setEnabled(on) { if (!on) flush(); enabled = !!on; }, pending: () => buf.length,
  };
}

/** Bir günlük dosyasını özetler (tools/yayin-ozeti.mjs kullanır). */
export function summarize(lines) {
  const sum = blank(), out = { ...sum, minutes: 0, peakViewers: 0, peakActive: 0, solved: 0, timeouts: 0, first: null, last: null, events: {} };
  for (const line of lines) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    out.first ??= e.t; out.last = e.t; out.events[e.type] = (out.events[e.type] || 0) + 1;
    if (e.type === 'dakika') { out.minutes += 1; for (const k of Object.keys(sum)) out[k] += e[k] || 0; out.peakViewers = Math.max(out.peakViewers, e.viewers || 0); out.peakActive = Math.max(out.peakActive, e.active || 0); }
    else if (e.type === 'soru') { if (e.solved) out.solved += 1; else out.timeouts += 1; }
  }
  return out;
}
