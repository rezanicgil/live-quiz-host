// Bil Bakalım: Tarçın'ın sesi. Kısa replikleri WAV dosyasına çevirir ve diskte önbelleğe alır.
// Sağlayıcılar: pocket (yerel Türkçe model, kalıcı bir Python işçisi: tts-pocket.py) · azure (doğal ses; anahtar yalnız
// ortam değişkeninde) · local (Windows'un yerleşik Türkçe sesi, kalıcı bir PowerShell işçisi: tts-local.ps1) · off.
// Çağırana asla hata fırlatmaz: üretilemeyen ses `null` döner, sahne alt yazıyla devam eder. Önbellek klasörü dışına
// hiçbir şey yazmaz. Pocket çökerse yayın susmaz: işçi artan aralıklarla yeniden denenir, o sırada canlı replikler
// Windows sesiyle söylenir (önbellek anahtarı sağlayıcıya göre ayrıdır, sesler karışmaz), Pocket dönünce ona geçilir.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

const WORKER_SCRIPT = fileURLToPath(new URL('./tts-local.ps1', import.meta.url));
const POCKET_WORKER = fileURLToPath(new URL('./tts-pocket.py', import.meta.url));
const POCKET_DIR = fileURLToPath(new URL('../data/pocket-tts/', import.meta.url));
export const POCKET_VOICES = ['female_2', 'male_2'];
const POCKET_TONES = { neutral: 'sakin', think: 'sakin', happy: 'mutlu', excited: 'mutlu', wow: 'şaşkın', sad: 'üzgün', love: 'mutlu', wink: 'mutlu' };
const EMOTIONS = ['neutral', 'happy', 'excited', 'wow', 'think', 'sad', 'love', 'wink'];
const PROVIDERS = ['auto', 'pocket', 'azure', 'local', 'off'];
const AZURE_VOICE = 'tr-TR-EmelNeural';
const AZURE_NAME = /^([a-z]{2,3}-[A-Z]{2})-\S+$/; // "tr-TR-EmelNeural" biçimi; yerel ses adları ("Microsoft Tolga") buna uymaz
const LOCAL_VOICE = 'tr-TR';
const KEY_VERSION = 'bb-tts-1'; // hız/perde tablosu değişirse artır: eski önbellek kendiliğinden geçersiz kalır
const WAV_NAME = /^[0-9a-f]{40}\.wav$/;
const TMP_NAME = /^[0-9a-f]{40}\.\d+\.tmp$/;
const MAX_TEXT = 400;
const STALE_MS = 60_000; // bu kadar beklemiş canlı replik artık söylenmez; üretmeye değmez
const DEFAULT_PRIORITY = 3; // speak() önceliği verilmezse; sunucu karakter 1 (dolgu) … 5 (ipucu, "bildi") kullanır
const POCKET_BACKOFF = [5_000, 15_000, 60_000, 120_000]; // art arda çöken Pocket işçisi bu aralıklarla denenir; sonuncusu yinelenir
const KEEP_MS = 10 * 60_000; // çalışırken yapılan önbellek temizliği bu kadar yeni dosyaya dokunmaz
const TOUCH_MS = 60_000; // kullanılan dosyanın tarihi en çok bu aralıkla yenilenir
const TIMEOUT = Symbol('timeout');
const RETRY = Symbol('retry');
// İşçilere yalnız çalışmaları için gereken ortam değişkenleri geçer; API anahtarları (AZURE_SPEECH_KEY, ANTHROPIC_API_KEY…)
// ve geri kalan her şey dışarıda kalır.
const ENV_KEEP = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOME',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'ALLUSERSPROFILE', 'PUBLIC', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)',
  'COMMONPROGRAMW6432', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'OS', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'PSMODULEPATH', 'LANG', 'LC_ALL', 'TZ']);

// ---------------------------------------------------------------------------------------------------------------------
// WAV

/** RIFF/WAVE içinde "fmt " ve "data" parçalarını bulur (aradaki LIST, fact vb. parçaları atlar). */
function scanWav(input) {
  if (!(input instanceof Uint8Array) || input.length < 44) return null;
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') return null;
  let fmt = null;
  for (let o = 12; o + 8 <= b.length;) {
    const id = b.toString('latin1', o, o + 4), size = b.readUInt32LE(o + 4), body = o + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > b.length) return null;
      let tag = b.readUInt16LE(body);
      if (tag === 0xfffe && size >= 40 && body + 26 <= b.length) tag = b.readUInt16LE(body + 24); // WAVE_FORMAT_EXTENSIBLE
      fmt = { tag, channels: b.readUInt16LE(body + 2), sampleRate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      if (!fmt) return null;
      const rest = b.length - body;
      // Akışla gelen başlıklarda boyut 0 ya da 0xFFFFFFFF olabilir; o zaman gerçek uzunluk dosyanın kalanıdır.
      const exact = size > 0 && size <= rest;
      return { buffer: b, fmt, sizeAt: o + 4, length: exact ? size : rest, exact };
    }
    o = body + size + (size & 1);
  }
  return null;
}

/**
 * PCM WAV başlığını okur.
 * @param {Uint8Array} buffer
 * @returns {{ms:number, sampleRate:number, channels:number, bits:number}|null} geçersiz ya da PCM olmayan veri için null
 */
export function wavInfo(buffer) {
  try {
    const wav = scanWav(buffer);
    if (!wav) return null;
    const { tag, channels, sampleRate, bits } = wav.fmt;
    if (tag !== 1 || channels < 1 || sampleRate < 1 || ![8, 16, 24, 32].includes(bits)) return null;
    const bytesPerSecond = sampleRate * channels * (bits / 8);
    return { ms: Math.round((wav.length / bytesPerSecond) * 1000), sampleRate, channels, bits };
  } catch {
    return null;
  }
}

/** Başlıktaki boyutlar gerçek uzunlukla uyuşmuyorsa düzeltilmiş bir kopya döndürür (tarayıcı dosyayı çalabilsin). */
function repairWav(buffer) {
  const wav = scanWav(buffer);
  if (!wav || wav.exact) return buffer;
  const fixed = Buffer.from(wav.buffer);
  fixed.writeUInt32LE((fixed.length - 8) >>> 0, 4);
  fixed.writeUInt32LE(wav.length >>> 0, wav.sizeAt);
  return fixed;
}

// ---------------------------------------------------------------------------------------------------------------------
// Hız, perde, SSML, anahtar

// [hız %, perde %]. İki sağlayıcı da işaretli yüzdeyi ("+10%", "-4%") kabul eder.
// local (Microsoft Tolga, ölçüldü): hız yüzdesi basamaklara yuvarlanır: -15…-6 → ×0,89 · -5…+5 → ×1,00 · +6…+17 → ×1,11 ·
//   +18…+31 → ×1,24 · +32…+46 → ×1,39. Değerler basamak ortasından seçildi. Perde yüzdesi kesintisizdir ama yazılanın
//   yaklaşık yarısı kadar etki eder (+20% ≈ %11 tiz). "1.2" gibi çıplak sayı perdede hata verir, "+40Hz" tavana vurur.
// azure: yüzdeler olduğu gibi uygulanır, bu yüzden daha ölçülü (gerçek serviste kulakla denenmedi).
const PROSODY = {
  local: { neutral: [10, 0], happy: [22, 8], excited: [26, 15], wow: [10, 18], think: [0, -4], sad: [-10, -10], love: [10, 6], wink: [10, 4] },
  azure: { neutral: [6, 0], happy: [12, 5], excited: [18, 9], wow: [6, 10], think: [-4, -3], sad: [-10, -6], love: [6, 4], wink: [8, 3] },
};
const percent = (n) => `${n < 0 ? '-' : '+'}${Math.abs(n)}%`;

/**
 * Duyguya göre konuşma hızı ve perdesi. Varsayılan anlatım canlı ama anlaşılır (sesin kendi hızından biraz hızlı).
 * @param {string} emotion 'neutral'|'happy'|'excited'|'wow'|'think'|'sad'|'love'|'wink' (bilinmeyen → neutral)
 * @param {'local'|'azure'} [provider='local']
 * @returns {{rate:string, pitch:string}} SSML `<prosody>` öznitelik değerleri
 */
export function prosodyFor(emotion, provider = 'local', delivery = 'presenter') {
  if (delivery === 'natural') {
    const tones = { neutral: [0, 0], happy: [6, 2], excited: [9, 4], wow: [1, 3], think: [-3, -1], sad: [-6, -2], love: [-1, 1], wink: [3, 2] };
    const [rate, pitch] = tones[emotion] || tones.neutral;
    return { rate: percent(rate), pitch: percent(pitch) };
  }
  const table = PROSODY[provider] || PROSODY.local;
  const [rate, pitch] = table[emotion] || table.neutral;
  return { rate: percent(rate), pitch: percent(pitch) };
}

const XML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
function xml(value) {
  let s = String(value ?? '');
  if (typeof s.toWellFormed === 'function') s = s.toWellFormed(); // eşi olmayan vekil karakter XML'i bozmasın
  // XML 1.0'da yasak denetim karakterleri boşluğa döner; sonra beş özel karakter kaçışlanır.
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, ' ').replace(/[&<>"']/g, (c) => XML[c]);
}

/**
 * Metni SSML'e sarar; metin ve öznitelikler XML için kaçışlanır.
 * @param {string} text
 * @param {{voice?:string, rate?:string, pitch?:string, lang?:string}} [options] voice verilirse `<voice name>` eklenir (azure)
 * @returns {string}
 */
export function buildSsml(text, { voice, rate, pitch, lang = 'tr-TR' } = {}) {
  let body = xml(text);
  const attrs = (rate ? ` rate="${xml(rate)}"` : '') + (pitch ? ` pitch="${xml(pitch)}"` : '');
  if (attrs) body = `<prosody${attrs}>${body}</prosody>`;
  if (voice) body = `<voice name="${xml(voice)}">${body}</voice>`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${xml(lang)}">${body}</speak>`;
}

/** Önbellek anahtarı: aynı sağlayıcı + ses + duygu + metin her zaman aynı sha1'i verir. */
export function cacheKey({ provider, voice, emotion, text, delivery } = {}) {
  const parts = [KEY_VERSION, String(provider ?? ''), String(voice ?? ''), String(emotion ?? 'neutral'), String(text ?? '')];
  if (delivery === 'natural') parts.push('natural-v1');
  return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex');
}

// ---------------------------------------------------------------------------------------------------------------------
// Yardımcılar

const cleanText = (text) => (typeof text === 'string' || typeof text === 'number' ? String(text).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error) => String(error?.message ?? error ?? 'bilinmeyen hata').replace(/\s+/g, ' ').trim();

/** promise `ms` içinde bitmezse TIMEOUT ile sonuçlanır (asla reddetmez diye bir söz vermez; reddi çağıran yakalar). */
function within(promise, ms) {
  let timer;
  const guard = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMEOUT), ms); });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/** İşçiye giden satır yalnız ASCII'dir: Türkçe harfler \uXXXX olarak gider, konsol kod sayfası araya giremez. */
const asciiJson = (value) => JSON.stringify(value).replace(/[\u007f-\uFFFF]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

/** Windows'ta yeni yazılmış dosyayı virüs tarayıcı kısa süre tutabilir; yeniden adlandırma birkaç kez denenir. */
async function renameIntoPlace(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.promises.rename(from, to);
    } catch (error) {
      if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(error?.code)) throw error;
      await wait(25 * (attempt + 1));
    }
  }
}

function resolveProvider(wanted, { hasAzure, hasPocket, platform }) {
  if (wanted === 'pocket') return hasPocket ? 'pocket' : 'off';
  if (wanted === 'off') return 'off';
  if (wanted === 'azure') return hasAzure ? 'azure' : 'off';
  if (wanted === 'local') return platform === 'win32' ? 'local' : 'off';
  return hasPocket ? 'pocket' : hasAzure ? 'azure' : platform === 'win32' ? 'local' : 'off';
}

/** Çocuk süreç için sade ortam: yalnız izinli adlar ve verilen ekler. */
function cleanEnv(source, extra = {}) {
  const out = {};
  for (const [name, value] of Object.entries(source || {})) if (value !== undefined && ENV_KEEP.has(name.toUpperCase())) out[name] = value;
  return { ...out, ...extra };
}
const seconds = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${Math.round(ms / 1000)} sn`);

// ---------------------------------------------------------------------------------------------------------------------

/**
 * @param {object} [options]
 * @param {'auto'|'pocket'|'azure'|'local'|'off'} [options.provider='auto'] auto: kurulu Pocket, ardından Azure veya Windows
 * @param {string} [options.voice] azure ses adı ("tr-TR-AhmetNeural") ya da yerel ses adından bir parça ("Tolga")
 * @param {string} options.cacheDir önbellek klasörü (`<sha1>.wav`)
 * @param {object} [options.env=process.env] AZURE_SPEECH_KEY, AZURE_SPEECH_REGION buradan okunur
 * @param {Function} [options.fetchImpl=fetch] @param {Function} [options.spawnImpl=child_process.spawn]
 * @param {(line:string)=>void} [options.log]
 * @param {number} [options.maxFiles=5000] önbellekteki en çok dosya; açılışta ve çalışırken her `sweepEvery` yeni dosyada uygulanır
 * @param {number} [options.sweepEvery=200]
 * @param {boolean} [options.fallback=true] Pocket konuşamazken Windows sesine geç (yalnız Windows'ta)
 * @param {object} [options.workerEnv=process.env] işçilerin ortamı buradan süzülür (anahtarlar geçmez)
 * @param {string} [options.platform=process.platform]
 * @param {{job?:number, ready?:number, pocketReady?:number, azure?:number, warmGap?:number, warmIdle?:number, restart?:number, backoff?:number[], fallbackAfter?:number, keep?:number, touch?:number}} [options.timings] ms; testler ve ince ayar için
 */
export function createTts({
  provider = 'auto', voice, pocketVoice = 'female_2', pocketDir = POCKET_DIR, delivery = 'presenter', cacheDir, env = process.env, fetchImpl = globalThis.fetch, spawnImpl = spawn,
  log = () => {}, maxFiles = 5000, sweepEvery = 200, platform = process.platform, fallback = true, workerEnv = process.env, timings,
} = {}) {
  const azureKey = String(env?.AZURE_SPEECH_KEY ?? '').trim();
  const azureRegion = String(env?.AZURE_SPEECH_REGION ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const regionOk = /^[a-z0-9-]+$/.test(azureRegion);
  const wantedVoice = typeof voice === 'string' ? voice.trim() : '';
  const azureVoice = AZURE_NAME.test(wantedVoice) ? wantedVoice : AZURE_VOICE;
  const azureLang = AZURE_NAME.exec(azureVoice)[1];
  const localVoice = wantedVoice && !AZURE_NAME.test(wantedVoice) ? wantedVoice : '';
  const wanted = PROVIDERS.includes(String(provider ?? '').trim().toLowerCase()) ? String(provider).trim().toLowerCase() : 'auto';
  const time = { job: 15_000, ready: 20_000, azure: 8_000, restart: 250, fallbackAfter: 30_000, keep: KEEP_MS, touch: TOUCH_MS, ...(timings || {}) };
  time.pocketReady = timings?.pocketReady ?? timings?.ready ?? 120_000;
  time.backoff = Array.isArray(timings?.backoff) && timings.backoff.length ? timings.backoff : POCKET_BACKOFF;

  const pocketPython = path.join(pocketDir, 'venv', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const hasPocket = fs.existsSync(path.join(pocketDir, 'ready-v1'));
  const hasAzure = Boolean(azureKey && regionOk);
  if (!POCKET_VOICES.includes(pocketVoice)) pocketVoice = 'female_2';
  let resolved = resolveProvider(wanted, { hasAzure, hasPocket, platform });
  let lastError = null, failures = 0, closed = false;

  // Anahtar hiçbir günlüğe ya da hata metnine girmez.
  const scrub = (value) => {
    let s = message(value);
    if (azureKey) s = s.split(azureKey).join('***');
    return s.slice(0, 300);
  };
  const say = (line) => { try { log('tts: ' + line); } catch { /* günlük hatası sesi durdurmasın */ } };
  const fail = (reason) => { failures++; lastError = scrub(reason); say(lastError); };

  if (resolved === 'off' && wanted === 'azure') lastError = azureKey && azureRegion ? 'azure: AZURE_SPEECH_REGION geçersiz' : 'azure: AZURE_SPEECH_KEY ve AZURE_SPEECH_REGION tanımlı değil (SES_ANAHTARI.bat)';
  if (resolved === 'off' && wanted === 'local') lastError = 'local: yerleşik Türkçe ses yalnız Windows\'ta var';
  if (resolved === 'off' && wanted === 'pocket') lastError = 'Pocket sesini hazırlamak için POCKET_SES_KUR.bat dosyasını aç.';

  // --- işçiler: pocket (Python) ve local (PowerShell). local, Pocket konuşamazken yedek olarak da çalışır. ---------------
  const makeWorker = (kind) => ({ kind, child: null, ready: false, busy: false, voice: null, pending: null, seq: 0, fails: 0, dead: false, startedAt: 0, retryAt: 0, why: null, restartTimer: null, readyTimer: null, stderr: '' });
  const workers = { pocket: makeWorker('pocket'), local: makeWorker('local') };
  const canFallback = () => resolved === 'pocket' && fallback !== false && platform === 'win32' && !workers.local.dead;
  /** Pocket şu an konuşamıyor mu? Çöktüyse yeniden hazır olana kadar; ilk açılışta yalnız yükleme çok uzarsa. */
  const pocketDown = () => {
    const w = workers.pocket;
    if (resolved !== 'pocket' || w.ready) return false;
    return w.fails > 0 || (w.startedAt > 0 && Date.now() - w.startedAt > time.fallbackAfter);
  };

  // --- önbellek ------------------------------------------------------------------------------------------------------
  const dir = typeof cacheDir === 'string' && cacheDir ? path.resolve(cacheDir) : null;
  const names = new Set(); // diskteki <sha1>.wav adları
  const known = new Map(); // anahtar → ms (başlığı doğrulanmış dosyalar)
  const touched = new Map(); // anahtar → dosya tarihinin son yenilendiği an
  const limit = Number.isInteger(maxFiles) && maxFiles >= 0 ? maxFiles : 5000;
  const every = Number.isInteger(sweepEvery) && sweepEvery > 0 ? sweepEvery : 200;
  let sinceSweep = 0, sweeping = false;

  function prepareCache() {
    fs.mkdirSync(dir, { recursive: true });
    const now = Date.now();
    for (const entry of fs.readdirSync(dir)) {
      if (WAV_NAME.test(entry)) names.add(entry);
      else if (TMP_NAME.test(entry)) {
        // Yarım kalmış eski üretimler; başka bir sürecin şu an yazdığı dosyaya dokunmamak için yalnız bayat olanlar silinir.
        try { if (now - fs.statSync(path.join(dir, entry)).mtimeMs > 60_000) fs.rmSync(path.join(dir, entry), { force: true }); } catch { /* yoksay */ }
      }
    }
    if (names.size <= limit) return;
    const aged = [...names].map((name) => {
      try { return { name, at: fs.statSync(path.join(dir, name)).mtimeMs }; } catch { return { name, at: 0 }; }
    }).sort((a, b) => a.at - b.at);
    for (const { name } of aged.slice(0, names.size - limit)) {
      try { fs.rmSync(path.join(dir, name), { force: true }); names.delete(name); } catch { /* yoksay */ }
    }
  }

  /**
   * Çalışırken sınırı korur: en eski dosyalar (tarihe göre) sınıra inene dek silinir. Son `keep` ms içinde üretilmiş ya da
   * kullanılmış dosyaya ve o an üretilmekte olana dokunulmaz (sahne az önce verilen bir adresi hâlâ indiriyor olabilir).
   */
  async function sweep() {
    if (sweeping || closed || !dir) return 0;
    sweeping = true;
    let removed = 0;
    try {
      const now = Date.now(), rows = [];
      for (const entry of await fs.promises.readdir(dir)) {
        if (!WAV_NAME.test(entry)) continue;
        try { const s = await fs.promises.stat(path.join(dir, entry)); rows.push({ name: entry, at: Math.max(s.mtimeMs, s.birthtimeMs || 0) }); } catch { /* az önce silinmiş */ }
      }
      rows.sort((a, b) => a.at - b.at);
      let excess = rows.length - limit;
      for (const { name, at } of rows) {
        if (excess <= 0 || closed || now - at < time.keep) break; // sıralı: buradan sonrası daha da yeni
        const key = name.slice(0, 40);
        if (inflight.has(key)) continue;
        try { await fs.promises.rm(path.join(dir, name), { force: true }); } catch { continue; }
        names.delete(name); known.delete(key); touched.delete(key);
        excess--; removed++;
      }
      if (removed) say(`önbellek: ${removed} eski kayıt silindi (${names.size} kayıt kaldı, sınır ${limit})`);
    } catch { /* klasör okunamadıysa sonraki turda yeniden denenir */ } finally {
      sweeping = false;
    }
    return removed;
  }
  function grew() {
    if (++sinceSweep < every) return;
    sinceSweep = 0;
    if (names.size > limit) sweep();
  }

  /** Önbellekte varsa `{name, file, ms, provider, voice}`; yoksa ya da dosya bozuksa null. */
  function lookup({ key, provider: engine, voice: v }) {
    const name = key + '.wav', file = path.join(dir, name);
    try {
      let ms = known.get(key);
      if (ms !== undefined) {
        if (!fs.existsSync(file)) { known.delete(key); names.delete(name); touched.delete(key); return null; }
      } else {
        if (!fs.existsSync(file)) { names.delete(name); return null; }
        const info = wavInfo(fs.readFileSync(file));
        if (!info || info.ms <= 0) { // bozuk dosya: sil, yeniden üretilsin
          fs.rmSync(file, { force: true }); names.delete(name);
          return null;
        }
        ms = info.ms;
        known.set(key, ms); names.add(name);
      }
      const now = Date.now();
      if (now - (touched.get(key) ?? 0) > time.touch) { // kullanılan replik "en eski" sayılıp silinmesin
        touched.set(key, now);
        const at = new Date(now);
        fs.utimes(file, at, at, () => {});
      }
      return { name, file, ms, provider: engine, voice: v };
    } catch {
      return null;
    }
  }

  const discard = (file) => fs.promises.rm(file, { force: true }).catch(() => {});

  /** Geçici dosyayı doğrular ve önbellekteki yerine taşır. */
  async function adopt(job, tmp, label) {
    try {
      const info = wavInfo(await fs.promises.readFile(tmp));
      if (!info || info.ms <= 0) throw new Error('geçersiz ses dosyası');
      await renameIntoPlace(tmp, job.file);
      return { name: job.name, file: job.file, ms: info.ms, provider: job.provider, voice: job.voice };
    } catch (error) {
      await discard(tmp);
      fail(`${label}: ${message(error)}`);
      return null;
    }
  }

  // --- kuyruk --------------------------------------------------------------------------------------------------------
  const inflight = new Map(); // anahtar → iş (aynı replik için tek üretim)
  const hi = [], lo = []; // hi: speak (canlı; önceliğe göre), lo: warm (arka plan; her zaman asıl sağlayıcı için)
  let azureActive = 0, pumpTimer = null, lastWarmAt = 0, lastLiveAt = 0, order = 0, inPump = false, pumpAgain = false;
  let blockUntil = 0, warmHoldUntil = 0, streak = 0; // azure: anahtar reddi / üst üste hata / hız sınırı sonrası bekleme

  const warmGap = () => time.warmGap ?? (resolved === 'azure' ? 3500 : 0); // azure: ısıtma, servisin istek sınırını canlı repliklere bıraksın
  const warmIdle = () => time.warmIdle ?? 0; // istenirse: son canlı replikten bu kadar sonra arka plan işi başlar (ölçümde ısınmayı çok yavaşlattı, varsayılan kapalı)
  const running = () => azureActive + (workers.pocket.busy ? 1 : 0) + (workers.local.busy ? 1 : 0);

  function settle(job, result) {
    if (job.settled) return;
    job.settled = true;
    if (inflight.get(job.key) === job) inflight.delete(job.key);
    job.resolve(result);
  }
  function unqueue(job) {
    for (const list of [hi, lo]) { const at = list.indexOf(job); if (at >= 0) list.splice(at, 1); }
  }
  function drain(only = () => true) {
    for (const job of [...hi, ...lo].filter(only)) { unqueue(job); settle(job, null); }
  }

  /** Bu motor şimdi yeni bir iş alabilir mi? Hazır olmayan işçi bu sırada başlatılır. */
  function free(engine) {
    if (engine === 'azure') return azureActive < 2; // azure'da ısıtma isteği sürerken canlı replik beklemesin
    const w = workers[engine];
    if (!w) return false;
    if (!w.ready) { ensureWorker(w); return false; }
    return !w.busy;
  }

  function pump() {
    if (inPump) { pumpAgain = true; return; } // işçi başlatılamazsa iç içe çağrı gelir: tur bitince bir kez daha dönülür
    inPump = true;
    try {
      do { pumpAgain = false; pumpOnce(); } while (pumpAgain && !closed);
    } finally {
      inPump = false;
    }
  }

  function pumpOnce() {
    if (closed) return;
    if (resolved === 'off') { drain(); return; }
    const now = Date.now();
    if (hi.length > 1) hi.sort((a, b) => b.priority - a.priority || a.order - b.order);
    for (let i = 0; i < hi.length;) {
      const job = hi[i];
      if (now - job.at > STALE_MS || (job.provider === 'azure' && now < blockUntil)) { hi.splice(i, 1); settle(job, null); }
      else if (free(job.provider)) { hi.splice(i, 1); run(job); }
      else i++;
    }
    if (!lo.length || pumpTimer) return;
    if (!(resolved === 'azure' ? azureActive === 0 : free(resolved))) return;
    const delay = Math.max(blockUntil, warmHoldUntil, lastWarmAt ? lastWarmAt + warmGap() : 0, lastLiveAt ? lastLiveAt + warmIdle() : 0) - now;
    if (delay > 0) {
      pumpTimer = setTimeout(() => { pumpTimer = null; pump(); }, delay);
      return;
    }
    run(lo.shift());
  }

  function run(job) {
    const w = workers[job.provider] || null;
    job.started = true;
    for (const tell of job.watchers.splice(0)) { try { tell(); } catch { /* çağıranın hatası üretimi durdurmasın */ } }
    if (w) w.busy = true; else azureActive++;
    const finish = (result) => {
      if (w) w.busy = false; else azureActive--;
      if (result === RETRY) { // işçi tam bu replikte öldü: bir kez daha denenir (Pocket'se o sırada Windows sesiyle)
        job.started = false;
        requeue(job);
        pump();
        return;
      }
      if (job.high) lastLiveAt = Date.now(); else lastWarmAt = Date.now();
      if (result) { known.set(job.key, result.ms); names.add(result.name); touched.set(job.key, Date.now()); grew(); }
      settle(job, result);
      pump();
    };
    let work;
    try { work = w ? synthWorker(job, w) : synthAzure(job); } catch (error) { work = Promise.reject(error); }
    work.then(finish, (error) => { fail(error); finish(null); });
  }

  function requeue(job) {
    if (job.settled) return;
    if (job.live <= 0 && job.warm <= 0) { settle(job, null); return; } // bekleyen kalmadı
    if (job.high && job.live > 0) {
      if (job.provider === 'pocket' && pocketDown()) toFallback(job);
      else hi.unshift(job);
    } else {
      job.high = false;
      lo.unshift(job);
    }
  }

  function target(engine, text, emotion, tone = delivery) {
    const v = engine === 'pocket' ? pocketVoice : engine === 'azure' ? azureVoice : localVoice || LOCAL_VOICE;
    return { provider: engine, voice: v, key: cacheKey({ provider: engine, voice: v, emotion, text, delivery: tone }) };
  }

  function newJob(want, text, emotion, high) {
    const job = { ...want, text, emotion, delivery, high, priority: 0, live: 0, warm: 0, started: false, settled: false, retried: false, into: null, watchers: [],
      at: Date.now(), order: ++order, name: want.key + '.wav', file: path.join(dir, want.key + '.wav') };
    job.promise = new Promise((resolve) => { job.resolve = resolve; });
    inflight.set(job.key, job);
    (high ? hi : lo).push(job);
    return job;
  }

  /** Sırada bekleyen arka plan işi canlıda istendi: öne alınır. Çalışmaya başlamışsa zaten yoldadır. */
  function promote(job) {
    if (job.high) return;
    const at = lo.indexOf(job);
    if (at < 0) return;
    lo.splice(at, 1);
    job.high = true; job.at = Date.now(); job.order = ++order;
    hi.push(job);
  }

  /** Bir istek vazgeçti (replik süresi doldu ya da sıradan çıkarıldı). Başlamamış ve kimsenin beklemediği iş hiç üretilmez. */
  function release(job, live) {
    job = job.into || job;
    if (job.settled) return;
    if (live) job.live = Math.max(0, job.live - 1); else job.warm = Math.max(0, job.warm - 1);
    if (job.started) return;
    if (job.live <= 0 && job.warm <= 0) { unqueue(job); settle(job, null); return; }
    if (job.live <= 0 && job.high) { // yalnız arka plan isteği kaldı: canlı sıradan çıkar
      const at = hi.indexOf(job);
      if (at < 0) return;
      hi.splice(at, 1);
      job.high = false; job.priority = 0;
      lo.push(job);
    }
  }

  /** Pocket konuşamazken sırada kalan canlı iş Windows sesine aktarılır (yedek yoksa boş döner). */
  function toFallback(job) {
    unqueue(job);
    if (inflight.get(job.key) === job) inflight.delete(job.key);
    const give = (result) => { job.settled = true; job.resolve(result); };
    if (!canFallback()) { give(null); return; }
    const alt = target('local', job.text, job.emotion, job.delivery);
    const hit = lookup(alt);
    if (hit) { give(hit); return; }
    const other = inflight.get(alt.key);
    if (other) { // aynı replik yedekte zaten üretiliyor: ona eklenir
      job.into = other; job.settled = true;
      other.live += job.live; other.priority = Math.max(other.priority, job.priority);
      if (other.started) for (const tell of job.watchers.splice(0)) { try { tell(); } catch { /* yoksay */ } }
      else other.watchers.push(...job.watchers.splice(0));
      promote(other);
      other.promise.then(job.resolve);
      return;
    }
    Object.assign(job, alt, { name: alt.key + '.wav', file: path.join(dir, alt.key + '.wav'), high: true, started: false, retried: false });
    inflight.set(job.key, job);
    hi.push(job);
  }

  /** Önbellekten ya da kuyruktan sonuç sözü; asla reddetmez. */
  function request(text, emotion, high, { priority, signal, onStart } = {}) {
    const clean = cleanText(text);
    if (!clean || closed || resolved === 'off' || !dir || signal?.aborted) return Promise.resolve(null);
    const emo = EMOTIONS.includes(emotion) ? emotion : 'neutral';
    let want = target(resolved, clean, emo);
    const hit = lookup(want); // asıl sesin kaydı varsa, o ses o an konuşamıyor olsa da kullanılır
    if (hit) return Promise.resolve(hit);
    if (high && pocketDown()) { // canlı replik beklemez: Windows sesine gider. Arka plan işleri Pocket'i bekler.
      if (!canFallback()) return Promise.resolve(null);
      want = target('local', clean, emo);
      const alt = lookup(want);
      if (alt) return Promise.resolve(alt);
    }
    const job = inflight.get(want.key) || newJob(want, clean, emo, high);
    if (high) {
      job.live++;
      job.priority = Math.max(job.priority, Number.isFinite(priority) ? priority : DEFAULT_PRIORITY);
      promote(job);
      lastLiveAt = Date.now();
    } else {
      job.warm++;
    }
    if (typeof onStart === 'function') { // üretim işçiye verildiği an haber verilir (önbellekten gelen için verilmez)
      if (job.started) { try { onStart(); } catch { /* yoksay */ } } else job.watchers.push(onStart);
    }
    pump();
    if (!signal) return job.promise;
    return new Promise((resolve) => {
      let done = false;
      const onAbort = () => { if (done) return; done = true; resolve(null); release(job, high); };
      signal.addEventListener('abort', onAbort, { once: true });
      job.promise.then((result) => { if (done) return; done = true; signal.removeEventListener('abort', onAbort); resolve(result); });
    });
  }

  // --- işçi süreçleri ---------------------------------------------------------------------------------------------------
  /** Bu işçiye şu an ihtiyaç var mı? Yedek (local) yalnız Pocket konuşamazken ya da ona iş düşmüşken açılır. */
  const needed = (w) => !closed && !w.dead && (w.kind === resolved || (w.kind === 'local' && canFallback() && (pocketDown() || hi.some((job) => job.provider === 'local'))));

  function ensureWorker(w) {
    if (w.child || w.restartTimer || !needed(w)) return;
    const wait = w.retryAt - Date.now();
    if (wait > 0) {
      w.restartTimer = setTimeout(() => { w.restartTimer = null; ensureWorker(w); }, wait);
      return;
    }
    startWorker(w);
  }

  function startWorker(w) {
    if (closed || w.dead || w.child) return;
    const pocket = w.kind === 'pocket';
    const args = pocket ? ['-u', POCKET_WORKER] : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WORKER_SCRIPT];
    if (!pocket && localVoice) args.push('-Voice', localVoice);
    const extra = pocket ? { HF_HOME: path.join(pocketDir, 'hf'), HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', PYTHONUTF8: '1' } : {};
    const options = { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: cleanEnv(workerEnv, extra) };
    w.startedAt = Date.now(); w.stderr = ''; w.ready = false;
    let child;
    try {
      child = spawnImpl(pocket ? pocketPython : 'powershell.exe', args, options);
    } catch (error) {
      workerDown(w, null, 'başlatılamadı: ' + message(error));
      return;
    }
    w.child = child;
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    child.stdout?.on('data', (chunk) => {
      buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (line) onWorkerLine(w, child, line);
      }
    });
    child.stderr?.on('data', (chunk) => { w.stderr = (w.stderr + chunk).slice(-200); });
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.on('error', () => {}); // ölen işçide EPIPE
    child.on('error', (error) => workerDown(w, child, message(error)));
    child.on('exit', (code) => workerDown(w, child, `kapandı (kod ${code})`));
    w.readyTimer = setTimeout(() => stopChild(w, child, 'zamanında hazır olmadı'), pocket ? time.pocketReady : time.ready);
  }

  function onWorkerLine(w, child, line) {
    if (child !== w.child) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if ('ready' in msg) {
      clearTimeout(w.readyTimer);
      if (msg.ready === true) {
        w.ready = true;
        w.voice = msg.voice ? String(msg.voice) : null;
        say(w.kind === 'pocket' && w.fails ? 'Pocket yeniden hazır' : w.kind === 'local' && resolved === 'pocket' ? `yedek ses hazır: ${w.voice || '?'}` : `yerel ses hazır: ${w.voice || '?'}`);
        pump();
      } else if (w.kind === 'pocket') {
        stopChild(w, child, message(msg.err));
      } else if (msg.err === 'no-voice') {
        const missing = 'Windows\'ta Türkçe ses kurulu değil (Ayarlar > Saat ve dil > Konuşma > Ses ekle)';
        if (resolved === 'local') turnOff('local: ' + missing);
        else { // yalnız yedek yok: Pocket denenmeye devam eder
          w.dead = true;
          retire(w, 'yedek ses yok');
          fail('yedek ses yok: ' + missing);
          drain((job) => job.provider === 'local');
        }
      } else {
        fail('local: işçi açılamadı: ' + message(msg.err)); // işçi kendiliğinden kapanır, bekleyip yeniden denenir
      }
      return;
    }
    const pending = w.pending;
    if (!pending || msg.id !== pending.id) return;
    w.pending = null;
    clearTimeout(pending.timer);
    if (msg.ok === true) {
      if (w.kind === 'pocket' && w.fails) say('Pocket yeniden konuşuyor');
      w.fails = 0; w.why = null;
    }
    pending.resolve(msg);
  }

  function stopChild(w, child, reason) {
    try { child.stdin?.end(); } catch { /* yoksay */ }
    try { child.kill(); } catch { /* yoksay */ }
    workerDown(w, child, reason);
  }

  function workerDown(w, child, reason) {
    if (child !== w.child) return; // aynı işçi için ikinci haber (error + exit) ya da eski işçi
    clearTimeout(w.readyTimer);
    w.child = null; w.ready = false;
    const pending = w.pending;
    w.pending = null;
    if (pending) { clearTimeout(pending.timer); pending.resolve({ ok: false, err: 'işçi kapandı', counted: true, died: true }); }
    if (closed || w.dead || resolved === 'off' || (w.kind === 'pocket' && resolved !== 'pocket')) return;
    const n = ++w.fails;
    const tail = w.stderr.trim() ? ' · ' + w.stderr.trim() : '';
    let delay;
    if (w.kind === 'pocket') {
      // İlk çöküş hemen yeniden denenir; art arda çökerse aralık büyür ama denemekten vazgeçilmez.
      delay = n === 1 ? time.restart : time.backoff[Math.min(n - 2, time.backoff.length - 1)];
      w.why = scrub(reason);
      fail(`pocket: işçi ${reason}${tail} · ${seconds(delay)} sonra yeniden denenecek${canFallback() ? ', o zamana kadar Windows sesi konuşur' : ''}`);
    } else {
      delay = Math.min(30_000, time.restart * 2 ** Math.min(n - 1, 10));
      fail(`local: işçi ${reason}${tail}`);
    }
    w.retryAt = Date.now() + delay;
    if (w.kind === 'pocket') for (const job of hi.filter((item) => item.provider === 'pocket')) toFallback(job);
    if (needed(w)) w.restartTimer = setTimeout(() => { w.restartTimer = null; startWorker(w); }, delay);
    pump();
  }

  /** İşçiyi yeniden başlatmamak üzere bırakır. */
  function retire(w, why) {
    clearTimeout(w.readyTimer); clearTimeout(w.restartTimer);
    w.restartTimer = null;
    const child = w.child;
    w.child = null; w.ready = false;
    if (w.pending) { clearTimeout(w.pending.timer); w.pending.resolve({ ok: false, err: why, counted: true }); w.pending = null; }
    if (child) { try { child.stdin?.end(); } catch { /* yoksay */ } try { child.kill(); } catch { /* yoksay */ } }
  }

  /** İşçiye bir istek gönderir; `{ok, ms?, n?, err?}` ile sonuçlanır, asla reddetmez. */
  function workerCall(w, payload) {
    return new Promise((resolve) => {
      const child = w.child;
      if (!child || !w.ready) { resolve({ ok: false, err: 'işçi hazır değil' }); return; }
      const id = ++w.seq;
      const timer = setTimeout(() => {
        if (w.pending?.id !== id) return;
        w.pending = null;
        resolve({ ok: false, err: 'işçi yanıt vermedi', counted: true });
        stopChild(w, child, 'yanıt vermedi');
      }, time.job);
      w.pending = { id, resolve, timer };
      try {
        child.stdin.write(asciiJson({ id, ...payload }) + '\n');
      } catch (error) {
        w.pending = null;
        clearTimeout(timer);
        resolve({ ok: false, err: message(error) });
      }
    });
  }

  async function synthWorker(job, w) {
    const tmp = path.join(dir, `${job.key}.${process.pid}.tmp`);
    const pocket = w.kind === 'pocket';
    const tone = job.emotion === 'neutral' && job.delivery === 'presenter' ? null : POCKET_TONES[job.emotion];
    const payload = pocket ? { text: job.text, voice: job.voice, emotion: tone } : { ssml: buildSsml(job.text, prosodyFor(job.emotion, 'local', job.delivery)) };
    const reply = await workerCall(w, { file: tmp, ...payload });
    if (reply.ok !== true) {
      await discard(tmp);
      if (!reply.counted) fail(job.provider + ': ' + message(reply.err));
      if (reply.died && !job.retried && !closed && resolved !== 'off') {
        job.retried = true;
        return RETRY;
      }
      return null;
    }
    if (!pocket && Number.isInteger(reply.n) && reply.n !== payload.ssml.length) {
      await discard(tmp);
      fail(`local: metin işçiye bozuk ulaştı (${payload.ssml.length} karakter gitti, ${reply.n} vardı)`);
      return null;
    }
    return adopt(job, tmp, job.provider);
  }

  // --- azure ---------------------------------------------------------------------------------------------------------
  async function synthAzure(job) {
    const ssml = buildSsml(job.text, { voice: azureVoice, lang: azureLang, ...prosodyFor(job.emotion, 'azure', job.delivery) });
    const abort = new AbortController();
    const call = (async () => {
      const response = await fetchImpl(`https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': azureKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',
          'User-Agent': 'bil-bakalim',
        },
        body: ssml,
        signal: abort.signal,
      });
      const status = Number(response?.status) || 0;
      if (status < 200 || status > 299) return { status, retryAfter: Number(response?.headers?.get?.('retry-after')) };
      return { status, audio: Buffer.from(await response.arrayBuffer()) };
    })();
    call.catch(() => {}); // zaman aşımından sonra gelen ret sahipsiz kalmasın

    let got;
    try {
      got = await within(call, time.azure);
    } catch (error) {
      got = { error: 'ağ hatası: ' + message(error) };
    }
    if (got === TIMEOUT) {
      abort.abort();
      got = { error: 'zaman aşımı' };
    }
    if (!got.audio) {
      const now = Date.now();
      streak++;
      if (got.status === 429) { // hız sınırı: arka plan üretimi bir süre dursun, canlı replikler denemeye devam etsin
        const pause = Number.isFinite(got.retryAfter) && got.retryAfter > 0 ? Math.min(got.retryAfter, 120) : 30;
        warmHoldUntil = now + pause * 1000;
      } else if (got.status === 401 || got.status === 403) {
        blockUntil = now + 60_000; // anahtar ya da bölge yanlış: her replikte yeniden sormanın yararı yok
      } else if (streak >= 3) {
        blockUntil = now + 10_000; // servis ya da ağ yok: kuyruk birikmesin
      }
      const hint = got.status === 401 || got.status === 403 ? ' (anahtar ya da bölge yanlış olabilir)' : got.status === 429 ? ' (hız sınırı)' : '';
      fail('azure: ' + (got.error || `HTTP ${got.status}${hint}`));
      return null;
    }
    streak = 0;
    const tmp = path.join(dir, `${job.key}.${process.pid}.tmp`);
    try {
      await fs.promises.writeFile(tmp, repairWav(got.audio));
    } catch (error) {
      fail('azure: dosya yazılamadı: ' + message(error));
      return null;
    }
    return adopt(job, tmp, 'azure');
  }

  // --- dışa açılan ---------------------------------------------------------------------------------------------------
  function turnOff(reason) {
    resolved = 'off';
    lastError = scrub(reason);
    say(lastError);
    retire(workers.pocket, 'ses kapalı'); retire(workers.local, 'ses kapalı');
    drain();
  }

  /**
   * Repliği seslendirir (önbellekten ya da üreterek). Süre dolarsa null döner ama üretim sürer; sonraki istekte hazırdır.
   * `priority` büyük olan sırada öne geçer. `signal` iptal edilirse çağıran hemen null alır; iş başlamamışsa ve başka
   * bekleyeni yoksa hiç üretilmez (süresi dolan replikler tazelerin önünde beklemez).
   * @param {string} text
   * @param {{emotion?:string, timeoutMs?:number, priority?:number, signal?:AbortSignal, onStart?:()=>void}} [options]
   *   onStart: üretim işçiye verildiğinde çağrılır; çağıran, yoldaki ses için biraz daha beklemeye değip değmeyeceğini bilir
   * @returns {Promise<{name:string, file:string, ms:number, provider:string, voice:string}|null>} asla reddetmez
   */
  function speak(text, options) {
    try {
      const { emotion = 'neutral', timeoutMs = 4000, priority, signal, onStart } = options || {};
      const limitMs = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 4000;
      const cancel = signal && typeof signal.addEventListener === 'function' ? signal : undefined;
      return within(request(text, emotion, true, { priority, signal: cancel, onStart }), limitMs).then((result) => (result === TIMEOUT ? null : result), () => null);
    } catch (error) {
      fail(error);
      return Promise.resolve(null);
    }
  }

  /**
   * Eksik replikleri arka planda, verilen sırayla tek tek üretir; speak() istekleri her zaman öne geçer.
   * @param {Array<string|{text:string, emotion?:string}>} texts
   * @param {{emotion?:string, signal?:AbortSignal}} [options] signal iptal edilirse kalan satırlar bırakılır
   * @returns {Promise<number>} iş bittiğinde önbellekte hazır olan replik sayısı (önceden var olanlar dahil)
   */
  async function warm(texts, options) {
    let ready = 0;
    try {
      const { emotion = 'neutral', signal } = options || {};
      const cancel = signal && typeof signal.addEventListener === 'function' ? signal : undefined;
      const list = Array.isArray(texts) ? texts : texts == null ? [] : [texts];
      for (const item of list) {
        if (closed || resolved === 'off' || cancel?.aborted) break;
        const text = item && typeof item === 'object' ? item.text : item;
        const emo = (item && typeof item === 'object' && item.emotion) || emotion;
        if (await request(text, emo, false, { signal: cancel })) ready++;
      }
    } catch (error) {
      fail(error);
    }
    return ready;
  }

  /**
   * `provider` seçilen sağlayıcı, `ready` onun hazır olup olmadığıdır. `active` ve `voice` yeni canlı repliklerin o an
   * gerçekten hangi sesle söylendiğini, `fallback` bunun yedek ses olduğunu, `reason` nedenini ve sıradaki denemeyi söyler.
   */
  function status() {
    const p = workers.pocket, l = workers.local, down = pocketDown();
    const active = down && canFallback() ? 'local' : resolved;
    const speaking = active === 'pocket' ? pocketVoice : active === 'azure' ? azureVoice : active === 'local' ? l.voice || localVoice || null : null;
    const retryInMs = down && p.restartTimer ? Math.max(0, p.retryAt - Date.now()) : null;
    let reason = null;
    if (down) {
      reason = (p.fails ? `Pocket çalışmıyor (${p.why || 'neden bilinmiyor'})` : 'Pocket hâlâ yükleniyor')
        + (active === 'local' ? '; Windows sesi konuşuyor' : '; yedek ses yok')
        + (retryInMs !== null ? `; ${seconds(retryInMs)} sonra yeniden denenecek` : '');
    }
    return {
      provider: resolved,
      active,
      voice: speaking,
      ready: resolved === 'azure' || Boolean(workers[resolved]?.ready),
      fallback: active !== resolved,
      reason,
      delivery,
      ...(resolved === 'pocket' ? { pocketVoice } : {}),
      ...(down ? { unavailable: true, retryInMs } : {}),
      cached: names.size,
      queued: hi.length + lo.length + running(),
      failures,
      lastError,
    };
  }

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(pumpTimer);
    pumpTimer = null;
    retire(workers.pocket, 'kapatıldı'); retire(workers.local, 'kapatıldı');
    for (const job of [...hi.splice(0), ...lo.splice(0)]) settle(job, null);
  }

  try {
    if (resolved !== 'off' && !dir) {
      resolved = 'off';
      lastError = 'önbellek klasörü verilmedi';
    } else if (resolved !== 'off') {
      prepareCache();
    }
  } catch (error) {
    resolved = 'off';
    lastError = scrub('önbellek klasörü kullanılamıyor: ' + message(error));
  }
  say(`sağlayıcı ${resolved}${resolved === 'azure' ? ` (${azureVoice})` : ''}${lastError ? ' · ' + lastError : ''}`);
  if (workers[resolved]) ensureWorker(workers[resolved]);

  return { get provider() { return resolved; }, speak, warm, status, close, sweep,
    setDelivery(value) { delivery = value === 'presenter' ? 'presenter' : 'natural'; },
    setPocketVoice(value) { if (POCKET_VOICES.includes(value)) pocketVoice = value; },
  };
}
