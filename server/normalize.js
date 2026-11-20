// Bil Bakalım: yorumları ve cevapları karşılaştırılabilir biçime getirir, tahmini değerlendirir.
// İzleyici "IZMIR", "izmır", "İzmir!" yazsa da aynı sayılır (Türkçe klavyesi olmayan da oynayabilsin).

const MAP = { 'ı': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u' };

/** Küçük harf (tr), Türkçe harfler ASCII'ye, harf/rakam dışı her şey boşluğa; boşluklar tekilleşir. */
export function fold(text) {
  return String(text ?? '').normalize('NFKC').toLocaleLowerCase('tr-TR')
    .replace(/[ışğüöçâîû]/g, (c) => MAP[c]).replace(/i̇/g, 'i')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
const squeeze = (s) => s.replace(/ /g, '');

/** Damerau-Levenshtein (komşu harf yer değiştirme tek hata sayılır); kısa metinler için. */
export function distance(a, b) {
  const n = a.length, m = b.length;
  if (!n) return m; if (!m) return n;
  let prev2 = null, prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
    }
    prev2 = prev; prev = cur;
  }
  return prev[m];
}

export const MAX_GUESS = 60;

/**
 * Yorumu cevap(lar)la karşılaştırır.
 * @returns {'correct'|'near'|'wrong'} doğru: eşit ya da kısa bir yorumun içinde tam kelime olarak geçiyor; yakın: 1 (≥4 harf) ya da 2 (≥8 harf) hata.
 */
export function judge(text, answers) {
  const raw = String(text ?? '');
  if ([...raw].length > MAX_GUESS) return 'wrong';
  const f = fold(raw); if (!f) return 'wrong';
  const fs = squeeze(f);
  let near = false;
  for (const answer of answers) {
    const a = fold(answer), as = squeeze(a); if (!as) continue;
    if (f === a || fs === as) return 'correct';
    if (f.length <= a.length + 15 && (' ' + f + ' ').includes(' ' + a + ' ')) return 'correct';
    const allow = as.length >= 8 ? 2 : as.length >= 4 ? 1 : 0;
    if (allow && Math.abs(fs.length - as.length) <= allow && distance(fs, as) <= allow) near = true;
  }
  return near ? 'near' : 'wrong';
}

/** Tahmine benziyor mu: kısa, en çok üç kelime (uzun sohbet cümleleri tahmin şeridine düşmesin). */
export function guessLike(text) {
  const f = fold(text);
  return !!f && f.length <= 24 && f.split(' ').length <= 3;
}

/** Türkçe büyük harf. */
export const upper = (s) => String(s ?? '').toLocaleUpperCase('tr-TR');
