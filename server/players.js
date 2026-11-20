// Bil Bakalım: oyuncu belleği. Kim daha önce geldi, kaç doğru yaptı, hangi unvanda; sunucu geri geleni tanısın diye.
// Yalnız takma ad ve sayılar tutulur (fotoğraf adresi tutulmaz). Prova verisi diske yazılmaz.
import fs from 'node:fs';
import path from 'node:path';

export const TITLES = [[250, 'Sohbetin Efsanesi'], [100, 'Yorum Profesörü'], [40, 'Ters Köşe Ustası'], [15, 'İpucu Dedektifi'], [5, 'Jet Pati'], [1, 'Çıtır Pati']];
export const titleFor = (correct) => (TITLES.find(([min]) => correct >= min) || [0, null])[1];

/**
 * @param {{ file?: string|null, limit?: number, now?: () => number, readOnly?: boolean }} opts file yoksa ya da readOnly ise yalnız bellekte çalışır.
 */
export function createPlayers({ file = null, limit = 5000, now = Date.now, readOnly = false } = {}) {
  const map = new Map(), session = new Set(); let dirty = false, timer = null;
  if (file) { try { for (const [id, p] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')).players || {})) map.set(id, p); } catch { /* ilk açılış */ } }
  const known = new Set(map.keys());   // bu açılıştan önce de kayıtlı olanlar: "yine geldin" denecek kişiler
  const fresh = (user) => ({ nick: user.nick, correct: 0, wins: 0, points: 0, bestStreak: 0, last: now() });
  function touch(user) {
    let p = map.get(user.id); if (!p) { p = fresh(user); map.set(user.id, p); }
    p.nick = user.nick; p.last = now(); dirty = true; return p;
  }
  function save() {
    if (!file || readOnly || !dirty) return false;
    try {
      let entries = [...map.entries()];
      if (entries.length > limit) { entries = entries.sort((a, b) => b[1].last - a[1].last).slice(0, limit); }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ v: 1, players: Object.fromEntries(entries) }));
      dirty = false; return true;
    } catch { return false; }
  }
  return {
    /** Kişi bu açılışta ilk kez görülüyorsa `first` true; önceki yayınlardan tanınıyorsa `returning` true. */
    seen(user) {
      const returning = known.has(user.id) && (map.get(user.id)?.correct || 0) > 0, first = !session.has(user.id);
      session.add(user.id); const p = touch(user);
      return { first, returning, title: titleFor(p.correct), correct: p.correct };
    },
    /** Doğru cevabı işler. `firstEver`: ömründeki ilk doğru; `levelUp`: yeni unvan (yoksa null). */
    recordCorrect(user, { win = false, points = 0, streak = 0 } = {}) {
      const p = touch(user), before = titleFor(p.correct);
      const firstEver = p.correct === 0;
      p.correct += 1; p.points += points; if (win) p.wins += 1; if (streak > p.bestStreak) p.bestStreak = streak;
      const title = titleFor(p.correct);
      return { firstEver, title, levelUp: title && title !== before && !firstEver ? title : null };
    },
    titleOf: (id) => titleFor(map.get(id)?.correct || 0),
    get: (id) => map.get(id) || null,
    size: () => map.size,
    save,
    /** Seyrek yazım: değişiklikten en geç 20 sn sonra. */
    saveSoon() { if (timer || !file || readOnly) return; timer = setTimeout(() => { timer = null; save(); }, 20000); timer.unref?.(); },
    close() { if (timer) clearTimeout(timer); timer = null; save(); },
  };
}
