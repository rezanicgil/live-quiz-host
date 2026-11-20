import { fold } from './provinces.js';

// Ekrana çıkmaması gereken sözlerin kökleri (katlanmış biçimde). Liste bilerek kısa ve net tutuldu;
// config.json içindeki "blockedWords" ile genişletilir.
const BUILTIN = ['orospu', 'siktir', 'sikeyim', 'sikerim', 'sikim', 'amcik', 'amina', 'aminak', 'yarrak', 'yarak',
  'gavat', 'pezevenk', 'kahpe', 'ibne', 'gotveren', 'anani', 'serefsiz', 'kaltak', 'amk'];
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

function squash(text) {
  return fold(text).replace(/[013457@$]/g, (c) => LEET[c]).replace(/[^a-z]/g, '');
}

/**
 * Nick ve yorumları ekrana çıkmadan önce süzer.
 * @param {string[]} extra yayıncının eklediği yasaklı sözler
 */
export function createFilter(extra = []) {
  const stems = [...BUILTIN, ...extra.map(squash)].filter(Boolean);
  const isBlocked = (text) => { const s = squash(text); return stems.some((w) => s.includes(w)); };
  const cleanNick = (raw) => {
    const kept = String(raw ?? '').normalize('NFKC').replace(/[^\p{L}\p{N}_.\- ]/gu, '').replace(/\s+/g, ' ').trim();
    const short = [...kept].slice(0, 16).join('').trim();
    return !short || isBlocked(short) ? 'yolcu' : short;
  };
  return { isBlocked, cleanNick };
}
