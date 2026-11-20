// Bil Bakalım: soru bankasını yükler, doğrular ve tur planına göre soru seçer.
import fs from 'node:fs';
import { fold, upper } from './normalize.js';

export const TYPES = ['kelime', 'plaka', 'atasozu', 'emoji'];
export const CATEGORIES = ['memleket', 'yemek', 'futbol', 'dizi-film', 'doga', 'tarih', 'gunluk', 'muzik', 'genel', 'uzay', 'icat', 'sanat', 'dil'];
const ANSWER = /^[A-ZÇĞİÖŞÜ]+( [A-ZÇĞİÖŞÜ]+)?$/;
const letters = (s) => [...s].filter((c) => c !== ' ').length;

/**
 * Ham bankayı denetler; geçerli soruları oyun biçimine çevirir.
 * @returns {{ items: object[], errors: string[] }}
 */
export function validateBank(raw) {
  const errors = [], items = [], ids = new Set(), list = Array.isArray(raw?.sorular) ? raw.sorular : null;
  if (!list) return { items, errors: ['"sorular" dizisi yok'] };
  for (const q of list) {
    const id = String(q?.id ?? ''), bad = (why) => errors.push(`${id || '?'}: ${why}`);
    if (!id) { bad('id yok'); continue; }
    if (ids.has(id)) { bad('id yineleniyor'); continue; }
    if (!TYPES.includes(q.tip)) { bad('tip geçersiz'); continue; }
    if (!CATEGORIES.includes(q.kategori)) { bad('kategori geçersiz'); continue; }
    const answer = upper(String(q.cevap ?? '').trim()), clue = String(q.ipucu ?? '').trim();
    if (!ANSWER.test(answer) || letters(answer) < 2 || letters(answer) > 14) { bad('cevap biçimi'); continue; }
    if (!clue || [...clue].length > 110) { bad('ipucu boş ya da uzun'); continue; }
    const accept = (Array.isArray(q.kabul) ? q.kabul : []).map((a) => upper(String(a).trim())).filter(Boolean);
    const hint = q.tur ? String(q.tur).trim() : null;
    if ((q.tip === 'kelime' || q.tip === 'emoji') && !hint) { bad('tur yok'); continue; }
    if (q.tip === 'atasozu' && !clue.includes('___')) { bad('atasözünde ___ yok'); continue; }
    if (q.tip === 'kelime' && (' ' + fold(clue) + ' ').includes(' ' + fold(answer) + ' ')) { bad('ipucu cevabı içeriyor'); continue; }
    const plate = q.tip === 'plaka' ? (/\d{1,2}/.exec(clue)?.[0] ?? null) : null;
    if (q.tip === 'plaka' && !plate) { bad('plaka numarası yok'); continue; }
    const riddle = q.bilmece ? String(q.bilmece).trim() : null;
    if (q.tip === 'emoji' && riddle && (!riddle.endsWith('?') || [answer, ...accept].some(a => (' ' + fold(riddle) + ' ').includes(' ' + fold(a) + ' ')))) { bad('emoji bilmecesi cevabı veriyor veya soru değil'); continue; }
    const difficulty = [1, 2, 3].includes(q.zorluk) ? q.zorluk : 2;
    ids.add(id);
    items.push({ id, type: q.tip, category: q.kategori, clue, hint, answer, accept, plate: plate ? plate.padStart(2, '0') : null,
      emoji: q.tip === 'emoji' ? clue : null, riddle, fact: q.bilgi ? String(q.bilgi).trim() : null, say: riddle || String(q.oku || '').trim() || clue, difficulty });
  }
  return { items, errors };
}

export function loadBank(file) {
  const { items, errors } = validateBank(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!items.length) throw new Error('Soru bankası boş: ' + (errors[0] || file));
  return { items, errors };
}

// Tur planı: her sıradaki sorunun türü ve zorluğu. Son soru çifte puandır ve biraz daha zordur.
// 'karisik' bankada ayrı tutulmaz: 4–8 harfli tek kelimelik bir "kelime" sorusu karışık harflerle sunulur.
export const ROUND_PLAN = [
  ['kelime', 1], ['kelime', 1], ['plaka', 1], ['kelime', 2], ['karisik', 1],
  ['kelime', 2], ['atasozu', 2], ['kelime', 2], ['emoji', 2], ['kelime', 3],
];

/** Harfleri karıştırır; sonuç asla cevabın kendisi olmaz (bütün harfler aynı değilse). */
export function scramble(answer, rng = Math.random) {
  const chars = [...answer.replace(/ /g, '')];
  for (let attempt = 0; attempt < 8; attempt++) {
    const a = [...chars];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    if (a.join('') !== chars.join('')) return a;
  }
  return chars.reverse();
}

/**
 * Soru seçici. Yakın zamanda sorulanı yeniden sormaz (kimlikler `recent`'te tutulur, banka tükenince en eskiler serbest kalır),
 * aynı kategoriyi art arda getirmemeye çalışır, tür ve zorluk için tur planına uyar.
 */
export function createPicker({ items, rng = Math.random, recent = [], perRound = ROUND_PLAN.length }) {
  const used = [...recent], keep = Math.max(perRound, Math.floor(items.length * 0.7));
  let lastCategory = null, queued = null;
  const slotOf = (index) => ROUND_PLAN[(index - 1) % ROUND_PLAN.length] || ['kelime', 2];
  const fits = (q, kind) => kind === 'karisik' ? q.type === 'kelime' && !q.answer.includes(' ') && [...q.answer].length >= 4 && [...q.answer].length <= 8 : q.type === kind;
  function choose(index) {
    // Tazelik türüne göre: her türün son %70'i yeniden sorulmaz (küçük havuzlar, örn. 81 plaka, tükenince de yakın tekrar olmaz).
    const [kind, level] = slotOf(index), stale = new Set();
    for (const type of new Set(items.map((q) => q.type))) {
      const ids = items.filter((q) => q.type === type).map((q) => q.id), mine = used.filter((id) => ids.includes(id));
      for (const id of mine.slice(-Math.floor(ids.length * 0.7))) stale.add(id);
    }
    const fresh = (q) => !stale.has(q.id);
    const pools = [
      (q) => fits(q, kind) && fresh(q) && q.difficulty === level && q.category !== lastCategory,
      (q) => fits(q, kind) && fresh(q) && q.difficulty === level,
      (q) => fits(q, kind) && fresh(q) && Math.abs(q.difficulty - level) <= 1,
      (q) => fits(q, kind) && fresh(q),
      (q) => fits(q, kind),
      (q) => fresh(q) && q.type === 'kelime',
      () => true,
    ];
    for (const test of pools) {
      const pool = items.filter(test);
      if (pool.length) { const q = pool[Math.floor(rng() * pool.length)]; return { q, kind: fits(q, kind) ? kind : q.type }; }
    }
    return null;
  }
  function present({ q, kind }) {
    return { ...q, type: kind, scramble: kind === 'karisik' ? scramble(q.answer, rng) : null,
      hint: kind === 'karisik' ? q.clue : kind === 'emoji' ? q.hint : null,
      clue: kind === 'karisik' ? 'Harfleri sırala: ' + q.clue : kind === 'emoji' ? (q.riddle || 'Emojiler ne anlatıyor? (' + q.hint + ')') : q.clue,
      say: kind === 'karisik' ? 'Harfler karışmış! ' + (q.say || q.clue) : kind === 'emoji' && q.say === q.emoji ? 'Emojilere bak! İpucu: ' + q.hint + '.' : q.say };
  }
  return {
    /** Sıradaki soruya bakar (önceden seslendirmek için); `next` aynı soruyu verir. */
    peek(index) { if (!queued || queued.index !== index) { const c = choose(index); queued = c && { index, item: present(c) }; } return queued?.item ?? null; },
    next(index) {
      const item = this.peek(index); queued = null; if (!item) return null;
      used.push(item.id); while (used.length > keep) used.shift();
      lastCategory = item.category;
      return item;
    },
    recent: () => [...used],
  };
}
