const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(initialCount, onRound = () => {}) {
  const items = [], messages = [];
  let captcha = false, rounds = 0;
  const scroll = {scrollHeight:2000,clientHeight:300,scrollTop:37};
  const replyRoot = {querySelectorAll:()=>[]};
  const root = {
    querySelectorAll:()=>items,
    querySelector:selector=>selector.includes(',') ? replyRoot : selector==='.note-scroller' ? scroll : null,
  };
  function add(count) {
    for (let i=0;i<count;i++) {
      const id=String(items.length+1);
      const item = {getAttribute:()=>id,querySelector:selector=>{
        if (selector.includes('content')||selector==='.note-text') return {textContent:`评论 ${id}`,closest:()=>item};
        if (selector.includes('name')) return {textContent:`作者 ${id}`};
        if (selector.includes('count')) return {textContent:'3'};
        return null;
      }};
      items.push(item);
    }
  }
  add(initialCount);
  const sandbox = {
    location:{pathname:'/explore/fixture'},getComputedStyle:()=>({visibility:'visible'}),
    document:{querySelector:selector=>selector.includes('note-detail')?root:null,
      querySelectorAll:selector=>captcha&&selector.includes('#captcha')?[{getClientRects:()=>[{}]}]:[],scrollingElement:scroll},
    chrome:{runtime:{sendMessage:async message=>messages.push(message)}},
    setTimeout:fn=>{rounds++;onRound({rounds,add,stop:()=>sandbox.panoramaStopCollection({id:'fixture',key:'xiaohongshu:fixture'},'job'),block:()=>{captcha=true;}});fn();},
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../collectors.js'),'utf8'),sandbox);
  return {messages,scroll,add,setCaptcha:value=>{captcha=value;},
    run:(options={},resume=false)=>sandbox.panoramaCollectComments({id:'fixture',key:'xiaohongshu:fixture',platform:'xiaohongshu'},options,'job',resume)};
}

test('XHS counts stop at the configured cap and resume without duplicates',async()=>{
  const f=fixture(125);
  const first=await f.run({maxComments:100});
  assert.equal(first.comments.length,100); assert.equal(first.stopReason,'count_limit');
  const next=await f.run({maxComments:200},true);
  assert.equal(next.comments.length,125); assert.equal(next.stopReason,'idle');
  assert.equal(new Set(next.comments.map(row=>row.id)).size,125);
  assert.equal(next.comments[0].id,first.comments[0].id);
  assert.equal(f.scroll.scrollTop,37);
  assert.ok(f.messages.every(message=>message.requestId==='job'));
});
test('XHS honors both round and idle thresholds with an explicit stop reason',async()=>{
  const growing=fixture(1,({add})=>add(1));
  const capped=await growing.run({maxRounds:5});
  assert.equal(capped.stopReason,'round_limit'); assert.equal(capped.rounds,5); assert.equal(capped.comments.length,6);
  const stable=await fixture(2).run({idleRounds:6});
  assert.equal(stable.stopReason,'idle'); assert.equal(stable.rounds,7);
});
test('stopping collection returns its partial data and does not run another round',async()=>{
  const f=fixture(12,({stop})=>stop()); const result=await f.run();
  assert.equal(result.stopReason,'user'); assert.equal(result.comments.length,12); assert.equal(result.rounds,1);
  assert.equal(f.scroll.scrollTop,37);
});
test('visible verification pauses collection while retaining already read comments',async()=>{
  const f=fixture(8,({block})=>block()); const result=await f.run();
  assert.equal(result.stopReason,'verification'); assert.equal(result.comments.length,8); assert.equal(result.rounds,1);
  assert.match(result.stopMessage,/验证/);
  const empty=fixture(8); empty.setCaptcha(true); const blocked=await empty.run();
  assert.equal(blocked.comments.length,0); assert.equal(blocked.stopReason,'verification');
});
test('a refreshed page cannot silently continue a lost collection session',async()=>{
  const f=fixture(10); const result=await f.run({},true);
  assert.equal(result.success,false); assert.equal(result.error,'COLLECTION_SESSION_EXPIRED');
});
