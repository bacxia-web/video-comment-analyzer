const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(initialCount, onRound = () => {}, onClick = () => {}) {
  const items = [], messages = [], replies = [], actions = [];
  let captcha = false, restriction = '', rounds = 0, now = 0, scrollTop = 37;
  let noteText = '';
  const scroll = {scrollHeight:2000,clientHeight:300,
    get scrollTop(){return scrollTop;},
    set scrollTop(value){actions.push({kind:'scroll',time:now});scrollTop=value;}};
  const replyRoot = {querySelectorAll:()=>replies};
  const root = {
    querySelectorAll:()=>items,
    querySelector:selector=>selector.startsWith('#detail-desc') ? {textContent:noteText,closest:()=>null}
      :selector.startsWith('#detail-title') ? {textContent:'笔记正文测试'}
      :selector.includes(',') ? replyRoot : selector==='.note-scroller' ? scroll : null,
  };
  function add(count) {
    for (let i=0;i<count;i++) {
      const id=String(items.length+1);
      const item = {getAttribute:name=>name==='data-id'?id:null,querySelector:selector=>{
        if(selector.startsWith('.reply'))return null;
        if (selector.includes('content')||selector==='.note-text') return {textContent:`评论 ${id}`,closest:()=>item};
        if (selector.includes('name')) return {textContent:`作者 ${id}`};
        if (selector.includes('count')) return {textContent:'3'};
        return null;
      }};
      items.push(item);
    }
  }
  add(initialCount);
  const restrict = () => {restriction='操作过于频繁，过一会儿再操作';};
  function addReplies(count) {
    for(let i=0;i<count;i++) replies.push({textContent:'展开 1 条回复',offsetParent:{},children:[],closest:()=>null,
      click(){actions.push({kind:'click',time:now});onClick({restrict,add});}});
  }
  const sandbox = {
    location:{pathname:'/explore/fixture'},getComputedStyle:()=>({visibility:'visible'}),
    document:{querySelector:selector=>selector.includes('note-detail')?root:null,
      querySelectorAll:selector=>captcha&&selector.includes('#captcha')?[{getClientRects:()=>[{}]}]
        :restriction&&selector.includes('.error-page')?[{textContent:restriction,getClientRects:()=>[{}]}]:[],scrollingElement:scroll},
    chrome:{runtime:{sendMessage:async message=>messages.push(message)}},
    setTimeout:(fn,ms)=>{now+=ms;
      const round=messages.at(-1)?.round;
      if(round!==rounds){rounds=round;onRound({rounds,add,restrict,stop:()=>sandbox.panoramaStopCollection({id:'fixture',key:'xiaohongshu:fixture'},'job'),block:()=>{captcha=true;}});}
      fn();},
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../collectors.js'),'utf8'),sandbox);
  return {messages,scroll,add,addReplies,actions,restrict,items,setNote:value=>{noteText=value;},setCaptcha:value=>{captcha=value;},
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

test('reply expansion is serialized with a pause between page actions',async()=>{
  const f=fixture(8);f.addReplies(20);
  await f.run({maxRounds:5});
  const clicks=f.actions.filter(action=>action.kind==='click');
  assert.equal(clicks.length,5,'each round can expand only one reply');
  for(let i=1;i<clicks.length;i++) assert.ok(clicks[i].time-clicks[i-1].time>=3000,'reply clicks must not burst');
  const lastClick=clicks.at(-1);
  for(const action of f.actions.filter(action=>action.kind==='scroll')) {
    assert.ok(action.time-lastClick.time>=3000,'expanding replies must not also scroll immediately');
  }
});

test('the reported frequency warning stops the next click and preserves partial comments',async()=>{
  const f=fixture(8,()=>{},({restrict})=>restrict());f.addReplies(20);
  const result=await f.run();
  assert.equal(result.stopReason,'restricted');
  assert.equal(result.comments.length,8);
  assert.deepEqual(f.actions.map(action=>action.kind),['click'],'do not click or restore scrolling after the warning');
  assert.match(result.stopMessage,/已获取.*分析/);
});

test('a warning arriving while waiting stops before another page action',async()=>{
  const f=fixture(8,({restrict})=>restrict());f.addReplies(20);
  const result=await f.run();
  assert.equal(result.stopReason,'restricted');
  assert.equal(f.actions.length,1);
  assert.equal(result.comments.length,8);
});

test('resume does not move the page when a frequency warning is already visible',async()=>{
  const f=fixture(8);
  await f.run({maxRounds:5});
  f.actions.length=0;f.restrict();
  const result=await f.run({},true);
  assert.equal(result.stopReason,'restricted');
  assert.equal(result.comments.length,8);
  assert.deepEqual(f.actions,[]);
});

test('collection preserves the note body separately from comments, including truncation',async()=>{
  const f=fixture(2);f.setNote('正文背景\n'.repeat(5000));
  const result=await f.run();
  assert.equal(result.comments.length,2);
  assert.equal(result.note.title,'笔记正文测试');
  assert.equal(result.note.text.length,20000);
  assert.equal(result.note.truncated,true);
  assert.equal(result.info.description,result.note.text);
  assert.ok(result.comments.every(row=>!row.isReply));
});

test('explicit parents and thread roots are resolved independently, including after resume',async()=>{
  const f=fixture(3), [root,reply,nested]=f.items;
  const thread={querySelector:selector=>root.querySelector(selector)};
  for(const item of [reply,nested]){
    item.closest=()=>thread;item.matches=()=>true;
  }
  const attributes=nested.getAttribute;
  nested.getAttribute=name=>name==='data-reply-to-id'?'2':attributes(name);
  const first=await f.run();
  assert.equal(first.comments[1].parentCommentId,null,'a shared thread does not prove a direct parent');
  assert.equal(first.comments[1].threadRootId,'xhs-1');
  assert.equal(first.comments[2].parentCommentId,'xhs-2');
  assert.equal(first.comments[2].threadRootId,'xhs-1');
  const resumed=await f.run({},true);
  assert.equal(resumed.comments.length,3);
  assert.equal(resumed.comments[2].parentCommentId,first.comments[2].parentCommentId);
});

test('identical no-ID replies in different discussions are not merged',async()=>{
  const f=fixture(4), [firstRoot,secondRoot,...replies]=f.items;
  replies.forEach((item,index)=>{
    item.getAttribute=()=>null;
    const query=item.querySelector;
    item.querySelector=selector=>selector==='span.content'||selector.startsWith('.content')||selector==='.note-text'
      ?{textContent:'同意',closest:()=>item}:selector.includes('name')&&!selector.startsWith('.reply')?{textContent:'同一个昵称'}:query(selector);
    item.closest=()=>({querySelector:selector=>[firstRoot,secondRoot][index].querySelector(selector)});
    item.matches=()=>true;
  });
  const result=await f.run();
  assert.equal(result.comments.length,4);
  assert.equal(result.comments[2].threadRootId,'xhs-1');
  assert.equal(result.comments[3].threadRootId,'xhs-2');
  assert.equal(result.comments[2].parentCommentId,null);
});

test('identical no-ID replies to different explicit parents keep their identities',async()=>{
  const f=fixture(5), [root,,,first,second]=f.items;
  for(const [index,item] of [first,second].entries()){
    item.getAttribute=name=>name==='data-reply-to-id'?String(index+2):null;
    const query=item.querySelector;
    item.querySelector=selector=>selector.startsWith('.content')||selector==='.note-text'||selector==='span.content'
      ?{textContent:'不是这个意思',closest:()=>item}:selector.includes('name')&&!selector.startsWith('.reply')?{textContent:'同一个昵称'}:query(selector);
    item.closest=()=>({querySelector:selector=>root.querySelector(selector)});item.matches=()=>true;
  }
  const result=await f.run();
  assert.equal(result.comments.length,5);
  assert.equal(result.comments[3].parentCommentId,'xhs-2');
  assert.equal(result.comments[4].parentCommentId,'xhs-3');
});
