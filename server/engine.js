// Bil Bakalım oyun makinesi: evreler, harf açma, tahmin, puan, tur ve kürsü. Saf mantık: saat `tick(dt)` ile ilerler,
// rastgelelik dışarıdan gelir; ağ, dosya ve ses bilmez. Takip, beğeni gibi yayın olayları bu dosyaya hiç girmez: puan yalnız bilgiyle kazanılır.
import { judge } from './normalize.js';

export const SHOW_DEFAULTS = {
  perRound: 10,          // bir turdaki soru sayısı (sonuncusu çifte puan)
  lobbySeconds: 30,      // açılış: sunucu kendini ve kuralı anlatır, yoklama alır
  introSeconds: 2.5,     // "soru geliyor" + kategori kartı
  firstReveal: 7,        // ipucu göründükten kaç sn sonra ilk harf açılır
  revealEvery: 5,        // sonraki harflerin aralığı
  maxSeconds: 35,        // bilen çıkmazsa soru bu kadar sürer
  graceSeconds: 5,       // ilk bilenden sonra ikinci/üçüncü ve diğerleri için tolerans (yayın gecikmesi)
  celebrateSeconds: 4.5, // tolerans bitince cevap açılır ve kutlama sürer
  timeoutSeconds: 5,     // süre bitince cevabın ekranda kalışı
  podiumSeconds: 12,
  breakSeconds: 40,      // sohbet molası: soru başta sorulur, cevaplara yetişecek süre kalır
  hiddenShare: 0.3,      // harflerin en az bu kadarı (en az 1) kendiliğinden açılmaz
  photoSeconds: 0.8,     // foto-finiş: ilk doğrudan sonra bu kadar beklenir, gelen doğrular olay kaynağının saatine göre sıralanır
  guessGap: 1.2,         // aynı kişinin ekrana düşen tahminleri arasındaki en kısa süre
};

const PACES = {
  relaxed: { maxSeconds: 45, firstReveal: 10, revealEvery: 7 },
  quick: { maxSeconds: 25, firstReveal: 5, revealEvery: 4 },
};
const lettersOf = (answer) => [...answer];

/**
 * @param {{ picker: { next(i:number): object|null, peek(i:number): object|null }, players?: object, config?: object,
 *           night?: { solved: number, record: number }, rng?: () => number }} deps
 */
export function createEngine({ picker, players = null, config = {}, night = { solved: 0, record: 0 }, rng = Math.random }) {
  const cfg = { ...SHOW_DEFAULTS, ...config };
  let selectedPace = 'standard';
  let pacing = cfg;
  const recordBefore = night.record || 0;
  const showScores = new Map();
  const st = {
    phase: 'boot', t: 0, until: 0, phaseTotal: 0, round: 0, index: 0, q: null, open: [], opened: 0, nextReveal: 0,
    winners: [], correct: new Set(), others: 0, graceUntil: 0, graceDone: false, basePoints: 0,
    outcomes: [], pending: null, firstAt: null, askAt: 0, best: null, fast: null, firstTimers: 0, scores: new Map(), streak: new Map(), podium: [], paused: false, lastGuess: new Map(),
    night: { solved: night.solved || 0, record: night.record || 0 },
  };
  const title = (id) => players?.titleOf?.(id) ?? null;
  const brief = (u) => ({ id: u.id, nick: u.nick });
  const enter = (phase, seconds) => { st.phase = phase; st.until = st.t + seconds; st.phaseTotal = seconds; };
  const hiddenCount = () => st.open.filter((o) => !o).length;
  const keepHidden = () => Math.max(1, Math.ceil(lettersOf(st.q.answer).filter((c) => c !== ' ').length * cfg.hiddenShare));
  const leaders = (n, scores = st.scores) => [...scores.values()].sort((a, b) => b.points - a.points || a.at - b.at).slice(0, n)
    .map((s) => ({ id: s.id, nick: s.nick, points: s.points, title: title(s.id) }));

  function credit(user, points) {
    const s = st.scores.get(user.id) || { id: user.id, nick: user.nick, points: 0, correct: 0, at: st.t };
    s.nick = user.nick; s.points += points; s.correct += 1; st.scores.set(user.id, s);
    const total = showScores.get(user.id);
    showScores.set(user.id, { ...brief(user), points: (total?.points || 0) + points, at: total?.at ?? st.t });
  }
  function startRound(fx) {
    st.round += 1; st.index = 0; st.outcomes = []; st.firstTimers = 0; st.scores = new Map(); st.podium = [];
    fx.push({ type: 'roundStart', round: st.round });
    startQuestion(fx);
  }
  function startQuestion(fx) {
    pacing = PACES[selectedPace] || cfg;
    st.index += 1;
    const q = picker.next(st.index);
    if (!q) { enter('break', cfg.breakSeconds); return; }   // banka boşsa şov çökmez, molada bekler
    st.q = q; st.open = lettersOf(q.answer).map((c) => c === ' '); st.opened = 0;
    st.winners = []; st.correct = new Set(); st.others = 0; st.graceDone = false; st.basePoints = 0; st.lastGuess = new Map(); st.pending = null; st.firstAt = null;
    enter('intro', cfg.introSeconds);
    fx.push({ type: 'questionStart', index: st.index, total: cfg.perRound, qtype: q.type, category: q.category, double: st.index === cfg.perRound });
  }
  function revealAll() { st.open = st.open.map(() => true); }
  function revealOne(fx) {
    const hidden = st.open.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0);
    if (hidden.length <= keepHidden()) return false;
    const pos = hidden[Math.floor(rng() * hidden.length)];
    st.open[pos] = true; st.opened += 1;
    fx.push({ type: 'reveal', pos, ch: lettersOf(st.q.answer)[pos], open: st.opened, left: hidden.length - 1 });
    return true;
  }
  function endQuestion(fx) {
    const ids = new Set(st.winners.map((w) => w.user.id)), next = new Map();
    for (const id of ids) next.set(id, (st.streak.get(id) || 0) + 1);
    st.streak = next;   // ilk üçe giremeyenin serisi biter; süre biterse herkesin
    fx.push({ type: 'questionEnd', answer: st.q.answer, fact: st.q.fact || null, winners: st.winners.map((w) => ({ user: w.user, rank: w.rank, points: w.points, ...(w.behind != null ? { behind: w.behind } : {}) })) });
    if (st.index >= cfg.perRound) {
      st.podium = leaders(3);
      fx.push({ type: 'roundEnd', round: st.round, podium: st.podium, champion: st.podium[0] ? { id: st.podium[0].id, nick: st.podium[0].nick, points: st.podium[0].points } : null });
      enter('podium', cfg.podiumSeconds);
    } else startQuestion(fx);
  }
  function timeUp(fx) {
    revealAll(); st.streak = new Map(); st.winners = [];
    st.outcomes.push('timeout'); enter('timeout', cfg.timeoutSeconds);
    fx.push({ type: 'timeout', answer: st.q.answer });
  }
  const accepting = () => st.phase === 'ask' || (st.phase === 'solved' && st.t < st.graceUntil);
  const answers = () => [st.q.answer, ...(st.q.accept || [])];

  function tick(dt) {
    const fx = [];
    if (st.phase === 'boot') { enter('lobby', cfg.lobbySeconds); fx.push({ type: 'lobby' }); return fx; }
    if (st.paused || st.phase === 'ended') return fx;
    st.t += dt;
    switch (st.phase) {
      case 'lobby': if (st.t >= st.until) startRound(fx); break;
      case 'intro':
        if (st.t >= st.until) {
          enter('ask', pacing.maxSeconds); st.nextReveal = st.t + pacing.firstReveal;
          st.askAt = st.t;
          fx.push({ type: 'ask', clue: st.q.clue, say: st.q.say, kind: st.q.type, double: st.index === cfg.perRound });
        }
        break;
      case 'ask':
        if (st.pending) { if (st.t >= st.pending.until) resolvePhoto(fx); break; }   // foto-finiş sürerken harf açılmaz, süre dolmaz
        if (st.t >= st.until) { timeUp(fx); break; }
        if (st.t >= st.nextReveal) { revealOne(fx); st.nextReveal += pacing.revealEvery; }
        break;
      case 'solved':
        if (!st.graceDone && st.t >= st.graceUntil) {
          st.graceDone = true; revealAll();
          fx.push({ type: 'answer', answer: st.q.answer, winners: st.winners.map((w) => ({ user: w.user, rank: w.rank, points: w.points, ...(w.behind != null ? { behind: w.behind } : {}) })) });
          fx.push({ type: 'others', count: st.others });
        }
        if (st.t >= st.until) endQuestion(fx);
        break;
      case 'timeout': if (st.t >= st.until) endQuestion(fx); break;
      case 'podium': if (st.t >= st.until) { enter('break', cfg.breakSeconds); fx.push({ type: 'breakStart' }); } break;
      case 'break': if (st.t >= st.until) startRound(fx); break;
    }
    return fx;
  }

  /** Yorumun şu anki soruya göre değeri; soru açık değilse null. Yan etkisi yoktur. */
  function verdict(text) {
    if (st.paused || !st.q || !['ask', 'solved', 'timeout'].includes(st.phase)) return null;
    const v = judge(text, answers());
    if (st.phase === 'ask' || accepting()) return v;
    return v === 'correct' ? 'late' : null;
  }

  /** İlk bilen: puan, seri, kayıt ve tolerans penceresi. `open`: ilk doğru geldiği andaki açık harf sayısı. */
  function winFirst(u, open, fx) {
    const double = st.index === cfg.perRound;
    const streak = (st.streak.get(u.id) || 0) + 1;
    let points = Math.max(30, 100 - 12 * open) * (double ? 2 : 1);
    if (streak >= 3) points = Math.round(points * 1.2);
    st.basePoints = points;
    st.winners = [{ user: u, rank: 1, points }]; credit(u, points);
    const rec = players?.recordCorrect?.(u, { win: true, points, streak }) || {};
    st.night.solved += 1; if (st.night.solved > st.night.record) st.night.record = st.night.solved;
    st.graceUntil = st.t + cfg.graceSeconds; st.graceDone = false;   // cevap tolerans bitince açılır: ikinci/üçüncülük kopyayla alınamasın
    st.outcomes.push('solved'); enter('solved', cfg.graceSeconds + cfg.celebrateSeconds);
    // Öne çıkanlar şeridi: gecenin en uzun serisi, harf açılmadan bilen son kişi, bu turda ilk doğrusunu yapanlar.
    if (streak >= 3 && streak > (st.best?.n || 0)) st.best = { nick: u.nick, n: streak };
    if (open === 0) st.fast = { nick: u.nick };
    if (rec.firstEver) st.firstTimers += 1;
    fx.push({ type: 'solved', user: u, rank: 1, points, open, streak, first: !!rec.firstEver, fast: open === 0, double });
    if (rec.levelUp) fx.push({ type: 'levelUp', user: u, title: rec.levelUp });
    if (recordBefore > 0 && st.night.solved === recordBefore + 1) fx.push({ type: 'record', solved: st.night.solved });
  }
  /** İkinci, üçüncü ve diğer bilenler. `behind`: ilk bilenden kaç ms sonra (olay kaynağının saatine göre; bilinmiyorsa null). */
  function winAlso(u, fx, behind = null) {
    const rank = st.winners.length + 1;
    const points = rank === 2 ? Math.round(st.basePoints * 0.6) : rank === 3 ? Math.round(st.basePoints * 0.4) : 10;
    credit(u, points);
    const rec = players?.recordCorrect?.(u, { win: false, points, streak: rank <= 3 ? (st.streak.get(u.id) || 0) + 1 : 0 }) || {};
    const gap = behind !== null && behind >= 0 ? { behind: Math.round(behind) } : {};
    if (rank <= 3) { st.winners.push({ user: u, rank, points, ...gap }); fx.push({ type: 'alsoCorrect', user: u, rank, points, ...gap }); }
    else st.others += 1;
    if (rec.levelUp) fx.push({ type: 'levelUp', user: u, title: rec.levelUp });
  }
  /**
   * Foto-finiş: ilk doğru cevap sunucuya ulaşınca kısa bir pencere açılır ve o pencerede gelen bütün doğrular
   * yorumun yayın platformuna ulaştığı ana (`at`) göre sıralanır. Yorumlar bize paketler hâlinde ve ağ gecikmesiyle geldiği için
   * yalnız "bize ilk ulaşan"a bakmak, yarım saniye içinde yazanların sırasını karıştırıyordu.
   */
  function resolvePhoto(fx) {
    const p = st.pending; st.pending = null; if (!p?.list.length) return;
    const timed = p.list.every((e) => e.at !== null);
    const order = [...p.list].sort((a, b) => (timed ? a.at - b.at : 0) || a.seq - b.seq);
    st.firstAt = timed ? order[0].at : null;
    winFirst(order[0].user, p.open, fx);
    for (const e of order.slice(1)) winAlso(e.user, fx, timed ? e.at - order[0].at : null);
  }
  /** Bir yorumu tahmin olarak işler. `show:false` ise yanlış tahmin ekrana düşmez (sohbet cümlesi). */
  function chat({ user, text, show = true, at = null }) {
    const fx = [], v = verdict(text); if (!v) return fx;
    const u = brief(user);
    if (v === 'late') { if (!st.correct.has(u.id)) fx.push({ type: 'guess', user: u, text: String(text).slice(0, 40), verdict: 'late' }); return fx; }
    if (v === 'correct') {
      if (st.correct.has(u.id)) return fx;
      st.correct.add(u.id);
      const when = Number.isFinite(at) ? at : null;
      if (st.phase === 'ask') {
        if (cfg.photoSeconds > 0) {   // sonuç foto-finiş penceresi kapanınca (tick) belli olur
          if (!st.pending) st.pending = { until: st.t + cfg.photoSeconds, open: st.opened, list: [] };
          st.pending.list.push({ user: u, at: when, seq: st.pending.list.length });
        } else { st.firstAt = when; winFirst(u, st.opened, fx); }
      } else winAlso(u, fx, when !== null && st.firstAt !== null ? when - st.firstAt : null);
      return fx;
    }
    if (st.phase !== 'ask' || st.correct.has(u.id)) return fx;
    if (v === 'wrong' && !show) return fx;
    const last = st.lastGuess.get(u.id);
    if (last !== undefined && st.t - last < cfg.guessGap) return fx;
    st.lastGuess.set(u.id, st.t);
    fx.push({ type: 'guess', user: u, text: String(text).slice(0, 40), verdict: v });
    return fx;
  }

  function command(cmd) {
    const fx = [];
    if (st.phase === 'ended') return fx;
    if (cmd?.type === 'finish') {
      if (st.pending) resolvePhoto(fx);
      st.paused = false; enter('ended', 0);
      return [{ type: 'finished' }];
    }
    if (cmd?.type === 'pause') st.paused = cmd.on === undefined ? !st.paused : !!cmd.on;
    else if (cmd?.type === 'pace' && (cmd.pace === 'standard' || Object.hasOwn(PACES, cmd.pace))) selectedPace = cmd.pace;
    else if (cmd?.type === 'skip') { if (st.phase === 'ask' && st.pending) resolvePhoto(fx); else if (st.phase === 'ask') timeUp(fx); else if (st.phase === 'intro' || st.phase === 'lobby' || st.phase === 'break' || st.phase === 'podium') st.until = st.t; }
    return fx;
  }

  function snapshot() {
    const q = st.q && !['lobby', 'boot', 'podium', 'break', 'ended'].includes(st.phase) ? st.q : null, chars = q ? lettersOf(q.answer) : [];
    return {
      phase: st.phase === 'boot' ? 'lobby' : st.phase, round: st.round, index: st.index, total: cfg.perRound, double: !!q && st.index === cfg.perRound,
      q: q && { type: q.type, category: q.category, clue: q.clue, hint: q.hint || null, plate: q.plate || null, emoji: q.emoji || null,
        tiles: chars.map((ch, i) => ({ ch: ch === ' ' ? null : st.open[i] ? ch : null, space: ch === ' ' })), scramble: q.scramble || null },
      outcomes: [...st.outcomes],
      takingGuesses: st.phase === 'ask' && !st.pending && !st.paused,
      nextHintIn: st.phase === 'ask' && hiddenCount() > keepHidden() && st.nextReveal < st.until ? Math.max(0, Math.ceil(st.nextReveal - st.t)) : null,
      graceLeft: st.phase === 'solved' ? Math.max(0, Math.ceil(st.graceUntil - st.t)) : 0,
      timeLeft: Math.max(0, Math.round((st.until - st.t) * 10) / 10), timeTotal: st.phaseTotal,
      winners: st.phase === 'solved' ? st.winners.map((w) => ({ user: w.user, rank: w.rank, points: w.points, ...(w.behind != null ? { behind: w.behind } : {}) })) : [],
      leaders: leaders(5), podium: st.phase === 'podium' || st.phase === 'break' ? st.podium : [],
      night: { ...st.night }, paused: st.paused,
      ...(st.phase === 'ended' ? { finalists: leaders(3, showScores) } : {}),
      highlights: { streak: st.best, fast: st.fast, firstTimers: st.firstTimers },
    };
  }

  return {
    tick, chat, verdict, command, snapshot,
    /** Sıradaki sorunun okunacak metni (önceden seslendirmek için); yoksa null. */
    peekNext() { const i = st.index >= cfg.perRound ? 1 : st.index + 1; return picker.peek?.(i) ?? null; },
    /** Kişinin tur içindeki puanı ve sırası (yoksa null). */
    standing(id) { const all = [...st.scores.values()].sort((a, b) => b.points - a.points || a.at - b.at), i = all.findIndex((s) => s.id === id); return i < 0 ? null : { points: all[i].points, rank: i + 1 }; },
    night: () => ({ ...st.night }),
    clock: () => st.t, phase: () => (st.phase === 'boot' ? 'lobby' : st.phase), config: cfg,
    /** Yalnız prova izleyicileri için: açık sorunun cevabı. Sahneye ve panele gönderilmez. */
    answerForDemo: () => st.q?.answer ?? null, opened: () => st.opened,
  };
}
