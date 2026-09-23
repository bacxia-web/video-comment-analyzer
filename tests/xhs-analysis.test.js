const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const analysis = require('../xhs-analysis.js');
const settings = require('../settings.js');

const rows = count => Array.from({length:count}, (_, index) => ({id:`c-${index}`,text:`第 ${index} 条具体评论`,author:`作者 ${index}`,likeCount:index}));
const attitudes = ['positive','negative','neutral','mixed'];
const tags = ['具体经历','信息补充','建设性建议','关键问题'];
function batchResult(comments) {
  const topics = new Map();
  const assignments = comments.map(row => {
    const group = Number(row.id.split('-').at(-1)) % 4;
    const id = `t${group}`;
    if (!topics.has(id)) topics.set(id,{id,title:`议题 ${group}`,summary:`议题 ${group} 的具体观点`,sentiment:attitudes[group],evidenceCommentIds:[row.id]});
    return {commentId:row.id,topicId:id};
  });
  return {summary:'讨论存在明确共识与分歧。',topics:[...topics.values()],assignments,
    featured:comments.slice(0,4).map((row,index)=>({commentId:row.id,tag:tags[index],reason:`有具体的信息 ${index}`}))};
}
function mergeResult(topics) {
  const grouped = new Map();
  topics.forEach(topic=>{
    if (!grouped.has(topic.title)) grouped.set(topic.title,{title:topic.title,summary:topic.summary,sentiment:topic.sentiment,sourceTopicIds:[]});
    grouped.get(topic.title).sourceTopicIds.push(topic.id);
  });
  return {summary:'主要意见与分歧汇总。',topics:[...grouped.values()]};
}
function worker(onRequest) {
  const calls = [], progress = [];
  const sandbox = {TextEncoder,Uint8Array,crypto,console,
    chrome:{runtime:{sendMessage:async message=>progress.push(message)}},
    panoramaContext:async()=>({}), loadPromptSection:async(file,heading)=>heading, parseLooseJson:JSON.parse,
    requestAiCompletion:async args=>{
      const data = JSON.parse(args.messages[1].content); calls.push(data);
      await onRequest?.(data,sandbox);
      return {text:JSON.stringify(data.task==='xhs_batch'?batchResult(data.comments):mergeResult(data.topics))};
    }};
  vm.runInNewContext(fs.readFileSync(require.resolve('../xhs-analysis.js'),'utf8'),sandbox);
  return {calls,progress,sandbox,run:(source,id='request-1',note)=>sandbox.handleAnalyzeXhs(source,{key:'xiaohongshu:fixture',tabId:1,title:'笔记',note},id)};
}

test('XHS settings use bounded defaults and reject unsafe or fractional overrides',()=>{
  assert.deepEqual(settings.normalizeXhs(),{maxComments:1000,maxRounds:20,idleRounds:3});
  assert.deepEqual(settings.normalizeXhs({maxComments:5000,maxRounds:200,idleRounds:10}),{maxComments:5000,maxRounds:200,idleRounds:10});
  for (const value of [-1,0,Infinity,NaN,5001,1.5,'bad',null]) assert.equal(settings.normalizeXhs({maxComments:value}).maxComments,1000);
});
test('batches cover all comments beyond 400 and retain long comment text',()=>{
  const source=rows(1234); source[12].text='较长原文'.repeat(1000);
  const batches=analysis.batches(analysis.prepare(source));
  assert.deepEqual(batches.flat().map(row=>row.id),source.map(row=>row.id));
  assert.equal(batches.flat()[12].text,source[12].text);
  assert.ok(batches.every(batch=>batch.length<=60));
  assert.ok(batches.every(batch=>batch.reduce((n,row)=>n+JSON.stringify({id:row.id,text:row.text,likes:row.likeCount}).length,0)<=24000));
});
test('batch validation requires exactly one real assignment for every comment',()=>{
  const source=rows(4), valid=batchResult(source);
  assert.equal(analysis.validateBatch(valid,source,0).topics.length,4);
  for (const mutate of [data=>data.assignments.pop(), data=>data.assignments.push(data.assignments[0]),
    data=>data.assignments[0].commentId='invented', data=>data.assignments[0].topicId='invented']) {
    const broken=structuredClone(valid); mutate(broken);
    assert.throws(()=>analysis.validateBatch(broken,source,0),/本批分析/);
  }
  const unknown=structuredClone(valid); unknown.topics[0].sentiment='not-known';
  assert.equal(analysis.validateBatch(unknown,source,0).topics[0].sentiment,'unknown');
});
test('counts, citations and featured comments are derived from source IDs',()=>{
  const source=rows(9); source[0].text='<img src=x onerror=alert(1)> 真实原文'; source[8].text=source[0].text;
  const input=batchResult(source); input.topics[0].count=9999; input.topics[0].evidenceCommentIds=['invented','c-1','c-0'];
  input.assignments[8].topicId=null;
  input.featured.push({commentId:'invented',tag:'具体经历',reason:'伪造'}, {commentId:'c-8',tag:'具体经历',reason:'重复内容'});
  const report=analysis.validateBatch(input,source,0);
  const output=analysis.result(source,[report],report);
  assert.equal(output.totalAnalyzed,9); assert.equal(output.unclassifiedCount,1);
  assert.equal(output.topics.reduce((sum,t)=>sum+t.count,0),8);
  assert.deepEqual(output.topics.find(t=>t.title==='议题 0').evidence.map(row=>row.id),['c-0']);
  assert.ok(output.featured.every(row=>row.id!=='invented'));
  assert.equal(output.featured[0].text,source[0].text);
  assert.deepEqual(output.sentimentCounts,{positive:1,negative:1,neutral:1,mixed:1,unknown:0});
});
test('merging cannot omit, duplicate or invent source topics',()=>{
  const source=rows(16), report=analysis.validateBatch(batchResult(source),source,0);
  const input=mergeResult(report.topics);
  assert.equal(analysis.validateMerge(input,report.topics,'m').topics.reduce((n,t)=>n+t.commentIds.length,0),16);
  for (const mutate of [data=>data.topics.pop(),data=>data.topics[0].sourceTopicIds.push('invented'),
    data=>data.topics[1].sourceTopicIds.push(data.topics[0].sourceTopicIds[0])]) {
    const broken=structuredClone(input); mutate(broken); assert.throws(()=>analysis.validateMerge(broken,report.topics,'m'));
  }
});
test('real batch progress and merged counts cover all 431 collected comments',async()=>{
  const fixture=worker(); const result=await fixture.run(rows(431));
  assert.equal(result.success,true); assert.equal(result.analysis.totalAnalyzed,431);
  const requests=fixture.calls.filter(data=>data.task==='xhs_batch');
  assert.equal(requests.flatMap(data=>data.comments).length,431);
  assert.equal(new Set(requests.flatMap(data=>data.comments.map(row=>row.id))).size,431);
  const counts=fixture.progress.filter(p=>p.phase==='analyze').map(p=>p.analyzed);
  assert.deepEqual(counts,[0,60,120,180,240,300,360,420,431]);
  assert.equal(result.analysis.topics.reduce((n,t)=>n+t.count,0),431);
  assert.ok(fixture.calls.some(data=>data.task==='xhs_merge'));
});
test('analysis retry reuses successful batches and never recounts them',async()=>{
  let fail=true;
  const fixture=worker(data=>{if(fail&&data.task==='xhs_batch'&&data.comments[0].id==='c-120')throw new Error('Fixture timeout');});
  const first=await fixture.run(rows(181)); assert.equal(first.success,false); assert.equal(first.completedBatches,2);
  fail=false; const second=await fixture.run(rows(181),'retry'); assert.equal(second.success,true);
  assert.equal(fixture.calls.filter(data=>data.task==='xhs_batch'&&data.comments[0].id==='c-0').length,1);
  assert.equal(second.analysis.totalAnalyzed,181);
  assert.equal(fixture.progress.find(p=>p.requestId==='retry').analyzed,120);
});
test('navigation cancellation stops subsequent paid batches',async()=>{
  const fixture=worker((data,sandbox)=>{if(data.task==='xhs_batch')sandbox.cancelXhsAnalysis('cancel-me');});
  const result=await fixture.run(rows(181),'cancel-me');
  assert.equal(result.success,false); assert.match(result.message,/后续批次已停止/);
  assert.equal(fixture.calls.length,1);
});
test('a second panel cannot release another running analysis lock',async()=>{
  let release, ready;
  const gate=new Promise(resolve=>{release=resolve;}), started=new Promise(resolve=>{ready=resolve;});
  const fixture=worker(async()=>{ready();await gate;});
  const running=fixture.run(rows(5)); await started;
  assert.equal((await fixture.run(rows(5),'second')).success,false);
  assert.equal((await fixture.run(rows(5),'third')).success,false);
  assert.equal(fixture.calls.length,1); release(); assert.equal((await running).success,true);
});

test('every batch and merge receive the note; cross-batch references are context only',async()=>{
  const source=rows(62);
  for(const row of source.slice(60))Object.assign(row,{isReply:true,parentCommentId:'c-0',threadRootId:'c-1',replyToAuthor:'作者 0'});
  const note={title:'正文测试',author:'作者',text:'只讨论室内使用，不讨论户外效果。',truncated:false};
  const fixture=worker(), result=await fixture.run(source,'context',note);
  assert.equal(result.success,true);
  assert.equal(result.analysis.totalAnalyzed,62);
  assert.equal(result.analysis.topics.reduce((sum,topic)=>sum+topic.count,0),62);
  assert.ok(fixture.calls.every(call=>JSON.stringify(call.note)===JSON.stringify(note)));
  const second=fixture.calls.filter(call=>call.task==='xhs_batch')[1];
  assert.deepEqual(second.contextComments.map(row=>row.id),['c-0','c-1']);
  assert.equal(second.comments.length,2);
  assert.equal(second.comments[0].parentCommentId,'c-0');
  assert.equal(second.comments[0].replyToAuthor,'作者 0');
  const invalid=batchResult(second.comments);invalid.assignments.push({commentId:'c-0',topicId:'t0'});
  assert.throws(()=>analysis.validateBatch(invalid,second.comments,1),/本批分析/);
});

test('batch size includes long reference comments without duplicating targets',()=>{
  const source=rows(80);
  source.forEach(row=>{row.text='原文'.repeat(2400);});
  for(const row of source.slice(2))Object.assign(row,{isReply:true,parentCommentId:'c-0',threadRootId:'c-1'});
  const prepared=analysis.prepare(source), byId=new Map(prepared.map(row=>[row.id,row]));
  const batches=analysis.batches(prepared);
  assert.deepEqual(batches.flat().map(row=>row.id),source.map(row=>row.id));
  for(const batch of batches){
    const payload=analysis.batchPayload(batch,byId);
    assert.ok(JSON.stringify(payload).length<=24000);
    const ids=[...payload.comments,...payload.contextComments].map(row=>row.id);
    assert.equal(ids.length,new Set(ids).size);
  }
});

test('missing and self-referential parents stay unconfirmed instead of being guessed',()=>{
  const source=rows(3);
  source[1].parentCommentId='missing';source[1].threadRootId='c-0';source[1].replyToAuthor=source[0].author;
  source[2].parentCommentId=source[2].id;
  const prepared=analysis.prepare(source);
  assert.equal(prepared[1].isReply,true);
  assert.equal(prepared[1].parentCommentId,null);
  assert.equal(prepared[1].threadRootId,'c-0');
  assert.equal(prepared[2].parentCommentId,null);
  assert.deepEqual(analysis.prepareNote(null,'只有标题'),{title:'只有标题',author:'',text:'',truncated:false});
});

test('changed note text or reply relationships invalidate partial analysis checkpoints',async()=>{
  for(const change of ['body','relationship']){
    let fail=true;
    const fixture=worker(data=>{if(fail&&data.task==='xhs_batch'&&data.comments[0].id==='c-60')throw new Error('Fixture timeout');});
    const source=rows(61), note={text:'正文修改前'};
    source[60].parentCommentId='c-0';
    assert.equal((await fixture.run(source,'first',note)).completedBatches,1);
    if(change==='body')note.text='正文修改后';else source[60].parentCommentId='c-1';
    fail=false;
    assert.equal((await fixture.run(source,'retry',note)).success,true);
    assert.equal(fixture.calls.filter(call=>call.task==='xhs_batch'&&call.comments[0].id==='c-0').length,2);
  }
});
