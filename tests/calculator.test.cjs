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
  const context={document:{getElementById:id=>elements[id],createElement:()=>new Element()},localStorage:{getItem:()=>{if(storageFails)throw Error('blocked');return stored;},setItem:(key,value)=>{if(storageFails)throw Error('blocked');stored=value;}}};
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
