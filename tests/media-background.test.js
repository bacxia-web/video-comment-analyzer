const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const platforms = require('../platforms.js');
const comments = require('../comments.js');
const collectors = require('../collectors.js');

function load() {
  let listener;
  let tab = {id:1,url:'https://www.xiaohongshu.com/explore/1234567890abcdef12345678',title:'Tab title'};
  const injected = [], intervals = new Set();
  const sandbox = {
    ...collectors, PANORAMA_PLATFORMS:platforms, YTD_COMMENTS:comments,
    setInterval: fn => {intervals.add(fn);return fn;}, clearInterval: fn=>intervals.delete(fn),
    chrome:{runtime:{id:'fixture',getURL:resource=>`chrome-extension://fixture/${resource}`,
      onMessage:{addListener:fn=>{listener=fn;}},getPlatformInfo:async()=>({})},
      tabs:{get:async()=>tab},scripting:{executeScript:async options=>{
        injected.push(options);
        if (options.func.name==='panoramaPageInfo') return [{result:{title:'Actual note title',channelName:'Author'}}];
        return [{result:{success:true,comments:[{id:'c1',text:'Hello',author:'Author',likeCount:1}],source:'XHS'}}];
      }}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../media-background.js'),'utf8'),sandbox);
  return {injected,intervals,changeTab:value=>{tab=value;},
    send:(message,sender={id:'fixture',url:'chrome-extension://fixture/panel.html'})=>new Promise(resolve=>listener(message,sender,resolve))};
}
test('media collection rejects web-page and foreign extension senders',async()=>{
  const fixture=load();
  for (const sender of [{id:'fixture',url:'https://www.xiaohongshu.com/explore/1234567890abcdef12345678'},
    {id:'other',url:'chrome-extension://other/panel.html'}]) {
    assert.equal((await fixture.send({action:'mediaCollect',tabId:1,mode:'comments'},sender)).error,'UNAUTHORIZED');
  }
  assert.equal(fixture.injected.length,0);
});
test('collection keeps content metadata and never injects service keys',async()=>{
  const fixture=load();
  const result=await fixture.send({action:'mediaCollect',tabId:1,key:'xiaohongshu:1234567890abcdef12345678',mode:'comments'});
  assert.equal(result.success,true); assert.equal(result.context.title,'Actual note title');
  assert.equal(result.stats.total,1);
  assert.equal(fixture.injected[0].world,'ISOLATED');
  assert.ok(!Object.keys(fixture.injected[0].args[0]).some(key=>/apikey|cookie|token/i.test(key)));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(fixture.intervals.size,0);
});
test('navigation invalidates a request before extraction',async()=>{
  const fixture=load(); fixture.changeTab({id:1,url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'});
  const result=await fixture.send({action:'mediaCollect',tabId:1,key:'xiaohongshu:1234567890abcdef12345678',mode:'comments'});
  assert.equal(result.success,false); assert.equal(fixture.injected.length,0);
});
