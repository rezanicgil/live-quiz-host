// Prova izleyicisi: gerçek izleyici yokken şovu denemek için uydurma katılımcılar üretir (katılma, alkış, takip, paylaşım,
// sohbet ve tahmin). Buradaki herkes ve her şey PROVA verisidir. Diğer olay kaynaklarıyla aynı olay biçimini kullanır;
// tek farkı açık sorunun cevabını bilmesidir, yoksa hiçbir soru bilinmezdi.
const NAMES = ['Ayşe', 'Mehmet', 'Zeynep', 'Mustafa', 'Elif', 'Emre', 'Fatma', 'Can', 'Deniz', 'Ece', 'Burak', 'Selin', 'Kerem', 'İrem', 'Onur', 'Merve', 'Yusuf', 'Büşra', 'Ali', 'Gizem', 'Hakan', 'Derya', 'Serkan', 'Esra', 'Tolga', 'Nazlı', 'Barış', 'Seda', 'Okan', 'Pınar'];
const CHAT = ['selam', 'merhaba', 'nasılsın Tarçın', 'nasıl oynanıyor', 'çok zor ya', 'Tarçın çok tatlısın', 'iyi geceler', 'bot musun', 'puanım kaç'];
const CITY = ['Sivaslıyım', "İzmir'den selam", 'Ankara burada', 'Trabzonluyum', "Adana'dan selamlar", 'Bursa', 'Konyalıyım'];
const rnd = (list) => list[Math.floor(Math.random() * list.length)];
const lower = (text) => text.toLocaleLowerCase('tr-TR');

/**
 * @param {object} deps
 * @param {(ev:object)=>void} deps.emit olayı şova verir
 * @param {()=>{phase:string, answer:string|null, opened:number}} deps.peek şovun o anki durumu
 * @param {string[]} deps.answers yanlış tahmin olarak yazılacak başka cevaplar
 */
export function createDemoAudience({ emit, peek, answers }) {
  const users = [];
  // Gerçek bir platform gibi her yoruma "platforma ulaştığı an" damgası vurur; damga, yorumun bize gelişinden 0–400 ms
  // öncedir (ağ gecikmesi). Böylece provada da foto-finiş sıralaması ve "kaç saniye sonra" bilgisi görülür.
  const chat = (user, text) => emit({ type: 'chat', user, text, at: Date.now() - Math.floor(Math.random() * 400) });
  /** Yaklaşık 0,6 saniyede bir çağrılır; her çağrıda en çok bir olay üretir. */
  function tick() {
    const r = Math.random(), { phase, answer, opened } = peek();
    if (users.length < NAMES.length && r < 0.22) { const i = users.length, user = { id: 'sim-' + i, nick: NAMES[i] + (i % 4 === 3 ? '_' + (10 + i) : '') }; users.push(user); return emit({ type: 'join', user }); }
    if (!users.length) return;
    const user = rnd(users);
    if (r < 0.3) return emit({ type: 'like', user, count: 3 + Math.floor(Math.random() * 28) });
    if (r < 0.315) return emit({ type: 'follow', user });
    if (r < 0.33) return emit({ type: 'share', user });
    if (phase === 'ask' && answer) {
      const p = Math.random(), right = lower(answer);
      if (p < 0.03 + 0.035 * opened) return chat(user, right);   // harf açıldıkça bilen çıkma olasılığı artar
      if (p < 0.2) { const c = [...right], i = Math.floor(Math.random() * c.length); c[i] = c[i] === 'a' ? 'e' : 'a'; return chat(user, c.join('')); }   // bir harf farkla kaçıran
      if (p < 0.75) return chat(user, lower(rnd(answers)));
      return chat(user, rnd(CHAT));
    }
    if (phase === 'solved' && answer && r < 0.7) return chat(user, lower(answer));
    if (phase === 'break' || phase === 'lobby' || phase === 'podium') return chat(user, Math.random() < 0.6 ? rnd(CITY) : rnd(CHAT));
  }
  return { tick, reset() { users.length = 0; } };
}
