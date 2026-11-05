const {readFileSync}=require('node:fs');
const {runInNewContext}=require('node:vm');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const script=readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
// Lightweight DOM for calculation/storage checks. Real browser QA is separate.
class Element {
  constructor(){this.value='';this.textContent='';this.children=[];this.events={};this.hidden=true;}
  get value(){return this._value;}
  set value(value){this._value=String(value);}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  setAttribute(){}
  addEventListener(event,handler){this.events[event]=handler;}
}
function app(raw=null,storageFails=false){
  const elements=Object.fromEntries(['wage','allowance','transport','shifts','status','recover','total','hoursTotal','base','allowanceOut','transportOut','add','calculate'].map(id=>[id,new Element()]));
  Object.assign(elements.wage,{value:'1200'});Object.assign(elements.allowance,{value:'18000'});Object.assign(elements.transport,{value:'17000'});
  let stored=raw;
  const context={document:{getElementById:id=>elements[id]??=new Element(),createElement:()=>new Element()},localStorage:{getItem:()=>{if(storageFails)throw Error('blocked');return stored;},setItem:(key,value)=>{if(storageFails)throw Error('blocked');stored=value;}}};
  const run=code=>runInNewContext(code,context);
  run(script);
  return {elements,run,stored:()=>stored};
}
const saved={wage:1145,allowance:18000,transport:17000,shifts:[{name:'遅番',hours:8,breakMinutes:45,days:22},{name:'短時間',hours:5,breakMinutes:0,days:4}]};
test('handoff example and valid persisted string inputs',()=>{
  const a=app(JSON.stringify({...saved,shifts:saved.shifts.map(s=>({...s,hours:String(s.hours)}))}));
  assert.equal(a.elements.total.textContent,'240,528円');assert.equal(a.elements.base.textContent,'205,528円');assert.equal(a.elements.hoursTotal.textContent,'179.5時間');
});
test('default calculation',()=>assert.equal(app().elements.total.textContent,'189,500円'));
for(const [name,value] of [['negative','-1'],['blank',''],['not finite','Infinity']])test('reject '+name+' wage',()=>{const a=app();a.elements.wage.value=value;a.run('calculate()');assert.equal(a.elements.total.textContent,'—');assert.match(a.elements.status.textContent,/0以上/);});
test('reject break longer than shift and fractional days',()=>{const a=app();a.run('shifts[0].breakMinutes=481;calculate()');assert.equal(a.elements.total.textContent,'—');a.run('shifts[0].breakMinutes=45;shifts[0].days=1.5;calculate()');assert.equal(a.elements.total.textContent,'—');});
test('zero wage and zero paid time are valid',()=>{const a=app();a.run('shifts=[{name:"休み",hours:1,breakMinutes:60,days:0}];calculate()');assert.equal(a.elements.total.textContent,'35,000円');});
test('no shift does not display allowance-only income',()=>{const a=app();a.run('shifts=[];calculate()');assert.equal(a.elements.total.textContent,'—');assert.match(a.elements.status.textContent,/1件以上/);});
test('overflow does not display Infinity',()=>{const a=app();a.elements.wage.value='1e308';a.run('calculate()');assert.equal(a.elements.total.textContent,'—');assert.match(a.elements.status.textContent,/大きすぎ/);});
for(const [name,raw] of [['broken JSON','{'],['null shift',JSON.stringify({...saved,shifts:[null]})],['bad numeric type',JSON.stringify({...saved,shifts:[{hours:[],breakMinutes:0,days:1}]})],['null JSON','null']])test('recover '+name+' without overwriting original',()=>{const a=app(raw);assert.equal(a.elements.total.textContent,'189,500円');assert.equal(a.stored(),raw);assert.match(a.elements.status.textContent,/読み込めなかった/);assert.equal(a.elements.recover.hidden,false);a.elements.recover.events.click();assert.notEqual(a.stored(),raw);assert.equal(a.elements.recover.hidden,true);});
test('storage denied still calculates',()=>{const a=app(null,true);assert.equal(a.elements.total.textContent,'189,500円');assert.match(a.elements.status.textContent,/保存していません/);});
test('add/remove UI event updates result',()=>{const a=app();a.elements.add.events.click();assert.equal(a.elements.shifts.children.length,4);a.elements.shifts.children[3].children[0].children[1].events.click();assert.equal(a.elements.shifts.children.length,3);assert.equal(a.elements.total.textContent,'189,500円');});
test('existing invalid saved values are preserved',()=>{const raw=JSON.stringify({...saved,wage:-1});const a=app(raw);assert.equal(a.stored(),raw);assert.match(a.elements.status.textContent,/読み込めなかった/);});
test('comparison shows differences and leaves the reference unchanged',()=>{
  const a=app(JSON.stringify(saved));a.elements.saveComparison.events.click();a.run('shifts[0].days=20;calculate()');
  assert.equal(a.elements.referenceTotal.textContent,'240,528円');assert.equal(a.elements.currentTotal.textContent,'223,925円');
  assert.equal(a.elements.payDifference.textContent,'保存した案より 16,603円減ります');assert.equal(a.elements.hoursDifference.textContent,'実働時間の差：−14.5時間');
  assert.equal(JSON.parse(a.stored()).comparison.shifts[0].days,22);
});
test('comparison persists across reload and restores all input conditions',()=>{
  const a=app(JSON.stringify(saved));a.elements.saveComparison.events.click();a.run('shifts[0].days=20;calculate()');
  const b=app(a.stored());assert.equal(b.elements.currentTotal.textContent,'223,925円');assert.equal(b.elements.comparison.hidden,false);
  b.elements.restoreComparison.events.click();assert.equal(b.elements.total.textContent,'240,528円');assert.equal(b.elements.payDifference.textContent,'月収の差：0円');
});
test('comparison responds to wage and allowance changes',()=>{
  const a=app();a.elements.saveComparison.events.click();a.elements.allowance.value='19000';a.run('calculate()');assert.equal(a.elements.payDifference.textContent,'保存した案より 1,000円増えます');
  a.elements.wage.value='1300';a.run('calculate()');assert.equal(a.elements.payDifference.textContent,'保存した案より 13,875円増えます');
});
test('invalid input clears current comparison but keeps saved reference',()=>{
  const a=app();a.elements.saveComparison.events.click();a.elements.wage.value='';a.run('calculate()');
  assert.equal(a.elements.currentTotal.textContent,'—');assert.equal(a.elements.referenceTotal.textContent,'189,500円');assert.equal(a.elements.exportBackup.disabled,true);assert.match(a.elements.payDifference.textContent,/入力を直す/);
});
test('remove comparison persists and hides it',()=>{
  const a=app();a.elements.saveComparison.events.click();a.elements.removeComparison.events.click();
  assert.equal(a.elements.comparison.hidden,true);assert.equal(JSON.parse(a.stored()).comparison,null);
});
test('backup round trip includes current data and comparison',()=>{
  const a=app(JSON.stringify(saved));a.elements.saveComparison.events.click();a.run('shifts[0].days=20;calculate()');
  const payload=a.run('JSON.stringify(createBackup())');const b=app();b.run('stageImport(parseBackup('+JSON.stringify(payload)+'))');
  assert.equal(b.elements.total.textContent,'189,500円');assert.equal(b.elements.importPreview.hidden,false);
  b.elements.applyImport.events.click();assert.equal(b.elements.total.textContent,'223,925円');assert.equal(b.elements.referenceTotal.textContent,'240,528円');
  assert.equal(b.elements.importPreview.hidden,true);assert.match(b.elements.backupStatus.textContent,/復元しました/);
});
test('cancel staged import keeps current data and storage',()=>{
  const a=app();const before=a.stored();a.run('stageImport({current:'+JSON.stringify(saved)+',comparison:null})');
  a.elements.cancelImport.events.click();a.elements.applyImport.events.click();assert.equal(a.stored(),before);assert.equal(a.elements.total.textContent,'189,500円');
});
for(const [name,payload] of [
  ['wrong app',{app:'other',version:1,current:saved,comparison:null}],
  ['future version',{app:'shift-pay',version:2,current:saved,comparison:null}],
  ['null shift',{app:'shift-pay',version:1,current:{...saved,shifts:[null]},comparison:null}],
  ['oversized days',{app:'shift-pay',version:1,current:{...saved,shifts:[{hours:1e308,breakMinutes:0,days:10}]},comparison:null}],
  ['invalid reference',{app:'shift-pay',version:1,current:saved,comparison:{...saved,wage:-1}}],
  ['empty shifts',{app:'shift-pay',version:1,current:{...saved,shifts:[]},comparison:null}]
])test('import rejects '+name+' without mutating input or storage',()=>{
  const a=app();const before=a.stored();assert.throws(()=>a.run('parseBackup('+JSON.stringify(JSON.stringify(payload))+')'));
  assert.equal(a.stored(),before);assert.equal(a.elements.total.textContent,'189,500円');
});
test('reject malformed or oversized backup text',()=>{
  const a=app();assert.throws(()=>a.run('parseBackup("{")'));assert.throws(()=>a.run('parseBackup(" ".repeat(1000001))'));
});
test('old saved data loads without a reference or migration',()=>{const a=app(JSON.stringify(saved));assert.equal(a.elements.comparison.hidden,true);assert.equal(a.elements.total.textContent,'240,528円');});
test('invalid saved reference is protected from overwrite',()=>{const raw=JSON.stringify({...saved,comparison:{...saved,wage:-1}});const a=app(raw);assert.equal(a.stored(),raw);assert.equal(a.elements.recover.hidden,false);});
test('restoring a valid backup recovers from corrupt local data',()=>{
  const a=app('{');a.run('stageImport(parseBackup('+JSON.stringify(JSON.stringify({app:'shift-pay',version:1,current:saved,comparison:null}))+'))');
  a.elements.applyImport.events.click();assert.equal(a.elements.total.textContent,'240,528円');assert.equal(a.elements.recover.hidden,true);assert.equal(JSON.parse(a.stored()).wage,1145);
});
test('removing comparison during an invalid edit keeps last valid input on reload',()=>{
  const a=app();a.elements.saveComparison.events.click();a.elements.wage.value='';a.run('calculate()');a.elements.removeComparison.events.click();
  const b=app(a.stored());assert.equal(b.elements.comparison.hidden,true);assert.equal(b.elements.wage.value,'1200');assert.equal(b.elements.total.textContent,'189,500円');
});
test('invalid input cannot overwrite a comparison snapshot',()=>{
  const a=app();a.elements.saveComparison.events.click();const before=a.stored();a.elements.wage.value='';a.elements.saveComparison.events.click();assert.equal(a.stored(),before);assert.equal(a.elements.referenceTotal.textContent,'189,500円');
});
