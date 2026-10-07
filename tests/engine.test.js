import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recommend, defaultSettings, validateBackup, makeCalendar } from '../src/engine.js';
const catalog=()=>JSON.parse(readFileSync(new URL('../public/data/catalog.json',import.meta.url)));
const settings=(patch={})=>({...structuredClone(defaultSettings),...patch});
const tx=(patch={})=>({amount:100,category:'other',merchant:'Example Shop',date:'2026-10-06',foreign:false,...patch});
const rows=(t={},s={},o=[])=>recommend(tx(t),settings(s),o,catalog());
const card=(id,t={},s={},o=[])=>rows(t,s,o).find(x=>x.cardId===id);
const offer=(patch={})=>({id:'a',cardId:'ventureone',title:'Example offer',merchant:'Example Shop',category:'',type:'percent',value:10,minSpend:50,cap:8,starts:'2026-10-01',expires:'2026-10-31',activated:true,used:false,...patch});

test('ordinary domestic spending prefers Freedom at equal point values',()=>{
 assert.equal(rows()[0].cardId,'freedom');assert.equal(rows()[0].total,1.5);
});
test('foreign fee deducted and can reverse the recommendation',()=>{
 assert.equal(card('freedom',{foreign:true}).total,-1.5);
 assert.notEqual(rows({foreign:true})[0].cardId,'freedom');
});
test('point value changes recommendation',()=>{
 assert.equal(rows({}, {pointValues:{chase:1,bilt:2,capitalone:1,cash:1}})[0].cardId,'obsidian');
});
test('activated capped merchant offer beats base reward',()=>{
 assert.equal(rows({}, {}, [offer()])[0].cardId,'ventureone');
 assert.equal(card('ventureone',{}, {},[offer()]).offerValue,8);
});
test('pending, expired, future, used, sample, minimum and mismatched offers excluded',()=>{
 for(const patch of [{activated:false},{expires:'2026-10-05'},{starts:'2026-10-07'}, {used:true},{demo:true},{minSpend:101},{merchant:'Different Shop'},{category:'dining'}]) {
  assert.equal(card('ventureone',{}, {},[offer(patch)]).offerValue,0,JSON.stringify(patch));
 }
});
test('offer expiry inclusive, no unverified stacking',()=>{
 assert.equal(card('ventureone',{date:'2026-10-31'}, {},[offer(),offer({id:'b',type:'fixed',value:15,cap:null})]).offerValue,15);
});
test('Bilt grocery crossing annual cap and nonselected category',()=>{
 assert.equal(card('obsidian',{category:'grocery'}).baseValue,1);
 assert.equal(card('obsidian',{category:'grocery'}, {biltCategory:'grocery',biltGrocerySpent:24950,biltGroceryYear:2026}).baseValue,2);
 assert.equal(card('obsidian',{category:'dining'}, {biltCategory:'grocery'}).baseValue,1);
});
test('Bilt Cash is zero by default and only valued in flexible mode',()=>{
 assert.equal(card('obsidian').baseValue,1);
 assert.equal(card('obsidian',{}, {biltMode:'housing',biltCashValue:1}).baseValue,1);
 assert.equal(card('obsidian',{}, {biltMode:'cash',biltCashValue:.5}).baseValue,3);
});
test('Bilt Rent Day capped and confirmed, portal member bonuses not doubled',()=>{
 assert.equal(card('obsidian',{date:'2026-11-01',category:'dining'}, {biltRentDayEnabled:true,biltRentDayMonth:'2026-11',biltRentDayBonusUsed:900}).baseValue,4);
 assert.equal(card('obsidian',{date:'2026-11-01',category:'dining'}).baseValue,3);
 assert.equal(card('obsidian',{date:'2026-11-01',category:'biltHotel'}, {biltRentDayEnabled:true,biltRentDayMonth:'2026-11'}).baseValue,4);
});
test('invalid amounts and dates produce no misleading recommendation',()=>{
 for(const amount of [-1,0,NaN,Infinity]) assert.deepEqual(rows({amount}),[]);
 assert.deepEqual(rows({date:'2026-02-30'}),[]);
 assert.deepEqual(rows({}, {enabledCards:[]}),[]);
});
test('known superstores conservatively excluded from grocery bonuses',()=>{
 assert.equal(card('savor',{category:'grocery',merchant:'Walmart'}).rate,1);
});
test('backup validates known cards, dates, values and URL protocols',()=>{
 const p={version:1,settings:settings(),offers:[offer()]};
 assert.equal(validateBackup(p).offers.length,1);
 for(const patch of [{value:-1},{expires:'2026-02-30'},{cardId:'evil'},{url:'javascript:alert(1)'},{merchant:''}]) assert.throws(()=>validateBackup({...p,offers:[offer(patch)]}));
});
test('calendar carries one day reminder, exclusive end and no injected property',()=>{
 const ics=makeCalendar(offer({title:'hello\nATTENDEE:evil'}));
 assert.match(ics,/DTEND;VALUE=DATE:20261101/);assert.match(ics,/TRIGGER:-P1D/);
 assert.doesNotMatch(ics,/\r\nATTENDEE:/);
});

test('merchant matching excludes substrings inside unrelated brands and allows descriptors',()=>{
 const shell=offer({merchant:'Shell'});
 assert.equal(card('ventureone',{merchant:'Seashell Restaurant'}, {},[shell]).offerValue,0);
 assert.equal(card('ventureone',{merchant:'SHELL #1234'}, {},[shell]).offerValue,8);
 assert.equal(card('ventureone',{merchant:'ＣＯＳＴＣＯ.com'}, {},[offer({merchant:'Costco'})]).offerValue,8);
 assert.equal(card('ventureone',{merchant:'星巴克上海门店'}, {},[offer({merchant:'星巴克'})]).offerValue,8);
});
test('offers require actual activation and unused booleans',()=>{
 for(const patch of [{activated:'false'},{activated:1},{used:'false'},{used:undefined}]) {
  assert.equal(card('ventureone',{}, {},[offer(patch)]).offerValue,0);
 }
});
test('Rent Day confirmation is tied to one month and the verified promotion period',()=>{
 const enabled={biltRentDayEnabled:true,biltRentDayBonusUsed:0};
 assert.equal(card('obsidian',{date:'2026-11-01',category:'dining'},enabled).baseValue,3);
 assert.equal(card('obsidian',{date:'2026-11-01',category:'dining'},{...enabled,biltRentDayMonth:'2026-10'}).baseValue,3);
 assert.equal(card('obsidian',{date:'2027-01-01',category:'dining'},{...enabled,biltRentDayMonth:'2027-01'}).baseValue,6);
 assert.equal(card('obsidian',{date:'2027-02-01',category:'dining'},{...enabled,biltRentDayMonth:'2027-02'}).baseValue,3);
 assert.equal(card('obsidian',{amount:1000,date:'2026-11-01',category:'dining'},{...enabled,biltRentDayMonth:'2026-11'}).baseValue,40);
});
test('Bilt grocery annual cap resets by the transaction year and carries into Rent Day math',()=>{
 const grocery={biltCategory:'grocery',biltGrocerySpent:25000,biltGroceryYear:2026};
 assert.equal(card('obsidian',{date:'2027-01-03',category:'grocery'},grocery).baseValue,3);
 assert.equal(card('obsidian',{date:'2026-11-01',category:'grocery'},{...grocery,biltRentDayEnabled:true,biltRentDayMonth:'2026-11'}).baseValue,2);
});
test('malformed settings and transaction containers fail closed without throwing',()=>{
 for(const value of [null,[],{enabledCards:null},{enabledCards:'sapphire'},{pointValues:null},{biltRentDayEnabled:'false'},{biltRentDayBonusUsed:-100},{biltRentDayBonusUsed:1001},{biltGroceryYear:'2026'}]) {
  assert.deepEqual(recommend(tx(),value,[],catalog()),[]);
 }
 assert.deepEqual(recommend(null,settings(),[],catalog()),[]);
 assert.deepEqual(recommend(tx(),settings(),null,catalog()),rows());
});
test('backup validates monthly caps, month and year, and removes unrecognized settings',()=>{
 const backup={version:1,settings:settings(),offers:[offer()]};
 for(const patch of [{biltRentDayEnabled:'false'},{biltRentDayBonusUsed:-1},{biltRentDayBonusUsed:1001},{biltRentDayMonth:'2026-13'},{biltGroceryYear:2026.5}]) {
  assert.throws(()=>validateBackup({...backup,settings:settings(patch)}));
 }
 const imported=JSON.parse(JSON.stringify(backup));
 imported.settings=JSON.parse('{"__proto__":{"injected":true},"unknown":"discard"}');
 Object.assign(imported.settings,settings());
 imported.settings.pointValues.unknown=9;
 const clean=validateBackup(imported);
 assert.equal(Object.hasOwn(clean.settings,'__proto__'),false);
 assert.equal(Object.hasOwn(clean.settings,'unknown'),false);
 assert.equal(Object.hasOwn(clean.settings.pointValues,'unknown'),false);
 delete backup.settings.biltRentDayMonth;
 assert.equal(validateBackup(backup).settings.biltRentDayMonth,'');
});
test('backup rejects malformed HTTPS links and empty or repeated offer identifiers',()=>{
 const backup={version:1,settings:settings(),offers:[]};
 for(const patch of [{url:'https://'},{url:'https://user:password@example.com/'},{url:'https://example.com/\nATTENDEE:evil'},{id:''}]) {
  assert.throws(()=>validateBackup({...backup,offers:[offer(patch)]}));
 }
 assert.throws(()=>validateBackup({...backup,offers:[offer(),offer()]}));
});
test('invalid dated rate cannot create a bonus and expired rules use their ordinary fallback',()=>{
 const bad=catalog();bad.cards[0].rates.unshift({category:'other',multiplier:99,expires:'not-a-date'});
 assert.equal(recommend(tx(),settings(),[],bad).find(x=>x.cardId==='sapphire').rate,1);
 assert.equal(card('sapphire',{category:'lyft',date:'2027-10-01'}).rate,2);
 assert.equal(card('freedom',{category:'lyft',date:'2027-10-01'}).rate,1.5);
});
test('calendar removes standalone carriage-return injection and folds Unicode safely',()=>{
 const ics=makeCalendar(offer({title:'日历'.repeat(40)+'\rATTENDEE:evil'}));
 assert.equal(ics.replaceAll('\r\n','').includes('\r'),false);
 assert.doesNotMatch(ics,/\r\nATTENDEE:/);
 assert.ok(ics.split('\r\n').every(line=>new TextEncoder().encode(line).length<=75));
 assert.ok(!ics.includes('\uFFFD'));
});
