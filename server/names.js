// Bil Bakalım: takma addan seslendirilebilir ad çıkarır. "ayse_1994" → "Ayse", "★Mert★" → "Mert", "xx_1907_xx" → null.
// Okunamayan ya da yasaklı ad için null döner; sunucu o zaman adsız replik seçer (ekranda takma ad yine görünür).

const VOWEL = /[aeıioöuüâîû]/i, STOP = new Set(['user', 'official', 'the', 'bot', 'admin', 'live', 'canli', 'canlı', 'resmi', 'hesap', 'yolcu', 'misafir']);

export function speakable(nick, isBlocked = () => false) {
  const clean = String(nick ?? '').normalize('NFKC');
  const tokens = clean.split(/[^\p{L}]+/u).filter(Boolean);
  for (const token of tokens) {
    const chars = [...token];
    if (chars.length < 3 || chars.length > 14) continue;
    if (!VOWEL.test(token) || /^(.)\1+$/u.test(token)) continue;                 // sesli harf yok ya da tek harfin tekrarı
    if (!/^[a-zçğıöşüâîûA-ZÇĞİÖŞÜÂÎÛ]+$/.test(token)) continue;                    // Latin/Türkçe dışı yazı seslendirilmez
    if (/[bcçdfgğhjklmnprsştvyzqwx]{4,}/i.test(token)) continue;                  // dört ünsüz üst üste: okunmaz
    if (STOP.has(token.toLocaleLowerCase('tr-TR')) || isBlocked(token)) continue;
    return chars[0].toLocaleUpperCase('tr-TR') + chars.slice(1).join('').toLocaleLowerCase('tr-TR');
  }
  return null;
}

/** "Can, Ece ve Mert" */
export function joinNames(names) {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  return list.slice(0, -1).join(', ') + ' ve ' + list[list.length - 1];
}
