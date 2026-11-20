// Bil Bakalım: sohbet niyeti. Tahmin olmayan yorumlardan sunucunun hazır cevabı olanları ayırır (selam, nasılsın, nasıl oynanır…).
// Eşleşmeyen yorumlar isteğe bağlı yapay zekâ sohbetine (ai.js) kalır.
import { fold } from './normalize.js';
import { PROVINCES } from './provinces.js';

// Sıra önemlidir: önce özgül olanlar. Kalıplar katlanmış (küçük harf, ASCII) metne uygulanır.
const RULES = [
  ['nasilOynanir', /\b(nasil oyn|ne yaz(icaz|acagiz|iyoruz|cam|acam|malim|iyim)|kural(lar)? ne|oyun ne|nasil katil|ne yapicaz|ne yapacagiz|nasil oluyor|ne yapmam lazim)/],
  ['botMusun', /\b(bot ?mu(sun)?|yapay ?zeka|gercek ?mi(sin)?|robot ?mu(sun)?|insan ?mi(sin)?|ai ?mi(sin)?)\b/],
  ['yas', /\bkac yasinda/],
  ['nereli', /\b(nerelisin|memleketin nere|nerden yayin|nereden yayin)/],
  ['kimsin', /\b(sen kimsin|kimsin sen|adin ne|ismin ne|bu kim|kim bu)\b/],
  ['puanim', /\b(puanim|kac puan(im)?|siram|kacinciyim|kacinci siradayim)\b/],
  ['kopya', /\b(?:kopya (?:ver|versene|verir misin)|(?:cevabi|cevabini) (?:fisilda|fisildasana|fisildar misin|soylesene)|aramizda kalsin cevabi soyle)\b/],
  ['ipucu', /\b(ipucu|harf ac|bir harf( daha)?)\b/],
  ['diliminUcunda', /\b(?:dilimin ucunda(?:ydi)?|aklima gelmiyor|adini (?:unuttum|hatirlayamadim))\b/],
  ['ilkBen', /\b(?:ilk ben (?:yazdim|bildim|yazmistim)|ben (?:once|ilk|daha once) (?:yazdim|bildim)|once ben yazdim|benimki sayilmadi|beni saymadi|haksizlik|hile var)\b/],
  ['yetisemedim', /\b(?:yetisemedim|yazana kadar (?:bildiler|bitti)|yazarken (?:bildiler|bitti)|son anda kacirdim)\b/],
  ['espri', /\b(?:(?:espri|espiri|saka|fikra) (?:yap|yapsana|yapar misin|anlat|anlatsana|anlatir misin|patlat)|(?:beni|bizi) guldur(?:sene)?)\b/],
  ['zor', /\b(cok zor|zormus|zor ya|zor soru|bilemedim|bilmiyorum)\b/],
  ['kolay', /\b(cok kolay|kolaymis|kolay soru|cok basit)\b/],
  ['veda', /\b(gorusuruz|bay bay|bye|hosca ?kal(in)?|iyi geceler|kactim|cikiyorum|ben kacar|allaha emanet)\b/],
  ['tesekkur', /\b(tesekkur(ler| ederim)?|tsk|tesekkurler|sag ?ol(un)?|eyvallah|saol)\b/],
  ['iltifat', /\b(tatlisin|sirinsin|guzelsin|supersin|harikasin|mukemmelsin|efsanesin|seni seviyorum|bayildim|cok tatli|cok sirin|cok iyisin)\b/],
  ['nasilsin', /\b(nasilsin(iz)?|naber|nbr|ne haber|nasil gidiyor|iyi misin|keyifler nasil)\b/],
  ['selam', /^(selam(lar)?|slm|sa|s a|merhaba(lar)?|mrb|meraba|hey|iyi aksamlar|hayirli aksamlar|gunaydin|selamun aleykum|aleykum selam|as)\b/],
];

const CITIES = PROVINCES.map((p) => ({ name: p.name, key: fold(p.name) }))
  .concat([{ name: 'Urfa', key: 'urfa' }, { name: 'Antep', key: 'antep' }, { name: 'Maraş', key: 'maras' }, { name: 'Afyon', key: 'afyon' }, { name: 'İzmit', key: 'izmit' }])
  .sort((a, b) => b.key.length - a.key.length);

/**
 * Memleket: "Sivaslıyım", "İzmir'den selam", "Ankara burada". Molada ve açılışta yalnız il adı da sayılır
 * (sunucu "Nereden izliyorsunuz?" diye sormuştur); soru açıkken yalnız il adı tahmin olabilir, sayılmaz.
 */
export function cityOf(text, { open = false } = {}) {
  const f = fold(text); if (!f) return null;
  for (const c of CITIES) {
    if (open && (f === c.key || f === c.key + ' burada')) return c.name;
    if (new RegExp('(^| )' + c.key + ' ?(li|lu)(yim|yum|yiz|yuz)?( |$)').test(f)) return c.name;
    if (new RegExp('(^| )' + c.key + ' ?(dan|den|tan|ten)( |$)').test(f)) return c.name;
    if (new RegExp('(^| )' + c.key + ' burada( |$)').test(f)) return c.name;
  }
  return null;
}

/**
 * @param {string} text izleyicinin yorumu
 * @param {{ phase?: string }} ctx
 * @returns {{ intent: string, il?: string } | null}
 */
export function matchIntent(text, { phase = 'ask' } = {}) {
  const raw = String(text ?? ''); if ([...raw].length > 80) return null;
  const f = fold(raw); if (!f) return null;
  const il = cityOf(raw, { open: phase === 'break' || phase === 'lobby' || phase === 'podium' });
  if (il) return { intent: 'memleket', il };
  for (const [intent, re] of RULES) if (re.test(f)) return { intent };
  return null;
}

/** Sunucuya hitap ediyor mu (yapay zekâ sohbeti için): adı geçiyor ya da soru soruyor. */
export function addressesHost(text, hostName) {
  const f = fold(text), h = fold(hostName);
  return (!!h && (' ' + f + ' ').includes(' ' + h)) || /\?\s*$/.test(String(text)) || /\b(sen|sana|senin|seni)\b/.test(f);
}
