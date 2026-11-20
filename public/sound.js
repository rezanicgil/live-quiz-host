// Sahne sesi: tek AudioContext; üç yol (voice / music / fx) `state.settings.volumes` değerlerini izler.
//   createSound() → {
//     state            'running' | 'suspended' | 'closed' | 'none'
//     unlock()         tarayıcı sesi askıya aldıysa kullanıcı dokunuşuyla açar
//     onState(cb)      durum değişince cb(state)
//     setVolumes({voice,music,fx})
//     say({url,ms,text,voiceEnabled}) → { level():0..1, done:Promise, stop() }
//     stopVoice()
//     level()          o anki konuşma düzeyi (dudak eşlemesi)
//     play(name, opts) kodla üretilen efekt; 'drum' için durdurma işlevi döner
//     catCall()        kodla üretilen tek miyav (en çok 10 saniyede bir)
//     music(on)        hafif fon döngüsü; konuşma sırasında yaklaşık üçte bire kısılır
//   }
// Efektler: tick flip pop near ding applause olmadi whoosh drum fanfare cheer intro levelup record chip heart drop shine
// Oyun efektleri yerel olarak üretilir. Konuşma sunucunun hazırladığı WAV kaydını çalar; kayıt yoksa ya da çalınamazsa
// replik süresince Tarçın miyavlar: kodla üretilen kısa "miyav" ve "mırr" sesleri (ağız bu seslerle oynar).

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const midi = (n) => 440 * 2 ** ((n - 69) / 12);
const LIMIT = { pop: 90, tick: 60, flip: 45, chip: 220, heart: 130, near: 300, drop: 40,
  applause: 900, cheer: 1100, fanfare: 1000, ding: 320, levelup: 350, record: 450 };

export function createSound() {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  try { ctx = AC ? new AC({ latencyHint: 'playback' }) : null; } catch { ctx = null; }
  const vol = { voice: 1, music: 0.25, fx: 0.8 };
  let murmurStyle = 'miyav';   // ses kaydı yokken: 'miyav' | 'bip' | 'off' (panelden seçilir)
  const listeners = new Set();
  const lastPlayed = {};
  let current = null, musicOn = false, musicTimer = 0, nextStep = 0, step = 0;
  let master, voiceBus, musicBus, fxBus, fxDuck, voiceIn, analyser, duck, pluck, noiseBuf, wave;

  if (ctx) {
    master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.22;
    master.connect(comp); comp.connect(ctx.destination);
    voiceBus = ctx.createGain(); musicBus = ctx.createGain(); fxBus = ctx.createGain();
    voiceBus.gain.value = vol.voice; musicBus.gain.value = vol.music; fxBus.gain.value = vol.fx;
    fxDuck = ctx.createGain(); fxBus.connect(fxDuck); fxDuck.connect(master);
    voiceBus.connect(master); musicBus.connect(master);
    voiceIn = ctx.createGain(); analyser = ctx.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.2;
    voiceIn.connect(analyser); voiceIn.connect(voiceBus);
    duck = ctx.createGain(); duck.connect(musicBus);
    pluck = ctx.createBiquadFilter(); pluck.type = 'lowpass'; pluck.frequency.value = 1150; pluck.Q.value = 0.65; pluck.connect(duck);
    wave = new Float32Array(analyser.fftSize);
    const sr = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, sr * 2, sr);
    const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    ctx.onstatechange = () => { for (const cb of listeners) cb(ctx.state); if (ctx.state === 'running' && musicOn) startMusic(); };
    const auto = () => { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); };
    window.addEventListener('pointerdown', auto); window.addEventListener('keydown', auto);
  }
  const running = () => !!ctx && ctx.state === 'running';

  /* ---------- yapı taşları ---------- */
  function tone(dest, { type = 'sine', f, f2 = null, t = 0, dur = 0.2, peak = 0.2, a = 0.006, curve = 'exp', glide = null }) {
    const t0 = ctx.currentTime + t, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + (glide ?? dur));
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + a);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); else { g.gain.setValueAtTime(peak, t0 + dur * 0.7); g.gain.linearRampToValueAtTime(0.0001, t0 + dur); }
    o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.03);
    return o;
  }
  function noise(dest, { t = 0, dur = 0.2, peak = 0.2, a = 0.004, type = 'bandpass', f = 1500, f2 = null, q = 1, buffer = null, curve = 'exp' }) {
    const t0 = ctx.currentTime + t, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = buffer || noiseBuf; if (!buffer) { s.loop = true; }
    fl.type = type; fl.frequency.setValueAtTime(f, t0); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + a);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); else { g.gain.setValueAtTime(peak, t0 + dur * 0.75); g.gain.linearRampToValueAtTime(0.0001, t0 + dur); }
    s.connect(fl); fl.connect(g); g.connect(dest);
    s.start(t0, buffer ? 0 : Math.random() * 1.5); s.stop(t0 + dur + 0.03);
    return s;
  }
  function chime(f, t, peak = 0.15, dur = 0.5) {
    tone(fxBus, { f, t, dur, peak, a: 0.018 });
    tone(fxBus, { f: f * 2, t, dur: dur * 0.52, peak: peak * 0.16, a: 0.016 });
  }
  function celebrationBeat(peak = 0.12) {
    for (const [t, f, v] of [[0, 220, 1], [0.16, 330, 0.64], [0.32, 220, 0.82], [0.62, 392, 0.72]]) {
      tone(fxBus, { f, f2: f * 0.8, t, dur: 0.15, a: 0.012, peak: peak * v });
    }
  }

  /* ---------- efektler ---------- */
  const FX = {
    tick() { tone(fxBus, { f: 392, dur: 0.16, peak: 0.08, a: 0.018 }); },
    flip() { tone(fxBus, { f: 660, f2: 880, dur: 0.09, peak: 0.14 }); tone(fxBus, { f: 1320, t: 0.05, dur: 0.1, peak: 0.035 }); },
    drop() { tone(fxBus, { f: 210, f2: 95, dur: 0.09, peak: 0.2 }); noise(fxBus, { dur: 0.03, peak: 0.05, f: 900, q: 0.8 }); },
    pop() { tone(fxBus, { f: 560, f2: 260, dur: 0.08, peak: 0.24 }); },
    near() { tone(fxBus, { type: 'triangle', f: 784, dur: 0.1, peak: 0.16 }); tone(fxBus, { type: 'triangle', f: 988, t: 0.09, dur: 0.16, peak: 0.16 }); },
    chip() { tone(fxBus, { f: 988, dur: 0.1, peak: 0.1 }); tone(fxBus, { f: 1319, t: 0.07, dur: 0.14, peak: 0.08 }); },
    heart() { tone(fxBus, { f: rnd(1150, 1500), f2: 900, dur: 0.07, peak: 0.06 }); },
    whoosh() { noise(fxBus, { dur: 0.45, peak: 0.24, a: 0.16, f: 380, f2: 2800, q: 1.1 }); },
    ding() {
      [523.3, 659.3, 784].forEach((f, i) => chime(f, i * 0.085, 0.17, i === 2 ? 0.68 : 0.28));
    },
    applause() { celebrationBeat(); },
    olmadi() {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300; lp.connect(fxBus);
      tone(lp, { type: 'triangle', f: 392, dur: 0.26, peak: 0.2, curve: 'lin' });
      tone(lp, { type: 'triangle', f: 349.2, t: 0.24, dur: 0.26, peak: 0.2, curve: 'lin' });
      tone(lp, { type: 'triangle', f: 293.7, f2: 270, t: 0.48, dur: 0.6, peak: 0.2, curve: 'lin', glide: 0.6 });
      tone(lp, { f: 146.8, t: 0.48, dur: 0.6, peak: 0.12, curve: 'lin' });
    },
    intro() {
      [659.3, 784, 1046.5, 1318.5].forEach((f, i) => { tone(fxBus, { type: 'triangle', f, t: i * 0.11, dur: 0.3, peak: 0.17 }); tone(fxBus, { f: f * 2, t: i * 0.11, dur: 0.18, peak: 0.05 }); });
      noise(fxBus, { t: 0.05, dur: 0.4, peak: 0.07, a: 0.2, f: 600, f2: 3200, q: 1 });
    },
    fanfare() {
      [392, 523.3, 659.3, 784].forEach((f, i) => chime(f, i * 0.14, 0.17, 0.42));
      [261.6, 392, 523.3, 659.3].forEach((f, i) => chime(f, 0.75 + i * 0.027, 0.09, 0.83));
    },
    cheer() {
      celebrationBeat();
      [392, 493.9, 587.3, 784].forEach((f, i) => chime(f, i * 0.16, 0.14, 0.55));
    },
    levelup() { [523.3, 659.3, 784, 1046.5].forEach((f, i) => chime(f, i * 0.09, 0.13, 0.5)); },
    record() { [392, 523.3, 659.3, 784, 1046.5].forEach((f, i) => chime(f, i * 0.095, 0.14, 0.62)); },
    shine() { [587.3, 740, 880, 1174.7].forEach((f, i) => chime(f, i * 0.075, 0.08, 0.47)); },
    /** Son saniyeler için sabit, hafif vuruş. Cevap gelince durdurulabilir. */
    drum({ dur = 5 } = {}) {
      const out = ctx.createGain(); out.connect(fxBus);
      let last;
      for (let t = 0; t < dur; t += 1) {
        last = tone(out, { f: 196, f2: 174.6, t, dur: 0.21, peak: 0.10, a: 0.025 });
      }
      if (last) last.onended = () => out.disconnect();
      return () => {
        out.gain.setTargetAtTime(0, ctx.currentTime, 0.012);
      };
    },
  };

  /* ---------- kedi sesi ---------- */
  /** Kısa kedi sesi: f0 → f1 → f2 kayan üçgen dalga. */
  function mew(t, f0, f1, f2, dur = 0.3, peak = 0.16) {
    const t0 = ctx.currentTime + t, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = 'triangle'; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.3); o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 2;
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + 0.03); g.gain.setValueAtTime(peak, t0 + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(lp); lp.connect(g); g.connect(fxBus); o.start(t0); o.stop(t0 + dur + 0.03);
  }
  let nextCat = 0;
  /** Tarçın'ın miyavı (panel düğmesi, final ekranı): en çok 10 saniyede bir. */
  function catCall() {
    if (!running() || !vol.fx || performance.now() < nextCat) return;
    nextCat = performance.now() + 10000;
    mew(0, 620, 900, 560, 0.45, 0.2);
  }

  function play(name, opts) {
    if (!running() || !FX[name] || vol.fx === 0) return null;
    const gap = LIMIT[name], now = performance.now();
    if (gap && now - (lastPlayed[name] ?? -Infinity) < gap) return null;
    lastPlayed[name] = now;
    try { return FX[name](opts) || null; } catch (e) { console.error('Efekt çalınamadı: ' + name, e); return null; }
  }

  /* ---------- fon döngüsü ---------- */
  // 4/4, 68 BPM. Bas ilk vuruşta, melodi yalnız birinci ve üçüncü vuruşlarda.
  const CHORDS = [[48, 64, 67], [53, 65, 69], [45, 64, 67], [43, 62, 67]];
  const BEAT = 60 / 68;
  const STEP = 2 * BEAT;
  function scheduleStep(i, t) {
    if (vol.music === 0) return;
    const [bass, first, third] = CHORDS[Math.floor(i / 2) % CHORDS.length];
    const downbeat = i % 2 === 0;
    const at = t - ctx.currentTime;
    if (downbeat) tone(pluck, { f: midi(bass), t: at, dur: 3 * BEAT, peak: 0.16, a: 0.09 });
    tone(pluck, { type: 'triangle', f: midi(downbeat ? first : third), t: at, dur: 2 * BEAT, peak: downbeat ? 0.18 : 0.14, a: 0.055 });
  }
  function pump() {
    if (!running() || !musicOn) return;
    if (nextStep < ctx.currentTime + 0.02) nextStep = ctx.currentTime + 0.06;
    while (nextStep < ctx.currentTime + 1.2) { scheduleStep(step++, nextStep); nextStep += STEP; }
  }
  function startMusic() { if (musicTimer || !ctx) return; pump(); musicTimer = setInterval(pump, 200); }
  function setDuck(on) {
    if (!ctx) return;
    const t = ctx.currentTime; duck.gain.cancelScheduledValues(t); duck.gain.setTargetAtTime(on ? 0.33 : 1, t, on ? 0.06 : 0.28);
    fxDuck.gain.setTargetAtTime(on ? 0.35 : 1, t, on ? 0.025 : 0.18);
  }

  /* ---------- konuşma ---------- */
  const synth = window.speechSynthesis;
  synth?.getVoices(); // Chromium ilk çağrıda kurulu sesleri asenkron yükler.
  function say({ url = null, ms = 2000, text = '', voiceEnabled = true, allowSystemVoice = false } = {}) {
    if (current) current.stop();
    const started = performance.now(), duration = Math.max(300, Number(ms) || 2000);
    let endAt = started + duration, finished = false, real = false, resolve, timer = 0, source = null, utterance = null;
    const done = new Promise((r) => { resolve = r; });
    const out = running() ? ctx.createGain() : null;
    if (out) out.connect(voiceIn);
    const handle = {
      done,
      get usesSystemVoice() { return !!utterance; },
      level() {
        if (finished) return 0;
        const now = performance.now();
        if (real && running()) {
          analyser.getFloatTimeDomainData(wave);
          let sum = 0; for (let i = 0; i < wave.length; i++) sum += wave[i] * wave[i];
          return clamp(Math.sqrt(sum / wave.length) * 5.5);
        }
        if (now > endAt) return 0;
        const t = (now - started) / 1000;
        if (Math.sin(t * 1.9 + 0.6) > 0.93) return 0.05;
        return clamp(Math.abs(Math.sin(t * 13.5)) * (0.6 + 0.4 * Math.sin(t * 3.3 + 1)));
      },
      stop() {
        if (finished) return;
        if (out) {
          const t = ctx.currentTime;
          if (out.gain.cancelAndHoldAtTime) out.gain.cancelAndHoldAtTime(t);
          else { const gain = out.gain.value; out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(gain, t); }
          out.gain.linearRampToValueAtTime(0, t + 0.025);
          if (source) { try { source.stop(t + 0.03); } catch { /* zaten durdu */ } }
          setTimeout(() => out.disconnect(), 100);
        }
        finish();
      },
    };
    function finish() {
      if (finished) return; finished = true; clearTimeout(timer);
      if (utterance) { utterance.onend = utterance.onerror = null; utterance = null; synth.cancel(); }
      if (current === handle) { current = null; setDuck(false); }
      resolve();
    }
    const endIn = (wait) => { clearTimeout(timer); endAt = performance.now() + wait; timer = setTimeout(() => { if (out) setTimeout(() => out.disconnect(), 300); finish(); }, wait); };
    current = handle; setDuck(true);
    /** Kayıt yokken: metnin ritmine uyan miyavlar (iki kelimeye bir "miyav"; noktalamada es, soruda tizleşir). */
    function murmur(ms) {
      if (!out || !vol.voice) return;
      const total = ms / 1000 - 0.1; if (total < 0.2) return;
      if (murmurStyle === 'off') { real = true; return; }
      if (murmurStyle === 'bip') {   // eski biçim: sesli harf başına kısa bir bip; boşlukta ve noktalamada es
        const TONE = { a: 0, e: 3, 'ı': -2, i: 5, o: -3, 'ö': 2, u: -5, 'ü': 4 }, steps = [];
        for (const ch of String(text || '').toLocaleLowerCase('tr-TR')) {
          if (ch in TONE) steps.push([1, TONE[ch]]);
          else if (ch === ' ') steps.push([0.45, null]);
          else if (/[,;:]/.test(ch)) steps.push([1.3, null]);
          else if (/[.!?…]/.test(ch)) steps.push([2.2, null]);
          else steps.push([0.3, null]);
        }
        if (!steps.some((x) => x[1] !== null)) for (let k = 0; k < 14; k++) steps.push([1, [0, 3, -2, 5][k % 4]], [0.4, null]);
        const sum = steps.reduce((acc, x) => acc + x[0], 0), unit = clamp(total / sum, 0.07, 0.115);
        let tb = ctx.currentTime + 0.04; const endB = tb + total;
        for (let k = 0; tb < endB - 0.06; k++) {
          const [len, note] = steps[k % steps.length];
          if (note !== null) {
            const o = ctx.createOscillator(), g = ctx.createGain(), f = 500 * 2 ** ((note + rnd(-0.6, 0.6)) / 12), d = Math.min(0.1, unit * 0.9);
            o.type = 'triangle'; o.frequency.setValueAtTime(f * 0.94, tb); o.frequency.linearRampToValueAtTime(f * 1.05, tb + d * 0.35); o.frequency.linearRampToValueAtTime(f * 0.97, tb + d);
            g.gain.setValueAtTime(0.0001, tb); g.gain.linearRampToValueAtTime(0.2, tb + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, tb + d);
            o.connect(g); g.connect(out); o.start(tb); o.stop(tb + d + 0.02);
          }
          tb += len * unit;
        }
        real = true; return;
      }
      // Kelimeler ikişer ikişer birer "miyav" olur: uzun söz uzun miyav, soru sonunda tizleşir, arada kısa bir "mırr" tril.
      const words = String(text || '').split(/\s+/).filter(Boolean), plan = [];
      for (let w = 0; w < words.length; w += 2) {
        const chunk = words.slice(w, w + 2).join(' ');
        plan.push({ len: clamp(0.26 + [...chunk].length * 0.018, 0.3, 0.55), pause: /[.!?…]$/.test(chunk) ? 0.32 : /[,;:]$/.test(chunk) ? 0.22 : 0.14, ask: /\?$/.test(chunk) });
      }
      if (!plan.length) for (let k = 0; k < 4; k++) plan.push({ len: 0.4, pause: 0.2, ask: false });
      let t = ctx.currentTime + 0.04; const end = t + total;
      for (let i = 0; t < end - 0.2; i++) {
        const p = plan[i % plan.length], trill = i % 3 === 2, d = Math.min(trill ? 0.3 : p.len, end - t - 0.04), f0 = (trill ? 330 : 560) * 2 ** (rnd(-2.5, 2.5) / 12);
        const o = ctx.createOscillator(), g = ctx.createGain(), f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
        o.type = 'sawtooth';
        if (trill) { o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * 1.35, t + d); }
        else { o.frequency.setValueAtTime(f0 * 0.82, t); o.frequency.linearRampToValueAtTime(f0 * 1.32, t + d * 0.32); o.frequency.linearRampToValueAtTime(f0 * (p.ask ? 1.45 : 0.78), t + d); }
        // "mi-ya-v": ağız kapalıdan açığa, sonra yuvarlağa; iki süzgeç i → a → u seslerinin arasında kayar
        f1.type = 'bandpass'; f1.Q.value = 5; f1.frequency.setValueAtTime(420, t); f1.frequency.linearRampToValueAtTime(trill ? 600 : 980, t + d * 0.45); f1.frequency.linearRampToValueAtTime(480, t + d);
        f2.type = 'bandpass'; f2.Q.value = 7; f2.frequency.setValueAtTime(2400, t); f2.frequency.linearRampToValueAtTime(1500, t + d * 0.5); f2.frequency.linearRampToValueAtTime(950, t + d);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.55, t + Math.min(0.05, d * 0.25)); g.gain.setValueAtTime(0.55, t + d * 0.55); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        if (trill) { const lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.frequency.value = 27; depth.gain.value = 0.3; lfo.connect(depth); depth.connect(g.gain); lfo.start(t); lfo.stop(t + d + 0.03); }
        o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.03);
        t += d + p.pause;
      }
      real = true;
    }
    function readText() {
      if (finished) return;
      const left = Math.max(200, started + duration - performance.now());
      endIn(left);
      if (!allowSystemVoice || !voiceEnabled || !text || !vol.voice || (ctx && !running()) || !window.SpeechSynthesisUtterance) { murmur(left); return; }
      const voice = synth?.getVoices().find(v => v.localService && /^tr(?:-|_|$)/i.test(v.lang));
      if (!voice) { murmur(left); return; }
      utterance = new window.SpeechSynthesisUtterance(text);
      utterance.voice = voice; utterance.lang = voice.lang; utterance.volume = clamp(vol.voice);
      utterance.onend = utterance.onerror = () => { utterance = null; if (!finished) endIn(0); };
      endIn(Math.max(duration + 2500, text.length * 110 + 1500));
      try { synth.speak(utterance); } catch { utterance = null; endIn(0); }
    }
    if (voiceEnabled && url && out) {
      endIn(duration + 4000);   // yüklenemezse sonsuza dek beklemesin
      fetch(url).then((r) => { if (!r.ok) throw new Error('ses ' + r.status); return r.arrayBuffer(); }).then((b) => ctx.decodeAudioData(b)).then((buffer) => {
        if (finished) return;
        const start = ctx.currentTime + 0.012, end = start + buffer.duration;
        const edge = Math.min(0.009, buffer.duration / 3);
        out.gain.setValueAtTime(0, start);
        out.gain.linearRampToValueAtTime(1, start + edge);
        out.gain.setValueAtTime(1, end - edge);
        out.gain.linearRampToValueAtTime(0, end);
        source = ctx.createBufferSource(); source.buffer = buffer; source.connect(out); source.start(start); real = true;
        endIn(buffer.duration * 1000 + 80);
      }).catch(readText);
    } else readText();
    return handle;
  }

  return {
    get state() { return ctx ? ctx.state : 'none'; },
    get volumes() { return { ...vol }; },
    unlock() { return ctx ? ctx.resume().catch(() => {}) : Promise.resolve(); },
    onState(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    setMurmur(style) { if (['miyav', 'bip', 'off'].includes(style)) murmurStyle = style; },
    setVolumes(v) {
      if (!v) return;
      for (const [key, bus] of [['voice', voiceBus], ['music', musicBus], ['fx', fxBus]]) {
        const next = clamp(Number(v[key]), 0, 1.5);
        if (Number.isFinite(next) && Math.abs(next - vol[key]) > 0.001) { vol[key] = next; bus?.gain.setTargetAtTime(next, ctx.currentTime, 0.08); }
        if (key === 'voice' && !vol.voice && current?.usesSystemVoice) current.stop();
      }
    },
    catCall, say,
    stopVoice() { if (current) current.stop(); },
    level() { return current ? current.level() : 0; },
    play,
    music(on) {
      musicOn = !!on;
      if (musicOn) startMusic(); else { clearInterval(musicTimer); musicTimer = 0; }
    },
  };
}
