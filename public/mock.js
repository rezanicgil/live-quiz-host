// Sahte sunucu: ?mock=1 ile sahne sunucusuz çalışır. Sözleşmedeki iletileri (hello / state / fx / say, url:null)
// gerçek iletilerle aynı `deliver` yolundan verir. Buradaki her şey PROVA verisidir; gerçek izleyici değildir.
//   startMock(deliver, { scene })
//   scene yok  → tam döngü: açılış (kural → sohbet sorusu) → tur → sorular (bilinen / süresi dolan)
//                → kürsü → mola (MOLA, sohbet sorusu) → yeni tur; arada sosyal olaylar (katılma, takip, paylaşım, beğeni, coşku)
//   scene var  → o sahnede donar (ekran görüntüsü için):
//     lobby sohbet intro ask solved cevap timeout podium podiumbos break molabos final
//     akin vurgu balon plaka karisik emoji atasozu uzun iki cift cheer rekor

const up = (s) => String(s).toLocaleUpperCase('tr-TR');
const TITLES = ['Çıtır Pati', 'Jet Pati', 'İpucu Dedektifi', 'Ters Köşe Ustası', 'Yorum Profesörü', 'Sohbetin Efsanesi'];   // server/players.js ile aynı unvanlar
const PEOPLE = ['Ayşe', 'Mert', 'Deniz', 'Ece', 'Can', 'Zeynep', 'Burak', 'Elif', 'Kerem', 'Selin', 'Yusuf', 'Defne', 'İrem', 'Çağrı', 'Gülşah', 'mehmet_34', 'Ozan', 'Nazlı']
  .map((nick, i) => ({ id: 'mock-' + (i + 1), nick }));
const titleOf = (u) => TITLES[(Number(u.id.slice(5)) * 7) % TITLES.length];
const P = (name) => PEOPLE.find((p) => p.nick.startsWith(name)) || PEOPLE[0];
const IDLE = ['lobby', 'podium', 'break'];   // bu evrelerde soru yoktur (q null)

const BANK = [
  { type: 'kelime', category: 'memleket', clue: 'Ege\'nin incisi, saat kulesiyle ünlü şehir', answer: 'İZMİR', wrong: ['aydın', 'manisa'], near: 'izmit', fact: 'İzmir Saat Kulesi 1901 yılında yapıldı.' },
  { type: 'plaka', category: 'memleket', clue: '58 plakalı ilimiz', plate: '58', answer: 'SİVAS', wrong: ['tokat', 'kayseri'], near: 'sivaz', fact: null },
  { type: 'atasozu', category: 'genel', clue: 'Damlaya damlaya ___ olur', answer: 'GÖL', wrong: ['deniz', 'su'], near: null, fact: null },
  { type: 'karisik', category: 'memleket', clue: 'Karışık harfleri diz', hint: 'bir şehir', scramble: ['L', 'A', 'Y', 'T', 'A', 'N', 'A'], answer: 'ANTALYA', wrong: ['alanya', 'ankara'], near: 'antalia', fact: null },
  { type: 'emoji', category: 'yemek', clue: 'Emojilerin anlattığı yiyecek', hint: 'bir yiyecek', emoji: '🧀🍞🔥', answer: 'TOST', wrong: ['pizza', 'börek'], near: 'tos', fact: null },
  { type: 'kelime', category: 'dizi-film', clue: 'Polat Alemdar\'ın başrolünde olduğu efsane dizi', answer: 'KURTLAR VADİSİ', wrong: ['ezel', 'arka sokaklar'], near: 'kurtlar vadis', fact: 'Kurtlar Vadisi ilk kez 2003 yılında yayınlandı.' },
  { type: 'kelime', category: 'futbol', clue: 'Sarı kırmızı renkleriyle bilinen İstanbul takımı', answer: 'GALATASARAY', wrong: ['göztepe', 'kayserispor'], near: 'galatasray', fact: null },
  { type: 'plaka', category: 'memleket', clue: '03 plakalı ilimiz', plate: '03', answer: 'AFYONKARAHİSAR', wrong: ['adıyaman', 'ağrı'], near: 'afyonkarahisa', fact: null },
  { type: 'kelime', category: 'gunluk', clue: 'Kahvaltının vazgeçilmezi, ince belli bardakta içilir', answer: 'ÇAY', wrong: ['kahve', 'süt'], near: null, fact: null },
  { type: 'kelime', category: 'tarih', clue: 'İstanbul Boğazı\'ndaki küçük adada duran tarihi kule', answer: 'KIZ KULESİ', wrong: ['galata kulesi', 'beyazıt'], near: 'kız kules', fact: null },
  { type: 'kelime', category: 'muzik', clue: 'Uzun saplı, telli halk çalgımız', answer: 'BAĞLAMA', wrong: ['gitar', 'kanun'], near: 'baglma', fact: null },
  { type: 'kelime', category: 'doga', clue: 'Türkiye\'nin en büyük gölü', answer: 'VAN GÖLÜ', wrong: ['tuz gölü', 'beyşehir'], near: 'van gölu', fact: 'Van Gölü, dünyanın en büyük sodalı gölüdür.' },
];
const CHAT_LOBBY = 'Nereden izliyorsunuz? Şehrinizi yazın, başlamadan selam söyleyeyim.';
const CHAT_BREAK = ['Çay mı kahve mi?', 'Favori kategorin hangisi? Memleket mi, yemek mi, futbol mu?', 'Kaç kişiyle izliyorsun? Evdekilere de benden selam!'];

// Tam döngüde Tarçın'ın söylediği cümleler tek yerde durur: döngü de ses paketi de (tools/demo-sesleri.mjs) buradan okur,
// böylece ikisi birbirinden kopamaz.
const SAY = {
  acilis: 'Selam millet, ben Tarçın! Kural tek: ipucunu oku, cevabı yorumlara yaz. İlk bilen puanı kapar. Hadi başlayalım!',
  acilisHazir: 'Hazırsanız başlıyoruz! İlk ipucu yolda.', cifte: 'Turun son sorusu çifte puan, kaçırma!',
  emoji: 'Emojilere bak, ne anlatıyor?', karisik: 'Harfler karışmış, sen toparla bakalım!',
  yakin: 'Çok yaklaştın Zeynep, bir harf kaldı!', gerilim: 'İlk bilen sen ol, yaz bakalım!',
  turSonu: 'Herkesin eline sağlık, harika bir turdu!', kursuBos: 'Bu turda kürsü boş kaldı, sıradaki tur sizin!',
  molaBasla: 'Kısa bir sohbet molası! Soluklanalım.', molaYanit: 'Selin çay demiş. Demli olsun, afiyet olsun!',
  cosku: 'Alkış metre doldu! Bu enerji sizin eseriniz.',
  ipucu: (q) => (q.type === 'emoji' ? SAY.emoji : q.type === 'karisik' ? SAY.karisik : q.clue.replace(/_{2,}/, 'boşluk')),
  bildiAni: (nick) => `Helal olsun ${nick}! Bilenler çabuk olsun, son saniyeler!`,
  bildi: (answer) => `Cevap ${answer.toLocaleLowerCase('tr-TR')}! Bilenlerin hepsine aferin!`,
  sureBitti: (answer) => `Bu sefer bilen çıkmadı. Cevap ${answer.toLocaleLowerCase('tr-TR')} olacaktı, sıradaki sizin!`,
  sampiyon: (nick) => `Turun şampiyonu ${nick}! Ayakta alkışlıyorum!`,
};
const WINNERS = 6;   // tam döngüde soruyu ilk bilen ve tur şampiyonu hep ilk altı kişiden çıkar

/** Tam döngüde duyulabilecek bütün cümleler, duygusuyla (ses paketini üretmek için). */
export function demoLines() {
  const out = [[SAY.acilis, 'happy'], [CHAT_LOBBY, 'happy'], [SAY.acilisHazir, 'excited'], [SAY.cifte, 'excited'], [SAY.yakin, 'wow'], [SAY.gerilim, 'wink'],
    [SAY.turSonu, 'love'], [SAY.kursuBos, 'wink'], [SAY.molaBasla, 'happy'], [SAY.molaYanit, 'wink'], [SAY.cosku, 'excited'], ...CHAT_BREAK.map((text) => [text, 'happy'])];
  for (const q of BANK) out.push([SAY.ipucu(q), 'neutral'], [SAY.bildi(q.answer), 'happy'], [SAY.sureBitti(q.answer), 'sad']);
  for (const p of PEOPLE.slice(0, WINNERS)) out.push([SAY.bildiAni(p.nick), 'excited'], [SAY.sampiyon(p.nick), 'excited']);
  return [...new Map(out.map(([text, emotion]) => [text, { text, emotion }])).values()];
}

export function startMock(deliver, { scene = null } = {}) {
  const send = (m) => deliver(JSON.parse(JSON.stringify(m)));
  const fx = (...list) => send({ t: 'fx', list });
  let sayId = 0;
  // Hazır ses paketi (demo-voice/manifest.json: cümle → { file, ms }). Paket yoksa ya da cümle pakette değilse replik
  // alt yazıyla söylenir; sahne altına kısa bir mırıltı koyar.
  let voice = {}, busyUntil = 0;   // busyUntil: süren repliğin biteceği an
  if (typeof fetch === 'function') fetch(new URL('./demo-voice/manifest.json', import.meta.url)).then((r) => (r.ok ? r.json() : {})).then((list) => { voice = list || {}; }).catch(() => {});
  const say = (kind, text, emotion = 'neutral', gesture = null, ms = 0) => {
    const clip = voice[text]; busyUntil = Date.now() + (clip?.ms || ms || 2000) + 300;
    send({ t: 'say', id: ++sayId, kind, text, url: clip ? new URL('./demo-voice/' + clip.file, import.meta.url).href : null, ms: clip?.ms || ms || Math.max(1400, 500 + text.length * 62), emotion, gesture });
  };

  const st = {
    phase: 'lobby', round: 1, index: 0, total: 5, double: false, timeLeft: 21.5, timeTotal: 21.5, outcomes: [], chat: null,
    night: { solved: 37, record: 52 }, viewers: 112, likes: { count: 1340, fill: 0.42 }, highlights: { active: 0, streak: null, fast: null, firstTimers: 0 },
    live: { state: 'idle', detail: '' }, paused: false, demo: true, settings: { volumes: { voice: 1, music: 0.25, fx: 0.8 } },
  };
  let cur = null, scores = new Map(), winners = null, podium = null, phaseStart = Date.now(), frozen = false, bankAt = 0;
  let breakAt = 0;
  let timers = [];
  const T = (ms, fn) => { timers.push(setTimeout(fn, ms)); };
  const clearT = () => { timers.forEach(clearTimeout); timers = []; };

  const leaders = () => [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, points]) => { const u = PEOPLE.find((p) => p.id === id); return { id, nick: u.nick, points, title: titleOf(u) }; });
  const tiles = () => cur.letters.map((ch, i) => (ch === ' ' ? { ch: null, space: true } : { ch: cur.open[i] ? ch : null, space: false }));
  function snapshot() {
    const idle = IDLE.includes(st.phase);
    const m = { t: 'state', phase: st.phase, round: st.round, index: st.index, total: st.total, double: !idle && st.double, q: null, outcomes: st.outcomes,
      nextHintIn: st.phase === 'ask' && !frozen ? Math.max(0, 5 - (Math.floor((Date.now() - phaseStart) / 1000) % 5)) : st.phase === 'ask' ? 4 : null,
      graceLeft: st.phase === 'solved' ? Math.max(0, Math.ceil(st.timeLeft - 4)) : 0,
      timeLeft: Math.round(st.timeLeft * 10) / 10, timeTotal: st.timeTotal, winners: [], leaders: leaders(), podium: [], night: st.night, highlights: st.highlights,
      chat: st.chat, viewers: st.viewers,
      likes: { count: st.likes.count, fill: Math.round(st.likes.fill * 100) / 100 }, live: st.live, paused: st.paused, demo: st.demo, settings: st.settings };
    if (cur && !idle) {
      const q = cur.q;
      m.q = { type: q.type, category: q.category, clue: q.clue, hint: q.hint || null, plate: q.plate || null, emoji: q.emoji || null, tiles: tiles(), scramble: q.scramble || null };
    }
    if (st.phase === 'solved' && winners) m.winners = winners;
    if ((st.phase === 'podium' || st.phase === 'break') && podium) m.podium = podium;
    if (st.phase === 'ended') m.finalists = leaders().slice(0, 3);
    return m;
  }
  const push = () => send(snapshot());
  function enter(phase, seconds) { st.phase = phase; st.timeTotal = seconds; st.timeLeft = seconds; phaseStart = Date.now(); push(); }
  function load(q) { const letters = [...up(q.answer)]; cur = { q, letters, open: letters.map(() => false) }; winners = null; }
  const openCount = () => cur.open.filter(Boolean).length;
  const closedIdx = () => cur.letters.map((ch, i) => (ch !== ' ' && !cur.open[i] ? i : -1)).filter((i) => i >= 0);
  const keepHidden = () => Math.max(1, Math.ceil(cur.letters.filter((c) => c !== ' ').length * 0.3));
  function reveal(i) { cur.open[i] = true; fx({ type: 'reveal', pos: i, ch: cur.letters[i] }); push(); }
  const award = (user, points) => scores.set(user.id, (scores.get(user.id) || 0) + points);

  /* ---------- tam döngü ---------- */
  function lobby() {
    fx({ type: 'lobby' }); st.chat = null; enter('lobby', 21.5);   // açılış cümlesi sesli hâliyle yaklaşık 9 sn sürer
    T(1000, () => say('acilis', SAY.acilis, 'happy', 'wave', 4600));
    T(10200, () => { st.chat = CHAT_LOBBY; push(); say('acilisDavet', CHAT_LOBBY, 'happy', 'wave', 3800); });
    T(16500, () => say('acilisHazir', SAY.acilisHazir, 'excited', 'point', 2000));
    T(21000, () => { st.chat = null; fx({ type: 'roundStart', round: st.round }); question(); });
  }
  function question() {
    clearT(); st.index += 1; st.double = st.index === st.total; load(BANK[bankAt++ % BANK.length]);
    fx({ type: 'questionStart', index: st.index, total: st.total, qtype: cur.q.type, category: cur.q.category, double: st.double });
    const lead = st.double ? 3.3 : 2.5;   // çifte puan anonsu bitmeden ipucu okunmaz
    enter('intro', lead);
    if (st.double) say('cifte', SAY.cifte, 'excited', 'jump', 2000);
    T(lead * 1000, ask);
  }
  function ask() {
    const q = cur.q, willTimeout = st.index === 3;
    enter('ask', 35);
    say('ipucu', SAY.ipucu(q), 'neutral', 'point');
    for (let k = 0; k < 6; k++) T(7000 + k * 5000, () => { const c = closedIdx(); if (c.length > keepHidden()) reveal(c[(Math.random() * c.length) | 0]); });
    T(3600, () => fx({ type: 'guess', user: P('Mert'), text: q.wrong[0], verdict: 'wrong' }));
    T(5800, () => fx({ type: 'guess', user: P('Can'), text: q.wrong[1], verdict: 'wrong' }));
    if (q.near) T(8600, () => { fx({ type: 'guess', user: P('Zeynep'), text: q.near, verdict: 'near' }); say('yakin', SAY.yakin, 'wow', null, 1900); });
    T(10800, () => fx({ type: 'guess', user: P('Burak'), text: q.wrong[0], verdict: 'wrong' }));
    if (willTimeout) {
      T(17000, () => say('gerilim', SAY.gerilim, 'wink', null, 1700));
      T(24000, () => fx({ type: 'guess', user: P('Elif'), text: q.wrong[1], verdict: 'wrong' }));
      T(35000, timeout);
    } else T(12500 + (st.index % 3) * 2200, () => solve(PEOPLE[(st.index * 5 + st.round * 3) % WINNERS]));
  }
  function solve(user) {
    clearT();
    const fast = openCount() === 0, streak = (st.index + st.round) % 2 ? 3 : 1;
    const points = Math.round(Math.max(30, 100 - 12 * openCount()) * (st.double ? 2 : 1) * (streak >= 3 ? 1.2 : 1));
    award(user, points); winners = [{ user, rank: 1, points }]; st.outcomes = [...st.outcomes, 'solved'];
    st.highlights = { ...st.highlights, fast: fast ? { nick: user.nick } : st.highlights.fast, streak: streak >= 3 ? { nick: user.nick, n: streak + st.round } : st.highlights.streak, firstTimers: st.highlights.firstTimers + (st.index % 2) };
    fx({ type: 'solved', user, points, open: openCount(), streak, first: false, fast, double: st.double });
    enter('solved', 9);
    say('bildiAni', SAY.bildiAni(user.nick), 'excited', 'clap', 2600);
    const others = PEOPLE.filter((p) => p.id !== user.id);
    T(1300, () => { const p = Math.round(points * 0.6); award(others[1], p); winners.push({ user: others[1], rank: 2, points: p }); fx({ type: 'alsoCorrect', user: others[1], rank: 2, points: p }); push(); });
    T(2500, () => { const p = Math.round(points * 0.4); award(others[3], p); winners.push({ user: others[3], rank: 3, points: p }); fx({ type: 'alsoCorrect', user: others[3], rank: 3, points: p }); push(); });
    T(5000, () => {
      cur.open = cur.open.map(() => true); st.night = { ...st.night, solved: st.night.solved + 1 };
      fx({ type: 'answer', answer: cur.q.answer, winners: winners.slice(0, 3) }, { type: 'others', count: 4 }); for (let k = 6; k < 10; k++) award(others[k], 10); push();
      say('bildi', SAY.bildi(cur.q.answer), 'happy', null, 2600);
    });
    T(5600, () => fx({ type: 'guess', user: others[9], text: cur.q.answer.toLocaleLowerCase('tr-TR'), verdict: 'late' }));
    if (st.index === 2) T(6200, () => fx({ type: 'levelUp', user, title: 'İpucu Dedektifi' }));
    T(9000, () => { fx({ type: 'questionEnd', answer: cur.q.answer, fact: cur.q.fact }); next(); });
  }
  function timeout() {
    clearT(); cur.open = cur.open.map(() => true); st.outcomes = [...st.outcomes, 'timeout'];
    fx({ type: 'timeout', answer: cur.q.answer }); enter('timeout', 5);
    say('sureBitti', SAY.sureBitti(cur.q.answer), 'sad', 'shrug', 3200);
    T(5000, () => { fx({ type: 'questionEnd', answer: cur.q.answer, fact: cur.q.fact }); next(); });
  }
  function next() { if (st.index >= st.total) roundEnd(); else question(); }
  function roundEnd() {
    clearT(); cur = null;
    podium = leaders().slice(0, 3);
    fx({ type: 'roundEnd', round: st.round, podium, champion: podium[0] ? { id: podium[0].id, nick: podium[0].nick } : null });
    enter('podium', 12);
    T(1500, () => say('sampiyon', podium[0] ? SAY.sampiyon(podium[0].nick) : SAY.kursuBos, podium[0] ? 'excited' : 'wink', podium[0] ? 'clap' : 'shrug', 3000));
    T(7000, () => say('turSonu', SAY.turSonu, 'love', 'heart', 2400));
    T(12000, brk);
  }
  function brk() {
    clearT(); st.chat = null; fx({ type: 'breakStart' }); enter('break', 26);
    const soru = CHAT_BREAK[breakAt++ % CHAT_BREAK.length];
    T(900, () => say('molaBasla', SAY.molaBasla, 'happy', 'wave', 2200));
    T(4400, () => { st.chat = soru; push(); say('molaSoru', soru, 'happy', null, 2600); });
    T(15000, () => say('molaYanit', SAY.molaYanit, 'wink', null, 2600));
    T(26000, () => { st.chat = null; st.round += 1; st.index = 0; st.outcomes = []; scores = new Map(); podium = null; st.highlights = { ...st.highlights, firstTimers: 0 }; fx({ type: 'roundStart', round: st.round }); question(); });
  }
  function social() {
    let n = 0;
    setInterval(() => {
      if (frozen) return; n += 1;
      const user = PEOPLE[(n * 7) % PEOPLE.length], roll = n % 10;
      if (roll === 1 || roll === 6) fx({ type: 'join', user, returning: n % 4 === 0, title: n % 4 === 0 ? titleOf(user) : null });
      else if (roll === 3) fx({ type: 'follow', user });
      else if (roll === 8) fx({ type: 'share', user });
      else {
        const count = 3 + (n % 5) * 4; st.likes.count += count; st.likes.fill += count / 160; fx({ type: 'like', user, count });
        if (st.likes.fill >= 1) { st.likes.fill = 0; fx({ type: 'cheer' }); setTimeout(() => { if (Date.now() >= busyUntil && st.phase === 'ask') say('cosku', SAY.cosku, 'excited', 'jump', 2200); }, 300); }
      }
      if (n % 5 === 0) st.highlights = { ...st.highlights, active: 8 + ((n * 3) % 40) };
      if (n % 9 === 0) st.viewers += (n % 2 ? 3 : -2);
    }, 1900);
  }

  /* ---------- donmuş sahneler ---------- */
  function seed(points) { scores = new Map(points.map(([name, p]) => [P(name).id, p])); }
  function freezeAt(phase, left, total) { st.phase = phase; st.timeLeft = left; st.timeTotal = total; frozen = true; push(); }
  function keepSaying(kind, text, emotion, gesture, ms = 5200) { const go = () => say(kind, text, emotion, gesture, ms); setTimeout(go, 500); setInterval(go, ms + 1800); }
  const every = (first, ms, fn) => { setTimeout(fn, first); setInterval(fn, ms); };
  function askScene(q, opened, left = 18.4) {
    st.round = 2; st.index = 4; st.total = 10; st.outcomes = ['solved', 'timeout', 'solved']; seed([['Ayşe', 310], ['Mert', 248], ['Zeynep', 180], ['Can', 96], ['Elif', 40]]);
    st.highlights = { active: 42, streak: { nick: 'Mert', n: 6 }, fast: { nick: 'Ayşe' }, firstTimers: 5 };
    load(q); fx({ type: 'questionStart', index: st.index, total: st.total, qtype: q.type, category: q.category, double: st.double });
    st.phase = 'intro'; st.timeLeft = 0.2; st.timeTotal = 2.5; push();
    freezeAt('ask', left, 35);
    opened.forEach((i, k) => setTimeout(() => reveal(i), 250 + k * 250));
  }
  function guesses(q) {
    setTimeout(() => fx({ type: 'guess', user: P('Mert'), text: q.wrong[0], verdict: 'wrong' }), 500);
    setTimeout(() => fx({ type: 'guess', user: P('Zeynep'), text: q.near || q.wrong[1], verdict: q.near ? 'near' : 'wrong' }), 800);
    setTimeout(() => fx({ type: 'guess', user: P('Can'), text: q.wrong[1], verdict: 'wrong' }), 1100);
  }
  function solvedScene(revealed) {
    const q = BANK[0]; askScene(q, [0, 2]); guesses(q);
    setTimeout(() => {
      const user = P('Ayşe'); winners = [{ user, rank: 1, points: 76 }, { user: P('Mert'), rank: 2, points: 46 }, { user: P('Deniz'), rank: 3, points: 30 }];
      award(user, 76);
      fx({ type: 'solved', user, points: 76, open: 2, streak: 3, first: false, fast: true, double: false });
      freezeAt('solved', revealed ? 2.4 : 6.5, 8);
      setTimeout(() => fx({ type: 'alsoCorrect', user: P('Mert'), rank: 2, points: 46 }), 300);
      setTimeout(() => fx({ type: 'alsoCorrect', user: P('Deniz'), rank: 3, points: 30 }, { type: 'others', count: 5 }), 500);
      if (revealed) setTimeout(() => { cur.open = cur.open.map(() => true); fx({ type: 'answer', answer: q.answer, winners }); push(); fx({ type: 'questionEnd', answer: q.answer, fact: q.fact }); }, 900);
      keepSaying('bildi', revealed ? 'Cevap İzmir! Mert\'le Deniz de bildi, aferin!' : 'Helal Ayşe! Üçte üç yaptı, durdurulamıyor!', 'excited', 'clap');
    }, 1500);
  }
  function breakScene(chat = CHAT_BREAK[0]) {
    st.round = 2; st.index = 10; st.total = 10; seed([['Ayşe', 410], ['Mert', 318], ['Zeynep', 244], ['Can', 96], ['Elif', 40]]); podium = leaders().slice(0, 3);
    st.highlights = { active: 42, streak: { nick: 'Mert', n: 6 }, fast: { nick: 'Ayşe' }, firstTimers: 5 };
    st.chat = chat; cur = null;
    fx({ type: 'breakStart' }); freezeAt('break', 14, 26);
  }
  const SCENES = {
    lobby() { fx({ type: 'lobby' }); freezeAt('lobby', 9, 14); keepSaying('acilis', 'Selam millet, ben Tarçın! Kural tek: ipucunu oku, cevabı yorumlara yaz. İlk bilen puanı kapar. Hadi başlayalım!', 'happy', 'wave'); },
    sohbet() { fx({ type: 'lobby' }); st.chat = CHAT_LOBBY; st.highlights = { active: 12, streak: null, fast: null, firstTimers: 0 }; freezeAt('lobby', 4, 14); keepSaying('acilisDavet', CHAT_LOBBY, 'happy', 'wave'); setTimeout(() => fx({ type: 'join', user: P('Selin'), returning: false, title: null }), 900); },
    intro() {
      st.round = 2; st.index = 4; st.total = 10; seed([['Ayşe', 310], ['Mert', 248], ['Zeynep', 180]]); load(BANK[0]);
      fx({ type: 'questionStart', index: 4, total: 10, qtype: 'kelime', category: 'memleket', double: false }); freezeAt('intro', 1.2, 2.5);
    },
    ask() { askScene(BANK[0], [0, 2]); guesses(BANK[0]); setTimeout(() => fx({ type: 'join', user: P('Selin'), returning: false, title: null }, { type: 'follow', user: P('Deniz') }), 700); keepSaying('ipucu', BANK[0].clue, 'neutral', null); },
    solved() { solvedScene(false); },
    cevap() { solvedScene(true); },
    timeout() {
      const q = BANK[0]; askScene(q, [0, 2], 0.4); guesses(q);
      setTimeout(() => { cur.open = cur.open.map(() => true); fx({ type: 'timeout', answer: q.answer }); freezeAt('timeout', 3.2, 5); fx({ type: 'questionEnd', answer: q.answer, fact: q.fact }); keepSaying('sureBitti', 'Bu sefer bilen çıkmadı. Cevap İzmir\'di, sıradaki sizin!', 'sad', 'shrug'); }, 1300);
    },
    podium() {
      st.round = 2; st.index = 10; st.total = 10; seed([['Ayşe', 410], ['Mert', 318], ['Zeynep', 244], ['Can', 96], ['Elif', 40]]);
      podium = leaders().slice(0, 3); fx({ type: 'roundEnd', round: 2, podium, champion: { id: podium[0].id, nick: podium[0].nick } }); freezeAt('podium', 8, 12);
      keepSaying('sampiyon', 'Turun şampiyonu Ayşe! Ayakta alkışlıyorum!', 'excited', 'clap');
    },
    podiumbos() { st.round = 2; st.index = 10; st.total = 10; podium = []; fx({ type: 'roundEnd', round: 2, podium, champion: null }); freezeAt('podium', 8, 12); keepSaying('sampiyon', 'Bu turda kürsü boş kaldı, sıradaki tur sizin!', 'wink', 'shrug'); },
    break() {
      breakScene();
      setTimeout(() => fx({ type: 'join', user: P('Selin'), returning: true, title: 'Ters Köşe Ustası' }, { type: 'share', user: P('Ozan') }), 600);
      keepSaying('molaSoru', CHAT_BREAK[0], 'happy', 'wave', 3200);
    },
    molabos() { breakScene(null); keepSaying('molaBasla', 'Kısa bir sohbet molası! Soluklanalım.', 'happy', 'wave'); },
    // Bildirim akını: 40 katılma tek çipte toplanır; takip ve unvan çipleri düşmez.
    akin() {
      askScene(BANK[0], [0, 2]); guesses(BANK[0]);
      every(800, 9000, () => {
        fx(...PEOPLE.slice(0, 3).map((user) => ({ type: 'join', user, returning: false, title: null })));
        fx({ type: 'levelUp', user: P('Ayşe'), title: 'İpucu Dedektifi' }, { type: 'follow', user: P('Deniz') });
        fx(...Array.from({ length: 40 }, (_, i) => ({ type: 'join', user: { id: 'akin-' + i, nick: 'gelen_' + i }, returning: false, title: null })));
      });
    },
    vurgu() { askScene(BANK[0], [0, 2]); guesses(BANK[0]); keepSaying('ipucu', BANK[0].clue, 'neutral', null); },
    balon() { askScene(BANK[0], [0, 2]); guesses(BANK[0]); keepSaying('sohbet', 'Harfler açılıyor, az sabır; ben de senin gibi merakla bekliyorum ama mikrofon açıkken kopya verirsem ikimiz de fena yakalanırız dostum!', 'wink', null, 7000); },
    plaka() { askScene(BANK[1], [0]); guesses(BANK[1]); keepSaying('ipucu', '58 plakalı ilimiz hangisi?', 'think', null); },
    karisik() { askScene(BANK[3], [0, 3], 21); guesses(BANK[3]); keepSaying('ipucu', 'Harfler karışmış, sen toparla bakalım!', 'wink', null); },
    emoji() { askScene(BANK[4], [0], 24); guesses(BANK[4]); keepSaying('ipucu', 'Emojilere bak, ne anlatıyor?', 'wow', null); },
    atasozu() { askScene(BANK[2], [], 27); keepSaying('ipucu', 'Damlaya damlaya ne olur?', 'think', null); },
    uzun() { askScene(BANK[7], [0, 4, 9], 12); guesses(BANK[7]); keepSaying('ipucu', '03 plakalı ilimiz, hadi bakalım!', 'neutral', null); },
    iki() { askScene(BANK[5], [0, 8, 3], 9); guesses(BANK[5]); keepSaying('ipucu', BANK[5].clue, 'neutral', null); },
    cift() { st.double = true; askScene(BANK[9], [0, 4], 4.2); guesses(BANK[9]); },
    cheer() { askScene(BANK[0], [0, 2]); guesses(BANK[0]); st.likes.fill = 1; push(); every(700, 3600, () => fx({ type: 'cheer' }, { type: 'like', user: P('Ece'), count: 30 })); keepSaying('cosku', 'Alkış metre doldu! Bu enerji sizin eseriniz.', 'excited', 'jump'); },
    rekor() { solvedScene(true); setTimeout(() => { st.night = { solved: 53, record: 53 }; push(); fx({ type: 'levelUp', user: P('Ayşe'), title: 'İpucu Dedektifi' }, { type: 'record', solved: 53 }); }, 3000); },
    final() { st.round = 3; st.index = 10; st.total = 10; seed([['Ayşe', 410], ['Mert', 318], ['Zeynep', 244], ['Can', 96]]); st.night = { solved: 41, record: 52 }; cur = null; freezeAt('ended', 0, 0); },
  };

  send({ t: 'hello', build: 'mock', demo: true, title: 'Bil Bakalım', host: { name: 'Tarçın' } });
  setInterval(() => { if (!frozen) st.timeLeft = Math.max(0, st.timeTotal - (Date.now() - phaseStart) / 1000); push(); }, 500);
  if (scene && SCENES[scene]) { frozen = true; SCENES[scene](); return {}; }
  seed([]); lobby(); social();
  /** Şovu açılıştan yeniden başlatır (ziyaretçi sesi sonradan açtığında açılışı sesli duysun diye). */
  function restart() {
    clearT(); cur = null; winners = null; podium = null; bankAt = 0; breakAt = 0; scores = new Map();
    Object.assign(st, { round: 1, index: 0, double: false, outcomes: [], chat: null, highlights: { active: 0, streak: null, fast: null, firstTimers: 0 } });
    lobby();
  }
  return { restart };
}
