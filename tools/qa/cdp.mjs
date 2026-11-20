// Başsız tarayıcıyı (CDP) süren küçük yardımcı: sahneyi açar, JS çalıştırır, ekran görüntüsü alır.
// Kullanım: node cdp.mjs [nav <url>] [wait <ms>] [eval <js>] [shot <dosya> [ölçek]] [clip <dosya> x y w h [ölçek]] ...
import fs from 'node:fs';
const PORT = process.env.CDP_PORT || 9333;
const args = process.argv.slice(2);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('sayfa hedefi yok');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const waiting = new Map(), problems = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { const { res, rej } = waiting.get(m.id); waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') problems.push('HATA: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400));
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) problems.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push('log: ' + m.params.entry.text.slice(0, 300) + ' ' + (m.params.entry.url || ''));
};
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === 'nav') { await send('Page.navigate', { url: args[++i] }); await sleep(400); }
  else if (a === 'wait') await sleep(Number(args[++i]));
  else if (a === 'eval') {
    const r = await send('Runtime.evaluate', { expression: args[++i], awaitPromise: true, returnByValue: true, userGesture: true });
    console.log(r.exceptionDetails ? 'EVAL HATASI: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) : typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value));
  } else if (a === 'shot' || a === 'clip') {
    const file = args[++i]; let clip = { x: 0, y: 0, width: 1080, height: 1920, scale: 0.5 };
    if (a === 'clip') { clip = { x: Number(args[++i]), y: Number(args[++i]), width: Number(args[++i]), height: Number(args[++i]), scale: 1 }; }
    if (args[i + 1] && /^[0-9.]+$/.test(args[i + 1])) clip.scale = Number(args[++i]);
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82, clip, captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64')); console.log('görüntü: ' + file);
  } else if (a === 'click') { const x = Number(args[++i]), y = Number(args[++i]); for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); }
}
if (problems.length) console.log('--- konsol sorunları (' + problems.length + '):\n' + [...new Set(problems)].slice(0, 12).join('\n'));
ws.close();
