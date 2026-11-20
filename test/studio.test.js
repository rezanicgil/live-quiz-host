import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createEngine } from '../server/engine.js';
import { createHost } from '../server/host.js';
import { createPicker, loadBank } from '../server/questions.js';
import { titleFor } from '../server/players.js';
const data = new URL('../server/data/', import.meta.url);

test('final foto-finişi sayar, sonuç ekranı sabit ve tekrar bitirilebilir', () => {
  const question = { answer:'ÇAY', clue:'Demlenir', say:'Demlenir', type:'kelime', accept:[] };
  const e = createEngine({ picker: { next: () => question }, config:{ lobbySeconds:1, introSeconds:1 } });
  e.tick(0); e.tick(1); e.tick(1);
  e.chat({ user:{ id:'ay', nick:'Ayşe' }, text:'çay' });
  e.command({type:'finish'});
  const s = e.snapshot();
  assert.equal(s.phase,'ended'); assert.equal(s.q,null);
  assert.equal(s.finalists[0].nick,'Ayşe'); assert.equal(s.night.solved,1);
  for (const cmd of [{type:'finish'},{type:'pause'},{type:'skip'}]) e.command(cmd);
  e.tick(500); assert.deepEqual(e.snapshot(),s);
  assert.equal(e.verdict('çay'),null);
});

test('mola destesi tükenmeden aynı soru gelmez, yeni deste peş peşe aynı başlamaz', async () => {
  let clock=0; const seen=[];
  const lines = JSON.parse(fs.readFileSync(new URL('replikler.json',data))).olaylar;
  const host=createHost({lines, now:()=>clock, rng:()=>0, emit:()=>{}, tts:{provider:'off', speak:async()=>null}});
  for(let i=0;i<=lines.molaSoru.length;i++){
    host.onFx([{type:'breakStart'}],{phase:'break'}); await host.idle();
    clock+=4; host.tick({phase:'break'}); await host.idle(); seen.push(host.asked());
    clock+=90; host.onFx([{type:'roundStart',round:1}],{phase:'intro'}); host.tick({phase:'intro'}); await host.idle();
  }
  assert.ok(lines.molaSoru.length>=36); assert.ok(seen.every(Boolean));
  assert.equal(new Set(seen.slice(0,-1)).size,lines.molaSoru.length); assert.notEqual(seen.at(-1),seen.at(-2));
});

test('emoji sahnesi söylenen soruyu gösterir ve bütün yeni kategoriler seçilebilir',()=>{
  const {items,errors}=loadBank(new URL('sorular.json',data)); assert.deepEqual(errors,[]);
  const emojis=items.filter(q=>q.type==='emoji'); assert.equal(emojis.length,100);
  for(const q of emojis){
    const p=createPicker({items:[q]}).next(9);
    assert.ok(p.emoji); assert.equal(p.say,p.clue); assert.ok(p.clue.includes('?'));
  }
  for(const cat of ['uzay','icat','sanat','dil']) assert.ok(items.filter(q=>q.category===cat).length>=6);
  assert.notEqual(titleFor(5),'Bilgin');
});
