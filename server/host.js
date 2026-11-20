// Bil Bakalım'ın sunucusu Tarçın'ın beyni (yönetmen): oyun ve yayın olaylarını repliğe çevirir, sıraya koyar, seslendirtir.
// Kurallar: aynı anda tek replik; oyunla ilgili replikler sohbet repliklerinden önce gelir; süresi geçen replik söylenmez
// (görsel bildirimi sahne ayrıca gösterir); hiçbir replik izleyiciden para ya da ödül istemez (banka testle taranır).
import { speakable, joinNames } from './names.js';
import { readFileSync } from 'node:fs';

const pocketCues = JSON.parse(readFileSync(new URL('./data/pocket-cues.json', import.meta.url), 'utf8'));
export function pocketClip(key, voice) {
  const cue = pocketCues[key], ms = cue?.duration?.[voice];
  return Number.isFinite(ms) ? { url: '/tarcin-' + voice + '-' + key + '.wav', ms, speech: cue.text, provider: 'pocket', voice } : null;
}
const FAMILIAR = /\bcano\b|başımla beraber/iu;
const canoCue = kind => kind === 'hosgeldin' ? 'canoSelam' : kind === 'bildiAni' || kind === 'bildi' ? 'canoBildi' : 'canoTesekkur';

// tür → [duygu, jest]
const STYLE = {
  acilis: ['happy', 'wave'], acilisKural: ['neutral', 'point'], acilisDavet: ['happy', 'wave'], acilisHazir: ['excited', 'point'], molaYanit: ['happy', null], turBasla: ['excited', 'point'], soruGeliyor: ['neutral', null], ipucu: ['neutral', 'point'],
  harfAcildi: ['neutral', null], sonHarfler: ['think', null], sureDoluyor: ['wow', 'drum'],
  bildiAni: ['excited', 'clap'], bildiDevam: ['excited', null], bildi: ['excited', 'jump'], ikinciler: ['happy', 'clap'], digerleri: ['happy', null],
  yaklasti: ['think', 'listen'], yanlisTakil: ['wink', null], sureBitti: ['sad', 'shrug'], bilgi: ['neutral', null],
  unvan: ['happy', 'clap'], rekor: ['excited', 'jump'], turSonu: ['happy', 'clap'], sampiyon: ['excited', 'jump'],
  molaBasla: ['happy', 'wave'], molaSoru: ['neutral', null], molaTesekkur: ['love', 'heart'], takipHatirlat: ['wink', null],
  hosgeldin: ['happy', 'wave'], takip: ['happy', 'wave'], paylasim: ['happy', 'clap'], begeni: ['love', 'heart'],
  cosku: ['excited', 'jump'], izleyici: ['happy', 'clap'],
  sessiz: ['think', null], niyet: ['happy', null], sohbet: ['happy', null],
};
const NAMELESS = { molaYanit: 'molaYanitAdsiz', bildi: 'bildiAdsiz', bildiAni: 'bildiAniAdsiz', hosgeldin: 'hosgeldinAdsiz' };
// Adsız havuzlar, adlı türün duygusuyla istenir; önceden seslendirirken de aynı duygu kullanılmalı (yoksa önbellek hiç tutmaz).
const WARM_AS = { bildiAniAdsiz: 'bildiAni', hosgeldinAdsiz: 'hosgeldin' };
const MILESTONES = [25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000];
const QUIET_IN_BREAK = new Set(['takip', 'begeni', 'cosku']);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * @param {object} deps
 * @param {Record<string,string[]>} deps.lines replik bankası (olay → cümleler)
 * @param {{ speak(text:string, o?:object): Promise<{name:string,ms:number}|null>, warm?(texts:string[], o?:object): Promise<number> }} deps.tts
 * @param {(msg:object)=>void} deps.emit `say` iletisi gönderir
 * @param {()=>number} deps.now saniye
 */
export function createHost({ lines, tts, emit, now, rng = Math.random, isBlocked = () => false,
  standing = () => null, breakHistory = [], options = {}, waitMs = tts.provider === 'pocket' ? 2500 : 1500 }) {
  const opt = { followReminder: true, spokenFacts: true, ...options };
  const bornAt = now(); let lastFair = -1e9;
  let queue = [], seq = 0, sayId = 0, speakingUntil = 0, pumping = null;
  const recent = new Map(), cool = new Map(), timers = [];
  let lastFamiliar = -Infinity;
  let joins = [], likes = new Map(), thanksTo = [], greeted = new Set(), thanked = new Set();
  let q = { reveals: 0, harf: false, son: false, sure: false, sessiz: false, askAt: 0, solved: null }, asked = 0, lastChat = 0, lastFollowReminder = -1e9, viewersSeen = 0;
  let phase = 'lobby';
  let speakingKind = null;
  const familiarReady = () => now() - lastFamiliar >= 120 && !queue.some(i => FAMILIAR.test(i.speech));

  const ready = (key, seconds) => { const t = now(); if (t - (cool.get(key) ?? -1e9) < seconds) return false; cool.set(key, t); return true; };
  function pick(key, avoid = null) {
    const pool = lines[key]; if (!pool?.length) return null;
    const eligible = pool.map((_, i) => i).filter(i => !FAMILIAR.test(pool[i]) || familiarReady());
    if (!eligible.length) return null;
    const fits = eligible.filter(i => !avoid || !avoid.test(pool[i])), all = fits.length ? fits : eligible;
    const mem = recent.get(key) || []; let idx = all.filter((i) => !mem.includes(i)); if (!idx.length) idx = all;
    const i = idx[Math.floor(rng() * idx.length)]; mem.push(i); while (mem.length > Math.min(4, pool.length - 1)) mem.shift(); recent.set(key, mem);
    return pool[i];
  }
  const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')).replace(/\s+/g, ' ').trim();
  const nameOf = (user) => speakable(user?.nick, isBlocked);

  /** Replik kuyruğa girer. `key` bankadaki olay; ad gerekip okunamıyorsa adsız havuza düşer ya da vazgeçilir. */
  function say(key, vars = {}, { kind = key, priority = 2, ttl = 5, text = null, speech = null, emotion, gesture, fallback = null, avoid = null, onSpeak = null } = {}) {
    let line = text;
    if (line === null) {
      let k = key;
      if ('ad' in vars && !vars.ad) { k = NAMELESS[key] || (key.startsWith('niyet.') ? key : null); if (!k) return false; if (key.startsWith('niyet.')) vars = { ...vars, ad: 'dostum' }; }
      const tpl = pick(k, avoid); if (!tpl) return false;
      line = fill(tpl, vars);
    }
    const style = STYLE[kind] || STYLE[key] || (key.startsWith('niyet.') ? STYLE.niyet : ['neutral', null]);
    const item = { seq: ++seq, kind, text: line, speech: speech || line, emotion: emotion || style[0], gesture: gesture === undefined ? style[1] : gesture,
      priority, expires: now() + ttl, question: kind === 'ipucu' ? q : null, audio: null, fallback, onSpeak };
    item.audio = record(item);   // her replik sıraya girer girmez seslendirilmeye başlar; sırası gelince hazır olsun
    queue.push(item); pump();
    return true;
  }
  const purge = (max) => { queue = queue.filter((i) => i.priority > max); };
  // --- Konuşma sırası -------------------------------------------------------------------------------------------------
  // Sunucu tek bir sesi bekleyip susmaz: her replik sıraya girdiği anda seslendirilmeye başlar (record), sunucu boşaldığında
  // sesi HAZIR olan en öncelikli replik söylenir (pump). Sesi gecikene replik başına kısa bir pay tanınır: yerine çalınacak
  // hazır kaydı olan öncelik 5 replik ("bildi" anı) ~1,2 sn, ipucu ~2 sn, diğerleri waitMs (2,5 sn). Pay dolunca replik hazır
  // kısa kayıtla ya da yalnız alt yazıyla söylenir (readyClip). Tek istisna: ses o anda üretiliyorsa ve ölçülen hıza göre
  // az sonra bitecekse, yoldaki iş boşa gitmesin diye sınırlı bir ek süre (en çok 1–1,5 sn) daha beklenir. Sonradan gelen
  // ses yeniden çalınmaz; sıradan düşen repliğin üretimi iptal edilir ki tazelerin önünde beklemesin.
  const pending = new Set();        // sesi istenmiş, henüz söylenmemiş replikler
  let gapStart = null, gapMax = 0;  // sırada replik varken sunucunun boş ve sessiz kaldığı süre (say iletisindeki `waited`, ms)
  let warmRun = null;               // süren ya da biten ön seslendirme: { sig, promise, stop }
  let pace = 30;                    // bir karakterin seslendirilme süresi (ms); üretilen her replikle güncellenir
  const pocketVoice = () => { if (tts.provider !== 'pocket') return null; const st = tts.status?.() || {}; return st.pocketVoice ?? st.voice ?? null; };
  const cueFor = (kind) => pocketCues[kind] || null;

  /** Repliğin sesini ister; sonuç `item.clip`e yazılır ve sıra yeniden değerlendirilir. */
  function record(item) {
    if (/\bcano\b/iu.test(item.speech) && tts.provider !== 'off') {
      item.canoClip = pocketClip(canoCue(item.kind), pocketVoice() || 'female_2');
      if (tts.provider === 'pocket' && item.canoClip?.speech === item.speech) {
        item.at = now(); item.done = true; item.clip = item.canoClip;
        return Promise.resolve(item.clip);
      }
    }
    // Kısa pay yalnız yerine duyulur bir şey varsa verilir (Pocket'te hazır kayıt, diğerlerinde tarayıcının sesi): cevabı
    // söyleyen "bildi" repliğinin hazır kaydı yoktur, 1,2 sn'de vazgeçmek onu boş yere sessiz bırakırdı.
    const audible = item.fallback ? true : tts.provider === 'pocket' ? Boolean(cueFor(item.kind)) : ['local', 'azure'].includes(tts.provider);
    if (item.fallback && !item.fallbackAsked) {   // kısa ünlem önceden seslendirildiği için genellikle anında hazırdır
      item.fallbackAsked = true;
      try { Promise.resolve(tts.speak(item.fallback.text, { emotion: item.fallback.emotion, priority: 1, fallback: true }))   // düşük öncelik: yedek, canlı repliklerin önüne geçmez (genelde önbellekte hazırdır)
        .then((clip) => { if (clip) item.fallbackClip = { url: '/tts/' + clip.name, ms: clip.ms, speech: item.fallback.text, provider: clip.provider ?? tts.provider, voice: clip.voice ?? pocketVoice() }; }, () => {}); } catch { /* yedek yok */ }
    }
    const wait = Math.min(waitMs, item.kind === 'ipucu' ? 2000 : item.priority >= 5 && audible ? 1200 : waitMs) / 1000;
    item.at = now(); item.deadline = Math.min(item.at + wait, item.expires - 0.1);
    item.grace = Math.min(item.deadline + (item.priority >= 5 ? 1 : 1.5), item.expires - 0.1);   // yoldaki ses için en son an
    item.done = false; item.clip = null; item.started = null;
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    item.cancel = () => abort?.abort();
    pending.add(item);
    const provider = tts.provider, voice = pocketVoice();
    let asked;
    try {
      asked = Promise.resolve(tts.speak(item.speech, { emotion: item.emotion, priority: item.priority, signal: abort?.signal, timeoutMs: Math.max(0, Math.round((item.expires - item.at) * 1000)),
        onStart: () => { if (item.started === null) item.started = now(); } }));
    } catch { asked = Promise.resolve(null); }
    const audio = asked
      .then((clip) => clip && { url: '/tts/' + clip.name, ms: clip.ms, speech: item.speech, provider: clip.provider ?? provider, voice: clip.voice ?? voice }, () => null)
      .then((clip) => {
        if (clip && item.started !== null) { // gerçek üretim süresinden hız öğrenilir (önbellekten gelen sayılmaz)
          const per = (now() - item.started) * 1000 / Math.max(10, [...item.speech].length);
          if (per > 2 && per < 300) pace = pace * 0.7 + per * 0.3;
        }
        item.done = true; item.clip = clip; return clip;
      });
    const step = audio.then(() => { if (pumping === step) pumping = null; pump(); });
    pumping = step;   // idle() bunu bekler: ses sonuçlandı ve sıra bir kez daha değerlendirildi
    return audio;
  }

  /** Şu an söylenecek ses: repliğin kendi kaydı; yoksa (Pocket'te) o tür için hazır kısa kayıt; o da yoksa null (yalnız alt yazı). */
  function readyClip(item) {
    const clip = item.done ? item.clip : null;
    if (item.canoClip) {
      if (clip && (tts.provider !== 'pocket' || (clip.provider === 'pocket' && clip.voice === pocketVoice()))) return clip;
      return pocketClip(canoCue(item.kind), pocketVoice() || item.canoClip.voice);
    }
    if (!clip && item.fallbackClip) return item.fallbackClip;   // kendi kısa yedeği olan replik onunla söylenir
    if (tts.provider !== 'pocket') return clip;
    const voice = pocketVoice();
    // Yedek sesle (Windows) üretilmiş kayıt geçerlidir; ses değiştirilmeden önce öbür Pocket sesiyle üretilmiş kayıt değildir.
    if (clip && (clip.provider !== 'pocket' || clip.voice === voice)) return clip;
    if (item.fallback) return item.fallbackClip || null;   // kendi yedeği olan replikte türün genel kaydı çalmaz
    return pocketClip(item.kind, voice);
  }

  function pump() {
    const t = now();
    // Süresi dolan, sorusu kapanan ya da sıradan çıkarılan repliğin sesi artık gerekmez.
    queue = queue.filter((i) => i.expires > t && !(i.question && (i.question !== q || phase !== 'ask'))
      && !(phase === 'break' && QUIET_IN_BREAK.has(i.kind)));
    for (const item of pending) if (!queue.includes(item)) { pending.delete(item); if (!item.done) item.cancel?.(); }
    if (!queue.length) { if (gapStart !== null) { gapMax = Math.max(gapMax, t - gapStart); gapStart = null; } return pumping; }
    if (t < speakingUntil) return pumping;
    queue.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    const ahead = [];   // daha öncelikli ama sesi henüz gelmemiş, payı da dolmamış replikler
    // Payı dolan replik beklenmez; yalnız sesi o an üretiliyorsa ve ölçülen hıza göre ek süre içinde bitecekse beklenir.
    const underway = (i) => i.started !== null && t < i.grace && i.started + [...i.speech].length * pace * 1.2 / 1000 <= i.grace;
    let item = null;
    for (const next of queue) {
      if (!next.audio) next.audio = record(next);
      if (next.done || (t >= next.deadline && !underway(next))) { item = next; break; }
      ahead.push(next);
    }
    const length = (i, clip) => Math.round(clip?.ms ?? clamp([...i.speech].length * 70, 1200, 7000));
    let audio = item && readyClip(item), ms = item && length(item, audio);
    // Replik başına paylar art arda eklenip uzun bir sessizliğe dönüşmesin diye tek bir üst sınır vardır: sırada replik
    // varken sunucu en çok waitMs (ipucu bekliyorsa 2 sn) susar; sonra eldekiyle konuşur.
    const overdue = gapStart !== null && t - gapStart >= (queue.some((i) => i.kind === 'ipucu') ? Math.min(waitMs, 2000) : waitMs) / 1000;
    // Hazır olan daha düşük öncelikli replik öne geçer. İki durumda geçmez: sesi beklenen replik öncelik 5 ise ve daha yeni
    // sıraya girdiyse (ipucu, "bildi": ilk 1,2 sn sıraları bozulmaz) ya da öne geçen replik onu süresinden edecekse.
    if (!item || ahead.some((h) => (!overdue && h.priority >= 5 && t < h.at + 1.2) || h.expires < t + ms / 1000 + 0.35)) {
      if (!overdue) { if (gapStart === null) gapStart = t; return pumping; }
      item = queue[0]; audio = readyClip(item); ms = length(item, audio);   // en öncelikli replik, eldeki sesle (hazır kayıt ya da yalnız alt yazı)
    }
    // Sessiz (yalnız alt yazı) söylemek son çaredir. Sırada sesi hazır başka bir replik varsa önce o söylenir; hiçbiri hazır
    // değilse ve bu repliğin sesi üretilmekteyse, süresi dolmadan ve toplam bekleme 4,5 sn'yi aşmadan biraz daha beklenir.
    // İpucu bu kuralın dışındadır (2 sn'de alt yazıyla gösterilir); öncelik 5 repliğin genelde hazır kaydı vardır.
    // Yeni sıraya giren ipucu, başka repliklerin biriktirdiği bekleme yüzünden sessiz geçilmez: kendi 1,2 saniyesini alır
    // (önceden seslendirildiği için önbellekten hemen gelir).
    if (!audio && !item.done && item.kind === 'ipucu' && t - item.at < 1.2) { if (gapStart === null) gapStart = t; return pumping; }
    if (!audio && !item.done && item.kind !== 'ipucu') {
      const soon = item.expires - t < 1;
      const other = queue.find((i) => i !== item && i.done && readyClip(i) && !(i.question && i.question !== q));
      if (other && (item.priority < 5 || !soon)) { item = other; audio = readyClip(item); ms = length(item, audio); }
      else if (!other && item.started !== null && !soon && !(gapStart !== null && t - gapStart >= 4.5)) { if (gapStart === null) gapStart = t; return pumping; }
    }
    queue.splice(queue.indexOf(item), 1); pending.delete(item);
    if (!item.done) item.cancel?.();   // geciken ses sonradan çalınmaz
    const waited = Math.round(Math.max(gapMax, gapStart === null ? 0 : t - gapStart) * 1000); gapStart = null; gapMax = 0;
    speakingUntil = t + ms / 1000 + (phase === 'ask' && item.priority <= 3 ? 0.9 : 0.25);
    speakingKind = item.kind;
    if (FAMILIAR.test(audio?.speech ?? (['local', 'azure'].includes(tts.provider) ? item.speech : ''))) lastFamiliar = t;
    item.onSpeak?.();   // replik söylenmeye başladığı anda yapılacak iş
    emit({ t: 'say', id: ++sayId, kind: item.kind, text: item.text, speech: audio?.speech ?? item.speech,
      voiceEnabled: tts.provider !== 'off', allowSystemVoice: ['local', 'azure'].includes(tts.provider),
      speechProvider: audio?.provider ?? null, voice: audio?.voice ?? null,
      url: audio?.url ?? null, ms, emotion: item.emotion, gesture: item.gesture, waited });
    return pumping;
  }
  const later = (seconds, fn) => timers.push({ at: now() + seconds, fn });
  /** Soru ekranda değilken (açılış, kürsü, mola) soruya ya da ipucuna gönderme yapan cümleler yersizdir. */
  const noQuestion = () => (['intro', 'ask', 'solved', 'timeout'].includes(phase) ? null : /soru|ipucu|tahmin|bilen|cevab/i);
  /** Çözüm anında (cevap 5 sn sonra açılacak) cevabı açıklayan cümleyi seçer ve seslendirmeyi başlatır. Cevap yalnız sunucuda kalır. */
  function prepareReveal(answer) {
    const s = q.solved; if (!s || !answer) return;
    const ad = nameOf(s.user), vars = { ad, cevap: titleCase(answer), puan: s.points, seri: s.streak };
    const key = !ad ? 'bildiAdsiz' : s.fast ? 'bildiHizli' : s.streak >= 3 ? 'bildiSeri' : s.double ? 'bildiCifte' : s.first ? 'bildiIlk' : 'bildi';
    const tpl = pick(key); if (!tpl) return;
    q.reveal = { first: s.user.id, text: fill(tpl, vars) };
    try { Promise.resolve(tts.speak(q.reveal.text, { emotion: STYLE.bildi[0], priority: 4 })).catch(() => {}); } catch { /* ses yoksa alt yazıyla söylenir */ }
  }
  // Sunucu sohbete soru sorunca bir süre cevapları dinler: yazan adıyla karşılık bulur (soruyu sorup yeni tura kaçmak yok).
  let listen = null;
  function askChat(key, seconds) {
    let line;
    if (key === 'molaSoru') {
      const pool = lines[key] || [];
      if (!pool.length) return false;
      let choices = pool.filter(text => !breakHistory.includes(text));
      if (!choices.length) {
        const previous = breakHistory.at(-1);
        breakHistory.length = 0;
        choices = pool.filter(text => text !== previous);
        if (!choices.length) choices = pool;
      }
      line = choices[Math.floor(rng() * choices.length)];
    } else line = pick(key);
    if (!line) return false;
    if (!say(key, {}, { priority: 4, ttl: 10, text: line })) return false;
    if (key === 'molaSoru') breakHistory.push(line);
    listen = { until: now() + seconds, question: line, count: 0, seen: new Set() }; return true;
  }
  /** Sohbet sorusuna gelen kısa cevap: adıyla ve yazdığıyla anılır. En çok 8 kişi, 3,5 sn arayla, kişi başına bir kez. */
  function onBreakAnswer(user, text) {
    const t = now(); if (!listen || (phase !== 'break' && t > listen.until) || listen.count >= 8 || listen.seen.has(user.id)) return false;
    if (t - (cool.get('answer') ?? -1e9) < 3.5) return false;
    // `text` yalnız onaylı kelimelerden oluşuyorsa gelir (sunucu süzer); yoksa söz tekrar edilmez, kişi yalnız adıyla anılır.
    const soz = String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, 28);
    const ok = soz ? say('molaYanit', { ad: nameOf(user), soz }, { kind: 'molaYanit', priority: 2, ttl: 9 })
      : say('molaYanitSade', { ad: nameOf(user) }, { kind: 'molaYanit', priority: 2, ttl: 9 });
    if (!ok) return false;
    cool.set('answer', t); listen.count += 1; listen.seen.add(user.id); lastChat = t; return true;
  }
  const listening = () => !!listen && now() <= listen.until;

  /* ---------- oyun olayları ---------- */
  function onFx(list, snap) {
    if (snap) phase = snap.phase;
    for (const f of list) {
      switch (f.type) {
        case 'lobby':   // açılış boyunca konuşur: tanışma ve kural → puanın mantığı → yoklama (sohbet açılır) → "ilk soru geliyor"
          phase = 'lobby';
          say('acilis', {}, { priority: 4, ttl: 14 });
          later(8.5, () => { if (phase === 'lobby') say('acilisKural', {}, { priority: 4, ttl: 7 }); });
          later(17, () => { if (phase === 'lobby') askChat('acilisDavet', 30); });
          later(25.5, () => { if (phase === 'lobby') say('acilisHazir', {}, { priority: 4, ttl: 4 }); });
          break;
        case 'roundStart': if (f.round > 1) say('turBasla', { tur: f.round }, { priority: 3, ttl: 4 }); break;
        case 'questionStart':
          q = { reveals: 0, harf: false, son: false, sure: false, sessiz: false, askAt: now() + 2.5, solved: null }; phase = 'intro';
          if (!queue.length && now() >= speakingUntil) {
            // Birkaç dakikada bir: "ilk ben yazdım" itirazlarının sebebini (yayın gecikmesi) kendiliğinden açıklar.
            if (now() - lastFair > 300 && now() - bornAt > 100 && say('ilkBenNot', {}, { priority: 1, ttl: 1.5 })) lastFair = now();
            else say('soruGeliyor', {}, { priority: 1, ttl: 1.5 });
          }
          break;
        case 'ask':
          phase = 'ask'; q.askAt = now(); lastChat = now(); purge(1);
          say('ipucu', {}, { kind: 'ipucu', priority: 5, ttl: 6, text: f.clue, speech: (f.double ? 'Çifte puanlı soru! ' : '') + f.say });
          break;
        case 'reveal':
          q.reveals += 1;
          if (f.left <= 2 && !q.son) { q.son = true; say('sonHarfler', {}, { priority: 1, ttl: 2.5 }); }
          else if (q.reveals === 2 && !q.harf && rng() < 0.5) { q.harf = true; say('harfAcildi', {}, { priority: 1, ttl: 2.5 }); }
          break;
        case 'guess':
          lastChat = now();
          if (f.verdict === 'near') { if (ready('near', 7)) say('yaklasti', { ad: nameOf(f.user) }, { priority: 2, ttl: 3 }); }
          else if (f.verdict === 'wrong' && rng() < 0.3 && ready('tease', 15)) say('yanlisTakil', { ad: nameOf(f.user) }, { priority: 1, ttl: 3 });
          break;
        case 'solved':
          phase = 'solved'; lastChat = now(); q.solved = f; purge(2);
          // Kazananın adı mutlaka sesle duyulsun: önce çok kısa adlı ünlem (yarım saniyede seslenir), ardından önceden
          // seslendirilmiş "son saniyeler" cümlesi. Uzun tek cümle Pocket'te yetişmiyor, yerine adsız genel kayıt çalıyordu.
          if (nameOf(f.user)) { say('bildiKisa', { ad: nameOf(f.user) }, { kind: 'bildiAni', priority: 5, ttl: 4.8 }); say('bildiDevam', {}, { kind: 'bildiDevam', priority: 4, ttl: 4.2 }); }
          else say('bildiAniAdsiz', {}, { kind: 'bildiAni', priority: 5, ttl: 3 });
          break;
        case 'answer': {
          const s = q.solved, first = f.winners?.[0]; if (!s || !first) break;
          const ad = nameOf(first.user), vars = { ad, cevap: titleCase(f.answer), puan: first.points, seri: s.streak };
          const key = !ad ? 'bildi' : s.fast ? 'bildiHizli' : s.streak >= 3 ? 'bildiSeri' : s.double ? 'bildiCifte' : s.first ? 'bildiIlk' : 'bildi';
          // Cevabı açıklayan cümle çözüm anında seçilip seslendirilmeye başlanmıştı (prepareReveal): burada hazır gelir.
          say(key, vars, { kind: 'bildi', priority: 5, ttl: 6, ...(q.reveal?.first === first.user.id ? { text: q.reveal.text } : {}) });
          const others = (f.winners || []).slice(1).map((w) => nameOf(w.user)).filter(Boolean);
          if (others.length === 2) say('ikinciler', { ad2: others[0], ad3: others[1] }, { kind: 'ikinciler', priority: 4, ttl: 5 });
          else if (others.length === 1) say('ikinciTek', { ad2: others[0] }, { kind: 'ikinciler', priority: 4, ttl: 5 });
          break;
        }
        case 'others': if (f.count >= 3) say('digerleri', { n: f.count }, { priority: 3, ttl: 4 }); break;
        case 'timeout': phase = 'timeout'; purge(2); say('sureBitti', { cevap: titleCase(f.answer) }, { priority: 4, ttl: 5 }); break;
        case 'questionEnd':
          asked += 1;
          if (f.fact && opt.spokenFacts && asked % 3 === 0) say('bilgi', {}, { kind: 'bilgi', priority: 1, ttl: 2.5, text: f.fact });
          break;
        case 'levelUp': say('unvan', { ad: nameOf(f.user), unvan: f.title }, { priority: 4, ttl: 8 }); break;
        case 'record': say('rekor', { n: f.solved }, { priority: 3, ttl: 6 }); break;
        case 'roundEnd':
          phase = 'podium'; purge(2);
          say('turSonu', { tur: f.round }, { priority: 4, ttl: 6 });
          if (f.champion) say('sampiyon', { ad: nameOf(f.champion), puan: f.champion.points }, { priority: 4, ttl: 10 });
          break;
        case 'breakStart': {
          phase = 'break';
          if (QUIET_IN_BREAK.has(speakingKind)) speakingUntil = now();
          listen = { until: now(), question: null, count: 0, seen: new Set() };
          // Soru molanın başında sorulur ki cevap yazmaya ve karşılık almaya süre kalsın; dinleme yeni turun ilk saniyelerine de taşar.
          say('molaBasla', {}, { priority: 4, ttl: 8 });
          later(3.5, () => { if (phase === 'break') askChat('molaSoru', 45); });
          const names = [...new Set(thanksTo)].slice(0, 3); thanksTo = [];
          if (names.length) later(22, () => { if (phase === 'break') say('molaTesekkur', { adlar: joinNames(names) }, { priority: 3, ttl: 8 }); });
          if (opt.followReminder && now() - lastFollowReminder > 300) later(33, () => { if (phase === 'break' && opt.followReminder && say('takipHatirlat', {}, { priority: 1, ttl: 5 })) lastFollowReminder = now(); });
          break;
        }
      }
    }
  }
  const titleCase = (s) => String(s).split(' ').map((w) => { const c = [...w]; return c[0] + c.slice(1).join('').toLocaleLowerCase('tr-TR'); }).join(' ');

  /* ---------- yayın olayları ---------- */
  const social = {
    join(user, info = {}) { if (greeted.has(user.id)) return; greeted.add(user.id); joins.push({ user, info }); if (joins.length > 6) joins.shift(); },
    follow(user) { if (thanked.has('f' + user.id)) return; thanked.add('f' + user.id); const ad = nameOf(user); if (phase !== 'break' && ad) say('takip', { ad }, { priority: 3, ttl: 10, onSpeak: () => thanksTo.push(ad) }); },
    share(user) { if (!ready('s' + user.id, 120)) return; const ad = nameOf(user); if (ad) thanksTo.push(ad); say('paylasim', { ad }, { priority: 3, ttl: 10 }); },
    like(user, count) {
      if (phase === 'break') return;
      const n = (likes.get(user.id) || 0) + count; likes.set(user.id, n);
      if (n >= 30 && ready('like', 20)) { likes.set(user.id, 0); say('begeni', { ad: nameOf(user) }, { priority: 2, ttl: 5 }); }
    },
    cheer() { if (phase !== 'break') say('cosku', {}, { priority: 3, ttl: 5 }); },
    viewers(n) { const m = MILESTONES.filter((x) => x <= n).pop(); if (m && m > viewersSeen) { if (viewersSeen) say('izleyici', { n: m }, { priority: 2, ttl: 6 }); viewersSeen = m; } },
  };

  /** Hazır cevabı olan sohbet niyeti. Soru açıkken kısa ömürlüdür (ipucu ve kazanan önce gelir), molada rahat konuşur. */
  function onIntent(user, { intent, il }) {
    lastChat = now();
    const calm = phase === 'break' || phase === 'lobby' || phase === 'podium', key = 'niyet.' + intent;
    if (!lines[key]) return false;
    // Önce bakılır, replik gerçekten sıraya girince işaretlenir: reddedilen deneme kimsenin bekleme süresini yemez.
    const mine = 'i:' + user.id + ':' + intent, shared = intent === 'memleket' ? 'il:' + il : 'intent', gap = intent === 'memleket' ? (listening() ? 30 : 120) : calm ? 3.5 : 6, t = now();
    if (t - (cool.get(mine) ?? -1e9) < 60 || t - (cool.get(shared) ?? -1e9) < gap) return false;
    const vars = { ad: nameOf(user), il };
    if (intent === 'puanim') { const s = standing(user.id); if (!s) return false; vars.puan = s.points; vars.sira = s.rank; }
    // Adlı cevabın sesi yetişmezse aynı cümlenin "dostum"lu hali çalar (açılışta önceden seslendirilir): sohbet cevabı miyava düşmesin.
    const tpl = pick(key); if (!tpl) return false;
    const named = vars.ad && /\{ad\}/.test(tpl) && !/\{(?!ad\})\w+\}/.test(tpl);
    const line = fill(tpl, { ...vars, ad: vars.ad || 'dostum' });
    if (!say(key, vars, { kind: 'niyet', priority: 2, ttl: calm ? 12 : 5, text: line, ...(named ? { fallback: { text: fill(tpl, { ad: 'dostum' }), emotion: STYLE.niyet[0] } } : {}) })) return false;
    cool.set(mine, t); cool.set(shared, t); return true;
  }
  /** Dışarıdan hazır metin (yapay zekâ sohbet cevabı). */
  const custom = (text, { kind = 'sohbet', priority = 2, ttl = 8, emotion, gesture } = {}) => say(kind, {}, { kind, priority, ttl, text, emotion, gesture });

  function tick(snap) {
    const t = now(); if (snap) phase = snap.phase;
    for (let i = timers.length - 1; i >= 0; i--) if (timers[i].at <= t) { const [job] = timers.splice(i, 1); job.fn(); }
    if (joins.length && phase !== 'solved' && queue.length < 2 && ready('greet', 8)) {
      const list = joins.splice(0), old = list.find((j) => j.info.returning && j.info.title && nameOf(j.user));
      const names = list.map((j) => nameOf(j.user)).filter(Boolean).slice(0, 3);
      if (old) say('hosgeldinEski', { ad: nameOf(old.user), unvan: old.info.title }, { kind: 'hosgeldin', priority: 2, ttl: 5 });
      else if (names.length >= 2) say('hosgeldinCoklu', { adlar: joinNames(names) }, { kind: 'hosgeldin', priority: 2, ttl: 5, avoid: noQuestion() });
      else if (names.length && lines.canoKarsilama && familiarReady()) say('canoKarsilama', { ad: names[0] }, { kind: 'hosgeldin', priority: 2, ttl: 7 });
      else say('hosgeldin', { ad: names[0] || null }, { kind: 'hosgeldin', priority: 2, ttl: 5, avoid: noQuestion() });
    }
    if (phase === 'ask' && snap) {
      if (snap.timeLeft <= 6 && !q.sure) { q.sure = true; say('sureDoluyor', {}, { priority: 2, ttl: 3 }); }
      if (!q.sessiz && t - q.askAt > 10 && t - lastChat > 12 && ready('idle', 25)) { q.sessiz = true; say('sessiz', {}, { priority: 1, ttl: 3 }); }
    }
    return pump();
  }

  /**
   * Değişkensiz replikleri arka planda, tek sıra hâlinde seslendirir (ilk söylenişte gecikme olmasın). Yayının başında
   * gerekenler önce gelir: açılış, "soru geliyor", adsız "bildi", "süre doluyor", mola. Ses ya da anlatım değişince yeniden
   * çağrılır: aynı ses için ikinci çağrı yeni iş başlatmaz; ses değiştiyse eski sesin kalan işleri bırakılır.
   */
  function warm() {
    const st = tts.status?.() || {};
    const sig = [tts.provider, st.pocketVoice ?? st.voice ?? '', st.delivery ?? ''].join('|');
    if (warmRun?.sig === sig) return warmRun.promise;
    warmRun?.stop();
    const first = ['soruGeliyor', 'bildiAniAdsiz', 'sureDoluyor', 'molaBasla', 'molaSoru'];
    const rank = (key) => (key.startsWith('acilis') ? 0 : first.includes(key) ? 1 + first.indexOf(key) : 99);
    const list = [];
    for (const [key, pool] of Object.entries(lines).sort((a, b) => rank(a[0]) - rank(b[0]))) {
      const style = STYLE[WARM_AS[key] || key] || (key.startsWith('niyet.') ? STYLE.niyet : ['neutral']);
      for (const text of pool) {
        if (!/\{\w+\}/.test(text)) list.push({ text, emotion: style[0] });
        else if (key.startsWith('niyet.') && !/\{(?!ad\})\w+\}/.test(text)) list.push({ text: fill(text, { ad: 'dostum' }), emotion: STYLE.niyet[0] });   // adlı sohbet cevaplarının yedeği
      }
    }
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    const run = { sig, stop: () => abort?.abort() };
    let job;
    try { job = Promise.resolve(list.length ? tts.warm?.(list, { signal: abort?.signal }) : 0); } catch { job = Promise.resolve(0); }
    run.promise = job.then((n) => n || 0, () => 0);
    warmRun = run;
    return run.promise;
  }


  return { onFx, onIntent, onBreakAnswer, prepareReveal, listening, asked: () => (listening() ? listen.question : null), social, custom, tick, warm, activity: () => { lastChat = now(); },
    setOptions(o) { Object.assign(opt, o); }, idle: () => pumping || Promise.resolve(), queued: () => queue.length, speaking: () => now() < speakingUntil };
}
