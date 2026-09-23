const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const platforms = require('../platforms.js');
const { panoramaReadVideo } = require('../collectors.js');

test('strict platform identities separate videos, notes and Bilibili parts', () => {
  assert.equal(platforms.parse('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=private').key, 'youtube:dQw4w9WgXcQ');
  assert.equal(platforms.parse('https://www.youtube.com/shorts/dQw4w9WgXcQ').key, 'youtube:dQw4w9WgXcQ');
  assert.equal(platforms.parse('https://www.bilibili.com/video/BV13x41117TL/?p=2').key, 'bilibili:BV13x41117TL:2');
  assert.equal(platforms.parse('https://www.bilibili.com/video/av123/?p=1').id, 'av123');
  assert.equal(platforms.parse('https://www.xiaohongshu.com/explore/1234567890abcdef12345678?xsec_token=fixture').comments, true);
  assert.equal(platforms.parse('https://xueqiu.com/123/456').id, '456');
  for (const url of ['https://www.youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=bad', 'https://www.xiaohongshu.com/explore', 'https://www.bilibili.com/', 'chrome://extensions']) assert.equal(platforms.parse(url), null);
});

test('transcripts reject empty, invalid, and overlong sources rather than silently clipping the video', () => {
  assert.equal(platforms.transcriptResult([], 'native').success, false);
  const result = platforms.transcriptResult([{ start: 20, text: 'late' }, { start: -1, text: 'bad' }, { start: 0, text: 'begin' }], 'native');
  assert.equal(result.transcriptTextTimestamped, '[0:00] begin\n[0:20] late');
  assert.equal(platforms.transcriptResult(Array.from({length:30}, (_,i) => ({start:i,text:'a'.repeat(10000)})), 'native').error, 'TRANSCRIPT_TOO_LONG');
});

test('YouTube uses the full panel while other platforms keep their supported analysis UI',()=>{
  assert.equal(platforms.panelPath('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),'sidepanel.html');
  assert.equal(platforms.panelPath('https://www.youtube.com/shorts/dQw4w9WgXcQ'),'sidepanel.html');
  assert.equal(platforms.panelPath('https://www.xiaohongshu.com/explore/1234567890abcdef12345678'),'panel.html');
  assert.equal(platforms.panelPath('https://www.bilibili.com/video/BV13x41117TL/?p=2'),'panel.html');
});

function runCollector(url, expected, fetchImpl, player) {
  const context = { URL, URLSearchParams, AbortSignal, location: new URL(url), fetch: fetchImpl,
    window: { ytInitialPlayerResponse: player },
    document: { title: 'Fixture video', querySelector: () => null, querySelectorAll: () => [], getElementById: () => null } };
  return vm.runInNewContext(`(${panoramaReadVideo.toString()})`, context)(expected, true);
}
test('Bilibili collector uses the current part cid and native subtitle timestamps', async () => {
  const url = 'https://www.bilibili.com/video/BV13x41117TL/?p=2';
  const calls = [];
  const result = await runCollector(url, platforms.parse(url), async (input, options) => {
    const target = new URL(input); calls.push({target,options});
    if (target.pathname === '/x/web-interface/view') return {ok:true,json:async()=>({code:0,data:{bvid:'BV13x41117TL',title:'Video',owner:{name:'Author'},pages:[{page:1,cid:11},{page:2,cid:22,part:'Second',duration:80}]}})};
    if (target.pathname === '/x/player/wbi/v2') {
      assert.equal(target.searchParams.get('cid'), '22');
      return {ok:true,json:async()=>({code:0,data:{subtitle:{subtitles:[{lan:'zh-CN',subtitle_url:'https://aisubtitle.hdslb.com/fixture.json'}]}}})};
    }
    return {ok:true,json:async()=>({body:[{from:1.2,to:3.5,content:'第二部分字幕'}]})};
  });
  assert.equal(result.success, true);
  assert.equal(result.rows[0].start, 1.2);
  assert.equal(result.info.duration, 80);
  assert.match(result.info.title, /P2/);
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal(calls.at(-1).options.credentials, 'omit');
});

test('Bilibili missing subtitles explains login and never fabricates transcript', async () => {
  const url = 'https://www.bilibili.com/video/BV13x41117TL/';
  const result = await runCollector(url, platforms.parse(url), async input => ({ok:true,json:async()=>
    input.includes('web-interface') ? {code:0,data:{bvid:'BV13x41117TL',title:'Video',pages:[{page:1,cid:11}]}}
      : {code:0,data:{need_login_subtitle:true,subtitle:{subtitles:[]}}}}));
  assert.equal(result.success, false); assert.match(result.message, /登录/);
});

test('YouTube native transcript rejects stale player metadata and uses timedtext only', async () => {
  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const metadata = {videoDetails:{videoId:'dQw4w9WgXcQ',title:'Title',lengthSeconds:'10'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ',languageCode:'en'}]}}};
  const result = await runCollector(url, platforms.parse(url), async input => {
    assert.equal(new URL(input).searchParams.get('fmt'), 'json3');
    return {ok:true,text:async()=>JSON.stringify({events:[{tStartMs:1500,dDurationMs:2000,segs:[{utf8:'Hello '},{utf8:'world'}]}]})};
  }, metadata);
  assert.equal(result.rows[0].start,1.5); assert.equal(result.rows[0].text,'Hello world');
  const stale = await runCollector(url, platforms.parse(url), () => assert.fail('no request for a stale player'), {videoDetails:{videoId:'aaaaaaaaaaa'}});
  assert.equal(stale.error,'PAGE_CHANGED');
});
