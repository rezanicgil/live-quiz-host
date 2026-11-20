// Bil Bakalım çekirdeği: normalleştirme, soru bankası, oyuncu belleği, ad, niyet ve oyun makinesi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, judge, guessLike, distance } from '../server/normalize.js';
import { validateBank, createPicker, scramble, ROUND_PLAN } from '../server/questions.js';
import { createPlayers, titleFor } from '../server/players.js';
import { speakable, joinNames } from '../server/names.js';
import { matchIntent, cityOf, addressesHost } from '../server/intents.js';
import { createEngine } from '../server/engine.js';

test('fold: Türkçe harf ve büyük-küçük fark etmez', () => {
  assert.equal(fold('İZMİR!'), 'izmir'); assert.equal(fold('IZMIR'), 'izmir'); assert.equal(fold('  Çiğ   Köfte '), 'cig kofte'); assert.equal(fold('ığüşöç'), 'igusoc');
});
test('judge: doğru, yakın, yanlış', () => {
  assert.equal(judge('izmir', ['İZMİR']), 'correct'); assert.equal(judge('IZMIR', ['İZMİR']), 'correct');
  assert.equal(judge('izmir mi acaba', ['İZMİR']), 'correct'); assert.equal(judge('cigkofte', ['ÇİĞ KÖFTE']), 'correct');
  assert.equal(judge('urfa', ['ŞANLIURFA', 'URFA']), 'correct');
  assert.equal(judge('izmit', ['İZMİR']), 'near'); assert.equal(judge('imzir', ['İZMİR']), 'near');
  assert.equal(judge('ankara', ['İZMİR']), 'wrong'); assert.equal(judge('cay', ['ÇAM']), 'wrong', 'üç harfli cevapta yakınlık sayılmaz');
  assert.equal(judge('bence cevap kesinlikle izmir olmalı arkadaşlar ne dersiniz', ['İZMİR']), 'wrong', 'uzun cümle içinde geçmesi sayılmaz');
  assert.equal(judge('x'.repeat(61), ['X']), 'wrong');
  assert.equal(distance('kitap', 'ktiap'), 1);
});
test('guessLike: kısa ve en çok üç kelime', () => {
  assert.ok(guessLike('izmir')); assert.ok(guessLike('çiğ köfte')); assert.ok(!guessLike('bu soru gerçekten çok zor olmuş')); assert.ok(!guessLike('!!!'));
});

const raw = (over = {}) => ({ id: 'k1', tip: 'kelime', kategori: 'yemek', ipucu: 'İnce belli bardakta içilir', tur: 'bir içecek', cevap: 'ÇAY', zorluk: 1, ...over });
test('validateBank: geçerli soruyu çevirir, bozukları atar', () => {
  const { items, errors } = validateBank({ sorular: [raw(), raw({ id: 'k2', cevap: 'çay 12' }), raw({ id: 'k3', ipucu: 'Çay demlenir' }), raw({ id: 'k1' }),
    raw({ id: 'p58', tip: 'plaka', kategori: 'memleket', ipucu: '58 plakalı ilimiz', cevap: 'SİVAS', tur: undefined, oku: 'Elli sekiz plakalı ilimiz hangisi?' }),
    raw({ id: 'a1', tip: 'atasozu', kategori: 'genel', ipucu: 'Damlaya damlaya göl olur', cevap: 'GÖL', tur: undefined }), raw({ id: 'k4', tur: undefined })] });
  assert.equal(items.length, 2); assert.equal(errors.length, 5);
  assert.deepEqual([items[0].answer, items[0].hint, items[0].say], ['ÇAY', 'bir içecek', 'İnce belli bardakta içilir']);
  assert.deepEqual([items[1].plate, items[1].say], ['58', 'Elli sekiz plakalı ilimiz hangisi?']);
});
test('picker: plana uyar, tekrar etmez, peek ile next aynı soruyu verir', () => {
  const items = []; let n = 0;
  for (const [type, count] of [['kelime', 30], ['plaka', 5], ['atasozu', 5], ['emoji', 5]]) for (let i = 0; i < count; i++) {
    n++; items.push({ id: type + i, type, category: ['yemek', 'genel', 'doga'][i % 3], clue: 'c' + n, hint: 'bir şey', answer: 'KELİME'.slice(0, 4 + (i % 3)), accept: [], say: 'c' + n, difficulty: 1 + (i % 3), emoji: type === 'emoji' ? '🍞' : null, plate: type === 'plaka' ? '58' : null });
  }
  const picker = createPicker({ items, rng: () => 0.5 }), seen = [];
  for (let round = 0; round < 2; round++) for (let i = 1; i <= ROUND_PLAN.length; i++) {
    const peeked = picker.peek(i), q = picker.next(i); assert.equal(peeked.id, q.id);
    assert.equal(q.type, ROUND_PLAN[i - 1][0]); seen.push(q.id);
    if (q.type === 'karisik') { assert.ok(Array.isArray(q.scramble)); assert.notEqual(q.scramble.join(''), q.answer); assert.match(q.clue, /Harfleri sırala/); }
  }
  assert.equal(new Set(seen).size, seen.length, 'iki turda aynı soru gelmedi');
  assert.notEqual(scramble('GÖL', () => 0.99).join(''), 'GÖL');
});

test('players: unvan, ilk doğru, geri gelen', () => {
  const p = createPlayers(), u = { id: '1', nick: 'Ayşe' };
  assert.deepEqual(p.seen(u), { first: true, returning: false, title: null, correct: 0 }); assert.equal(p.seen(u).first, false);
  const first = p.recordCorrect(u, { win: true, points: 80 }); assert.deepEqual([first.firstEver, first.title, first.levelUp], [true, 'Çıtır Pati', null]);
  for (let i = 0; i < 3; i++) assert.equal(p.recordCorrect(u, {}).levelUp, null);
  assert.equal(p.recordCorrect(u, {}).levelUp, 'Jet Pati'); assert.equal(p.titleOf('1'), 'Jet Pati'); assert.equal(titleFor(250), 'Sohbetin Efsanesi'); assert.equal(titleFor(0), null);
});

test('speakable: okunabilir ad ya da null', () => {
  assert.equal(speakable('ayse_1994'), 'Ayse'); assert.equal(speakable('★Mert★'), 'Mert'); assert.equal(speakable('MEHMET ALİ'), 'Mehmet'); assert.equal(speakable('İREM'), 'İrem');
  for (const bad of ['xx_1907_xx', 'user8823', '12345', 'krlgsptr', 'aaaa', '', 'Кирилл']) assert.equal(speakable(bad), null, bad);
  assert.equal(speakable('kotu soz', (s) => /kotu/.test(s)), 'Soz');
  assert.equal(joinNames(['Can', 'Ece', 'Mert']), 'Can, Ece ve Mert'); assert.equal(joinNames(['Can']), 'Can');
});
test('niyet: selam, kural, bot, memleket', () => {
  assert.equal(matchIntent('Selam Tarçın').intent, 'selam'); assert.equal(matchIntent('nasıl oynanıyor bu').intent, 'nasilOynanir');
  assert.equal(matchIntent('bot musun sen').intent, 'botMusun'); assert.equal(matchIntent('naber').intent, 'nasilsin'); assert.equal(matchIntent('iyi geceler herkese').intent, 'veda');
  assert.deepEqual(matchIntent('Sivaslıyım'), { intent: 'memleket', il: 'Sivas' }); assert.deepEqual(matchIntent("İzmir'den selam"), { intent: 'memleket', il: 'İzmir' });
  assert.equal(matchIntent('izmir'), null, 'soru açıkken yalnız il adı tahmindir'); assert.equal(cityOf('Ankara', { open: true }), 'Ankara');
  assert.equal(matchIntent('ankara', { phase: 'break' }).il, 'Ankara'); assert.equal(matchIntent('masa'), null);
  assert.ok(addressesHost('Tarçın en sevdiğin yemek ne', 'Tarçın')); assert.ok(addressesHost('kaç kişiyiz?', 'Tarçın')); assert.ok(!addressesHost('masa', 'Tarçın'));
});

test('Tarçın açıkça istenen espriyi ve oyunla ilgili takılmaları ayırt eder', () => {
  for (const [text, intent] of [
    ['Tarçın bir espiri yapsana', 'espri'], ['Bir şaka yapar mısın?', 'espri'],
    ['Cevabı fısılda!', 'kopya'], ['Dilimin ucundaydı', 'diliminUcunda'],
    ['Ben yazana kadar bildiler', 'yetisemedim'], ['Puanım kaç?', 'puanim'],
  ]) assert.equal(matchIntent(text)?.intent, intent, text);
  assert.equal(matchIntent('Şaka yapma'), null);
  assert.equal(matchIntent('fare'), null);
});

/* ---------- oyun makinesi ---------- */
const item = (answer, extra = {}) => ({ id: answer, type: 'kelime', category: 'genel', clue: 'ipucu', say: 'ipucu', answer, accept: [], fact: null, hint: null, ...extra });
function make(config = {}, answers = ['İZMİR', 'ÇAY', 'GÖL']) {
  let i = 0; const picker = { next: () => item(answers[i++ % answers.length], answers[i - 1] === 'ŞANLIURFA' ? { accept: ['URFA'] } : {}), peek: () => item(answers[i % answers.length]) };
  const players = createPlayers();
  return createEngine({ picker, players, config: { perRound: 3, lobbySeconds: 8, breakSeconds: 20, photoSeconds: 0, ...config }, rng: () => 0 });
}
const run = (e, seconds) => { const fx = []; for (let t = 0; t < seconds; t += 0.25) fx.push(...e.tick(0.25)); return fx; };
const types = (fx) => fx.map((f) => f.type);
const U = (n) => ({ id: 'u' + n, nick: 'Oyuncu' + n });
/** Açılıştan ilk sorunun ipucuna kadar ilerler. */
const toAsk = (e) => { e.tick(0.25); run(e, 8); run(e, 2.5); assert.equal(e.phase(), 'ask'); };

test('motor: açılış → tur → soru → ipucu', () => {
  const e = make(); assert.deepEqual(types(e.tick(0.25)), ['lobby']); assert.equal(e.snapshot().phase, 'lobby');
  assert.deepEqual(types(run(e, 8)), ['roundStart', 'questionStart']); assert.equal(e.phase(), 'intro');
  const fx = run(e, 2.5); assert.deepEqual(types(fx), ['ask']); assert.equal(fx[0].clue, 'ipucu');
  const s = e.snapshot(); assert.deepEqual([s.phase, s.round, s.index, s.total, s.timeTotal], ['ask', 1, 1, 3, 35]); assert.ok(s.q.tiles.every((t) => t.ch === null));
});
test('motor: harfler 7. saniyede başlar, 5 saniyede bir açılır, en az %30 kapalı kalır', () => {
  const e = make(); toAsk(e);
  assert.equal(run(e, 6.75).length, 0); assert.deepEqual(types(run(e, 0.25)), ['reveal']);
  const rest = run(e, 20).filter((f) => f.type === 'reveal'); assert.equal(rest.length, 2, 'beş harften üçü açılır, ikisi kapalı kalır');
  assert.equal(e.snapshot().q.tiles.filter((t) => t.ch).length, 3);
});
test('motor: ilk bilen puanı alır ama cevap tolerans bitene kadar açılmaz', () => {
  const e = make(); toAsk(e); run(e, 7);   // bir harf açık
  const fx = e.chat({ user: U(1), text: 'izmir' });
  assert.equal(fx[0].type, 'solved'); assert.equal(fx[0].points, 88); assert.equal(fx[0].answer, undefined, 'olayda cevap yok');
  let s = e.snapshot(); assert.equal(s.phase, 'solved'); assert.equal(s.q.tiles.filter((t) => t.ch).length, 1, 'kutular kapalı'); assert.equal(s.winners[0].user.id, 'u1');
  assert.deepEqual(e.chat({ user: U(1), text: 'izmir' }), [], 'aynı kişi ikinci kez puan alamaz');
  const second = e.chat({ user: U(2), text: 'İzmir' })[0], third = e.chat({ user: U(3), text: 'izmir!' })[0];
  assert.deepEqual([second.type, second.rank, second.points, third.rank, third.points], ['alsoCorrect', 2, 53, 3, 35]);
  assert.deepEqual(e.chat({ user: U(4), text: 'izmir' }), [], 'dördüncü bilen sessizce +10 alır');
  const end = run(e, 5); assert.deepEqual(types(end), ['answer', 'others']); assert.equal(end[0].answer, 'İZMİR'); assert.equal(end[1].count, 1);
  s = e.snapshot(); assert.ok(s.q.tiles.every((t) => t.ch)); assert.deepEqual(s.leaders.map((l) => l.points), [88, 53, 35, 10]);
  assert.equal(e.chat({ user: U(5), text: 'izmir' })[0].verdict, 'late');
  assert.deepEqual(types(run(e, 4.5)), ['questionEnd', 'questionStart']);
});
test('motor: yanlış ve yakın tahmin, sohbet cümlesi, tahmin aralığı', () => {
  const e = make(); toAsk(e);
  assert.equal(e.chat({ user: U(1), text: 'ankara' })[0].verdict, 'wrong'); assert.deepEqual(e.chat({ user: U(1), text: 'bursa' }), [], 'aynı kişi 1,2 sn içinde ikinci kez görünmez');
  assert.equal(e.chat({ user: U(2), text: 'izmit' })[0].verdict, 'near'); assert.deepEqual(e.chat({ user: U(3), text: 'bu ne ya', show: false }), []);
  assert.equal(e.verdict('izmir'), 'correct'); assert.equal(e.verdict('ankara'), 'wrong');
});
test('motor: süre biterse cevap açılır ve sıradaki soruya geçilir', () => {
  const e = make(); toAsk(e);
  const fx = run(e, 35); assert.equal(fx.at(-1).type, 'timeout'); assert.equal(fx.at(-1).answer, 'İZMİR'); assert.ok(e.snapshot().q.tiles.every((t) => t.ch));
  assert.deepEqual(types(run(e, 5)), ['questionEnd', 'questionStart']); assert.equal(e.snapshot().index, 2);
});
test('motor: tur sonu kürsü, mola, yeni tur; son soru çifte puan; seri primi', () => {
  const e = make(); toAsk(e);
  assert.equal(e.chat({ user: U(1), text: 'izmir' })[0].points, 100); run(e, 9.5); run(e, 2.5);
  assert.equal(e.chat({ user: U(1), text: 'çay' })[0].streak, 2); run(e, 9.5); run(e, 2.5);
  const last = e.chat({ user: U(1), text: 'göl' })[0]; assert.deepEqual([last.double, last.streak, last.points], [true, 3, 240], 'çifte puan ×2, seri +%20');
  const end = run(e, 9.5); assert.deepEqual(types(end), ['answer', 'others', 'questionEnd', 'roundEnd']);
  assert.deepEqual([end[3].podium[0].points, end[3].champion.nick], [440, 'Oyuncu1']); assert.equal(e.snapshot().podium.length, 1);
  assert.equal(e.snapshot().q, null, 'kürsüde soru alanı boş');
  assert.deepEqual(types(run(e, 12)), ['breakStart']); assert.equal(e.snapshot().q, null, 'molada sahne MOLA görünümünü gösterir'); const next = run(e, 20); assert.deepEqual(types(next), ['roundStart', 'questionStart']); assert.equal(next[0].round, 2);
  assert.deepEqual(e.snapshot().leaders, [], 'yeni turda sıralama sıfırlanır'); assert.equal(e.night().solved, 3);
});
test('motor: öne çıkanlar: ilk kez bilen sayılır, harf açılmadan bilen en hızlıdır', () => {
  const e = make(); toAsk(e); run(e, 7.5);   // ilk harf açıldı
  assert.equal(e.chat({ user: U(1), text: 'izmir' })[0].points, 88, 'açılan harf puanı düşürür');
  assert.deepEqual(e.snapshot().highlights, { streak: null, fast: null, firstTimers: 1 });
  const f = make(); toAsk(f); f.chat({ user: U(1), text: 'izmir' }); assert.deepEqual(f.snapshot().highlights.fast, { nick: 'Oyuncu1' });
});
test('seçici: küçük havuz tükenince de yakın tekrar olmaz', () => {
  const items = []; for (let i = 0; i < 5; i++) items.push({ id: 'p' + i, type: 'plaka', category: 'memleket', clue: 'c', hint: null, answer: 'İL' + 'ABCDE'[i], accept: [], say: 'c', difficulty: 1, plate: '0' + i });
  for (let i = 0; i < 40; i++) items.push({ id: 'k' + i, type: 'kelime', category: 'genel', clue: 'c', hint: 'bir şey', answer: 'KELİME', accept: [], say: 'c', difficulty: 1 });
  let seed = 7; const picker = createPicker({ items, rng: () => (seed = (seed * 16807) % 2147483647) / 2147483647 }), seen = [];
  for (let i = 0; i < 30; i++) seen.push(picker.next(3).id);   // 3. sıra: plaka
  for (let i = 3; i < seen.length; i++) assert.equal(new Set(seen.slice(i - 3, i + 1)).size, 4, 'art arda dört plaka sorusu birbirinden farklı: ' + seen.slice(i - 3, i + 1));
});
test('motor: foto-finiş: aynı anda gelen doğrular bize ulaşma sırasına değil olay kaynağının saatine göre sıralanır', () => {
  const e = make({ photoSeconds: 0.75 }); toAsk(e);
  // Paket sırası ters: Oyuncu2'nin yorumu bize önce ulaştı ama platforma Oyuncu1'inki 300 ms önce varmıştı.
  assert.deepEqual(e.chat({ user: U(2), text: 'izmir', at: 1700000000900 }), [], 'sonuç pencere kapanınca belli olur');
  assert.deepEqual(e.chat({ user: U(1), text: 'izmir', at: 1700000000600 }), []);
  assert.deepEqual(e.chat({ user: U(3), text: 'izmir', at: 1700000001400 }), []); assert.equal(e.phase(), 'ask');
  const fx = run(e, 0.75);
  assert.deepEqual(fx.map((f) => [f.type, f.user.id, f.rank, f.behind]), [['solved', 'u1', 1, undefined], ['alsoCorrect', 'u2', 2, 300], ['alsoCorrect', 'u3', 3, 800]]);
  assert.deepEqual([fx[0].points, fx[1].points], [100, 60], 'puan, ilk doğrunun geldiği andaki açık harfe göre');
  const late = e.chat({ user: U(4), text: 'izmir', at: 1700000003100 }); assert.deepEqual(late, [], 'dördüncü sessizce +10'); assert.equal(e.phase(), 'solved');
  // Saat bilgisi olmayan yorum varsa (panel denemesi, eski sürüm) bize ulaşma sırası geçerli kalır.
  const f = make({ photoSeconds: 0.75 }); toAsk(f); f.chat({ user: U(2), text: 'izmir' }); f.chat({ user: U(1), text: 'izmir', at: 5 });
  assert.deepEqual(run(f, 0.75).map((x) => x.user.id), ['u2', 'u1']);
  // Süre foto-finiş sırasında dolsa da soru "bilinemedi" sayılmaz.
  const g = make({ photoSeconds: 0.75 }); toAsk(g); run(g, 34.5); g.chat({ user: U(1), text: 'izmir', at: 9 }); assert.deepEqual(types(run(g, 0.75)), ['solved']);
});
test('motor: duraklat, geç, kabul edilen diğer cevap', () => {
  const e = make({}, ['ŞANLIURFA']); toAsk(e);
  e.command({ type: 'pause' }); assert.equal(run(e, 40).length, 0); e.command({ type: 'pause' });
  assert.equal(e.chat({ user: U(1), text: 'urfa' })[0].type, 'solved');
  const e2 = make(); toAsk(e2); assert.equal(e2.command({ type: 'skip' })[0].type, 'timeout');
});

test('tempo değişikliği sonraki soruyu etkiler, ipucu ve ek süre oyun saatini izler', () => {
  const e = make({ graceSeconds: 6, maxSeconds: 37 });
  toAsk(e);
  assert.equal(e.snapshot().nextHintIn, 7);
  e.command({ type: 'pace', pace: 'quick' });
  assert.equal(e.snapshot().timeTotal, 37);
  run(e, 7);
  assert.equal(e.snapshot().nextHintIn, 5);
  e.chat({ user: U(1), text: 'izmir' });
  run(e, 2);
  e.command({ type: 'pause', on: true });
  run(e, 10);
  assert.equal(e.snapshot().graceLeft, 4);
  assert.equal(e.snapshot().q.tiles.filter(t => t.ch).length, 1);
  e.command({ type: 'pause', on: false });
  run(e, 4);
  assert.equal(e.snapshot().graceLeft, 0);
  run(e, 7);
  assert.equal(e.snapshot().timeTotal, 25);
  assert.equal(e.snapshot().nextHintIn, 5);
});

test('tur grafiği açılan ve biten soruların sonucunu tek kez taşır', () => {
  const e = make();
  toAsk(e);
  assert.deepEqual(e.snapshot().outcomes, []);
  e.chat({ user: U(1), text: 'izmir' });
  assert.deepEqual(e.snapshot().outcomes, ['solved']);
  e.chat({ user: U(2), text: 'izmir' });
  assert.deepEqual(e.snapshot().outcomes, ['solved']);
  run(e, 12);
  e.command({ type: 'skip' });
  assert.deepEqual(e.snapshot().outcomes, ['solved', 'timeout']);
});

test('duraklatılan soruda tahmin puanlanmaz, sürdürünce yeniden kabul edilir', () => {
  const e = make(); toAsk(e);
  e.command({ type: 'pause', on: true });
  assert.deepEqual(e.chat({ user: U(1), text: 'izmir' }), []);
  e.command({ type: 'pause', on: false });
  assert.equal(e.chat({ user: U(1), text: 'izmir' })[0].type, 'solved');
});
