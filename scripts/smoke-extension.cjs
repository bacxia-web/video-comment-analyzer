/* Actual unpacked extension, isolated Chromium profile, deterministic fake APIs.
 * npm install playwright locally or supply PLAYWRIGHT_MODULE. No real keys. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'panorama-smoke-'));

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 414, height: 900 },
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}/`;
    assert.equal((await worker.evaluate(() => chrome.runtime.getManifest())).version, '0.2.5');
    await worker.evaluate(() => {
      const originalFetch = fetch;
      globalThis.fixtureRequests = [];
      globalThis.fixtureDelay = 0;
      globalThis.fixtureXhsFailAt = '';
      globalThis.fetch = async (input, options = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url || input.href);
        if (url.protocol === 'chrome-extension:') return originalFetch(input, options);
        fixtureRequests.push({ url: url.href, body: options.body || '', auth: options.headers?.Authorization });
        const response = data => new Response(JSON.stringify(data), {status:200,headers:{'Content-Type':'application/json'}});
        const comment = (id, text) => ({id,snippet:{textOriginal:text,authorDisplayName:'Fixture author',likeCount:3}});
        if (url.hostname === 'www.googleapis.com') {
          if (url.pathname.endsWith('/comments')) return response({items:[comment('yt-reply-1','Reply one'),comment('yt-reply-2','Reply two')]});
          if (url.searchParams.has('pageToken')) return response({items:[{snippet:{topLevelComment:comment('yt-2','Second page comment'),totalReplyCount:0}}]});
          return response({items:[{snippet:{topLevelComment:comment('yt-1','Useful video <img src=x onerror=alert(1)>'),totalReplyCount:2},replies:{comments:[comment('yt-reply-1','Reply one')]}}],nextPageToken:'fixture-page-2'});
        }
        if (url.hostname === 'api.deepseek.com') {
          if (fixtureDelay) await new Promise(resolve => setTimeout(resolve, fixtureDelay));
          const body = JSON.parse(options.body);
          let input; try { input = JSON.parse(body.messages.at(-1).content); } catch {}
          if (input?.task === 'xhs_batch') {
            if (fixtureXhsFailAt === input.comments[0].id) {
              fixtureXhsFailAt = '';
              return new Response(JSON.stringify({error:{message:'Fixture temporary failure'}}),{status:503,headers:{'Content-Type':'application/json'}});
            }
            const titles=['认可实际使用效果','认为价格偏高','询问使用方式','对适用人群存在分歧'];
            const sentiments=['positive','negative','neutral','mixed'];
            const topics=new Map();
            const assignments=input.comments.map(row=>{
              const group=Number(row.id.split('-').at(-1))%4, id=`t${group}`;
              if(!topics.has(id))topics.set(id,{id,title:titles[group],sentiment:sentiments[group],summary:'评论围绕具体体验展开，保留不同意见并对照使用条件。',evidenceCommentIds:[row.id]});
              return {commentId:row.id,topicId:id};
            });
            const tags=['具体经历','信息补充','建设性建议','关键问题'];
            return response({choices:[{message:{content:JSON.stringify({summary:'大家主要关注使用效果和价格，部分用户认为值得购买，也有人提出不同体验。',topics:[...topics.values()],assignments,
              featured:input.comments.slice(0,4).map((row,i)=>({commentId:row.id,tag:tags[i],reason:'提供了具体的使用背景，便于对照不同观点。'}))})}}]});
          }
          if (input?.task === 'xhs_merge') {
            const grouped=new Map();
            input.topics.forEach(topic=>{
              if(!grouped.has(topic.title))grouped.set(topic.title,{title:topic.title,summary:topic.summary,sentiment:topic.sentiment,sourceTopicIds:[]});
              grouped.get(topic.title).sourceTopicIds.push(topic.id);
            });
            return response({choices:[{message:{content:JSON.stringify({summary:'大家主要关注使用效果和价格，部分用户认为值得购买，也有人提出不同体验。',topics:[...grouped.values()]})}}]});
          }
          const segmentIds = [...new Set([...body.messages.map(item=>item.content).join('\n').matchAll(/"id"\s*:\s*"(segment-[^"]+|ui-\d+)"/g)].map(match=>match[1]))];
          if (segmentIds.length) return response({choices:[{message:{content:JSON.stringify({segments:segmentIds.map(id=>({id,text:'翻译后的测试字幕。'}))})}}]});
          if (body.messages.some(message=>message.content.includes('SELECTED:'))) return response({choices:[{message:{content:'这是根据选中字幕给出的简短解释。'}}]});
          const isComments = body.messages.some(message => message.content.includes('COMMENTS (JSON Lines)'));
          const analysis = isComments ? {summary:'评论分析完成',overallSentiment:'mixed',topics:[{title:'主要主题',sentiment:'positive',summary:'来自实际采集评论',evidenceCommentIds:['yt-1','xhs-1','sq1','invented-id']}],viewerQuestions:['用户问题'],creatorFeedback:['建议内容']}
            : {chapters:[{title:'第一章节',summary:'视频字幕分析完成',timestampSeconds:0},{title:'第二章节',summary:'内容细节',timestampSeconds:5}],keyQuotes:[{quote:'fixture quote',timestampSeconds:5}],keyMoments:[0,5]};
          return response({choices:[{message:{content:JSON.stringify(analysis)}}]});
        }
        if (url.hostname === 'api.supadata.ai') return response({content:[{text:'Fallback native subtitle',offset:0,duration:9000}],lang:'en'});
        throw new Error('Unexpected outbound request in test');
      };
    });
    await context.route('https://**/*', async route => {
      const url = new URL(route.request().url());
      const json = data => route.fulfill({json:data,headers:{'Access-Control-Allow-Origin':'https://www.bilibili.com','Access-Control-Allow-Credentials':'true'}});
      if (url.pathname === '/api/timedtext') return json({events:url.searchParams.get('v')==='aqz-KE-bpKQ'
        ? Array.from({length:20},(_,i)=>({tStartMs:i*15000,dDurationMs:15000,segs:[{utf8:`Part ${i+1} explains useful thinking practices for taking better study notes and checking original evidence before drawing conclusions.`}]}))
        : [{tStartMs:0,dDurationMs:5000,segs:[{utf8:'First transcript line'}]},{tStartMs:5000,dDurationMs:5000,segs:[{utf8:'Second transcript line'}]}]});
      if (url.hostname === 'api.bilibili.com') {
        if (url.pathname.endsWith('/view')) return json({code:0,data:{bvid:'BV13x41117TL',title:'B站测试视频',owner:{name:'UP主'},pages:[{page:1,cid:101,duration:10,part:'第一部分'},{page:2,cid:202,duration:10,part:'第二部分'}]}});
        assert.equal(url.searchParams.get('cid'),'202');
        return json({code:0,data:{subtitle:{subtitles:[{lan:'zh-CN',subtitle_url:'https://aisubtitle.hdslb.com/fixture.json'}]}}});
      }
      if (url.hostname.endsWith('.hdslb.com')) return json({body:[{from:0,to:5,content:'第二部分第一句'},{from:5,to:10,content:'第二部分第二句'}]});
      if (url.hostname === 'xueqiu.com' && url.pathname.endsWith('comments.json')) return json({comments:[{id:'sq1',text:'<b>雪球评论</b>',user:{screen_name:'雪球用户'},like_count:2}],next_max_id:0});
      if (route.request().resourceType() !== 'document') return route.abort();
      let body = '<h1>Fixture</h1>';
      if (url.hostname.endsWith('youtube.com')) body = `<h1 class="ytd-watch-metadata">YouTube fixture</h1><video></video><script>window.ytInitialPlayerResponse={videoDetails:{videoId:'${url.searchParams.get('v')}',title:'YouTube fixture',author:'Creator',lengthSeconds:'10'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{languageCode:'en',baseUrl:'https://www.youtube.com/api/timedtext?v=${url.searchParams.get('v')}'}]}}};</script>`;
      if (url.hostname === 'www.bilibili.com') body = '<h1 class="video-title">B站测试视频</h1><video></video>';
      if (url.hostname === 'www.xiaohongshu.com') body = `<div class="note-detail-mask"><h1 id="detail-title">小红书测试笔记</h1><div class="note-scroller" style="height:300px;overflow:auto"><div class="comments-container"><div class="parent-comment"><div class="comment-item" data-id="1"><div class="author"><span class="name">作者甲</span></div><div class="content"><span class="note-text">真实评论 &lt;img src=x onerror=alert(1)&gt;</span></div><div class="like"><span class="count">1.2万</span></div></div></div><div class="comment-item" data-id="2"><div class="author"><span class="name">作者乙</span></div><div class="content">第二条评论</div></div><div class="comment-item" data-id="2"><div class="content">第二条评论</div></div><div class="reply-more">展开 1 条回复</div></div></div></div><script>document.querySelector('.reply-more').onclick=()=>{const item=document.createElement('div');item.className='comment-item-sub';item.innerHTML='<div class="author"><span class="name">回复者</span></div><div class="content">新增回复</div>';document.querySelector('.comments-container').append(item);document.querySelector('.reply-more').remove();};</script>`;
      const headers = url.searchParams.has('strict') ? {'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; require-trusted-types-for 'script'"} : {};
      return route.fulfill({contentType:'text/html; charset=utf-8',headers,body:`<!doctype html><html><head><title>Fixture</title></head><body>${body}</body></html>`});
    });

    const settings = await context.newPage();
    await settings.goto(base + 'preferences.html');
    await settings.locator('#deepseekKey').waitFor();
    assert.equal(await settings.locator('dialog').count(),0);
    assert.equal(await settings.locator('#youtubeKey').isVisible(),true);
    assert.equal(await settings.locator('#deepseekKey').evaluate(input=>input.required),true);
    assert.equal(await settings.locator('#youtubeKey').evaluate(input=>input.required),false);
    assert.match(await settings.locator('label[for=youtubeKey]').textContent(),/YouTube Data API Key.*可选/);
    assert.match(await settings.locator('#youtubeQuota').textContent(),/10,000/);
    await settings.locator('#optionalServices summary').click();
    assert.match(await settings.locator('#supadataQuota').textContent(),/每月 100 积分/);
    const [signup] = await Promise.all([settings.waitForEvent('popup'),settings.getByRole('link',{name:'申请 DeepSeek API Key ↗'}).click()]);
    await signup.waitForLoadState(); assert.equal(signup.url(),'https://platform.deepseek.com/api_keys');
    assert.equal(await signup.evaluate(()=>window.opener),null); await signup.close();
    await settings.locator('#preferencesForm button[type=submit]').click();
    assert.equal(await settings.locator('#deepseekKey').evaluate(input=>input.validity.valueMissing),true);
    assert.equal((await worker.evaluate(()=>chrome.storage.local.get('ytd_settings'))).ytd_settings,undefined);
    await settings.locator('#deepseekKey').fill('fixture-first-key');
    await settings.locator('#preferencesForm button[type=submit]').click();
    await settings.waitForFunction(()=>document.getElementById('saveStatus').textContent.includes('设置已保存'));
    const saved=await worker.evaluate(()=>chrome.storage.local.get('ytd_settings'));
    assert.equal(saved.ytd_settings.aiApiKey,'fixture-first-key');
    assert.equal(saved.ytd_settings.youtubeApiKey,'');
    await settings.reload();
    await settings.waitForFunction(()=>document.getElementById('deepseekKey').value==='fixture-first-key');
    assert.equal(await settings.locator('dialog').count(),0);
    await settings.locator('#deepseekKey').fill('   ');
    await settings.locator('#preferencesForm button[type=submit]').click();
    await settings.waitForFunction(()=>document.getElementById('saveStatus').textContent.includes('必填'));
    assert.equal((await worker.evaluate(()=>chrome.storage.local.get('ytd_settings'))).ytd_settings.aiApiKey,'fixture-first-key');
    await settings.locator('#deepseekKey').fill('fixture-updated-key');
    await settings.locator('#preferencesForm button[type=submit]').click();
    await settings.waitForFunction(()=>document.getElementById('saveStatus').textContent.includes('设置已保存'));
    assert.equal((await worker.evaluate(()=>chrome.storage.local.get('ytd_settings'))).ytd_settings.aiApiKey,'fixture-updated-key');
    await settings.locator('#optionalServices summary').click();
    await settings.screenshot({path:path.join(os.tmpdir(),'video-comment-analyzer-settings.png'),fullPage:true,animations:'disabled'});
    console.log('PASS settings page without dialog, required DeepSeek, optional YouTube, application link and validation');

    const legacySettings = await context.newPage();
    await legacySettings.goto(base + 'options.html');
    await legacySettings.locator('[data-language="zh-CN"]').click();
    assert.match(await legacySettings.locator('label[for=youtubeApiKey]').textContent(),/可选/);
    assert.match(await legacySettings.locator('#supadataQuota').textContent(),/每月 100 积分/);
    assert.match(await legacySettings.locator('#youtubeApiKey').getAttribute('placeholder'),/粘贴/);
    await legacySettings.screenshot({path:path.join(os.tmpdir(),'video-comment-analyzer-advanced-settings.png'),fullPage:true,animations:'disabled'});
    await legacySettings.locator('[data-language=en]').click();
    assert.match(await legacySettings.locator('label[for=youtubeApiKey]').textContent(),/optional/);
    assert.match(await legacySettings.locator('#youtubeQuota').textContent(),/10,000/);
    await legacySettings.close();

    const launcherPage = await context.newPage();
    const launcherErrors = []; launcherPage.on('pageerror',error=>launcherErrors.push(error.message));
    await launcherPage.goto('https://www.youtube.com/');
    await launcherPage.locator('#vca-launcher').waitFor({state:'attached'});
    assert.equal(await launcherPage.locator('#vca-open').isVisible(),false);
    // Real SPA history change: no document reload or custom extension event.
    await launcherPage.evaluate(()=>history.pushState({},'', '/watch?v=dQw4w9WgXcQ'));
    await launcherPage.locator('#vca-open').waitFor({state:'visible'});
    const bounds = await launcherPage.locator('#vca-open').boundingBox();
    assert.ok(bounds.x > 300 && bounds.y > 800 && bounds.width === 56);
    await launcherPage.locator('#vca-open').hover();
    await launcherPage.screenshot({path:path.join(os.tmpdir(),'video-comment-analyzer-launcher.png'),fullPage:true,animations:'disabled'});
    await worker.evaluate(()=>{
      const originalOpen = chrome.sidePanel.open.bind(chrome.sidePanel);
      globalThis.fixturePanelOpens = [];
      chrome.sidePanel.open = async options => { await originalOpen(options); fixturePanelOpens.push(options); };
    });
    await launcherPage.locator('#vca-open').click();
    await launcherPage.waitForFunction(()=>!document.querySelector('#vca-launcher').shadowRoot.querySelector('#vca-open').disabled);
    assert.doesNotMatch(await launcherPage.locator('#vca-tip').textContent(),/失败/);
    assert.equal(await worker.evaluate(()=>fixturePanelOpens.length),1);
    assert.equal(await worker.evaluate(()=>fixtureRequests.length),0,'Opening the launcher must not collect or spend credits');
    await launcherPage.locator('#vca-open').hover();
    await launcherPage.locator('#vca-dismiss').click();
    assert.equal(await launcherPage.locator('#vca-open').isVisible(),false);
    await launcherPage.evaluate(()=>history.pushState({},'', '/watch?v=abcdefghijk'));
    await launcherPage.locator('#vca-open').waitFor({state:'visible'});
    await launcherPage.evaluate(()=>document.getElementById('vca-launcher').remove());
    await launcherPage.locator('#vca-open').waitFor({state:'visible'});
    assert.equal(await launcherPage.locator('#vca-launcher').count(),1);
    // A real user gesture enters fullscreen; the launcher must stay out of it.
    await launcherPage.evaluate(()=>{
      const button=document.createElement('button'); button.id='fixture-fullscreen'; button.textContent='Fullscreen';
      button.onclick=()=>document.documentElement.requestFullscreen(); document.body.append(button);
    });
    await launcherPage.locator('#fixture-fullscreen').click();
    await launcherPage.waitForFunction(()=>!!document.fullscreenElement);
    await launcherPage.locator('#vca-open').waitFor({state:'hidden'});
    await launcherPage.evaluate(()=>document.exitFullscreen());
    await launcherPage.locator('#vca-open').waitFor({state:'visible'});
    await launcherPage.evaluate(()=>history.pushState({},'', '/'));
    await launcherPage.locator('#vca-open').waitFor({state:'hidden'});
    await launcherPage.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ&strict=1');
    await launcherPage.locator('#vca-open').waitFor({state:'visible'});
    assert.equal((await launcherPage.locator('#vca-open').boundingBox()).width,56,'Launcher styles survive a strict page CSP');
    await worker.evaluate(async()=>{
      const tab=(await chrome.tabs.query({url:'https://www.youtube.com/watch*'}))[0];
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:['launcher.js']});
    });
    assert.equal(await launcherPage.locator('#vca-launcher').count(),1,'Reinjection does not duplicate the launcher');
    await launcherPage.goto('https://example.com/watch?v=dQw4w9WgXcQ');
    assert.equal(await launcherPage.locator('#vca-launcher').count(),0);
    assert.deepEqual(launcherErrors,[]);
    await launcherPage.close();
    console.log('PASS floating launcher opens the real Chrome side panel without API calls; SPA routes, dismiss, fullscreen and unsupported pages');

    const page = await context.newPage();
    await page.bringToFront();
    await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await page.locator('#vca-open').waitFor({state:'visible'});
    const tabId = await worker.evaluate(async()=> (await chrome.tabs.query({url:'https://www.youtube.com/watch*'}))[0].id);
    // The test opens panel.html as a tab; simulate only the side-panel active-tab query.
    // Collection, storage, extension messaging, script worlds, and AI parsing remain real.
    await context.addInitScript(({base,tabId})=>{
      if (location.href.startsWith(base) && chrome.tabs) chrome.tabs.query=async()=>[await chrome.tabs.get(tabId)];
    },{base,tabId});
    const panel = await context.newPage();
    const pageErrors = []; panel.on('pageerror',error=>pageErrors.push(error.message));
    await panel.goto(base+'panel.html');
    await panel.waitForURL(base+'sidepanel.html');
    await panel.locator('#transcriptList .transcript-entry').first().waitFor();
    assert.equal(await worker.evaluate(async id=>(await chrome.sidePanel.getOptions({tabId:id})).path,tabId),'sidepanel.html');
    assert.deepEqual(await panel.locator('#tabsNav .tab').allTextContents(),['视频字幕','AI 摘要','评论分析','片段笔记']);
    assert.match(await panel.locator('#transcriptSourceBadge').textContent(),/YouTube 网站字幕.*原文/);
    assert.equal(await worker.evaluate(()=>fixtureRequests.filter(item=>item.url.includes('supadata')).length),0);
    await worker.evaluate(async()=>{
      const saved=await chrome.storage.local.get('ytd_settings');
      await chrome.storage.local.set({ytd_settings:{...saved.ytd_settings,aiApiKey:''}});
    });
    await panel.bringToFront();
    await panel.locator('[data-tab=overview]').click();
    let activeUrl='';
    for (let attempt=0;attempt<30;attempt++) {
      activeUrl=await worker.evaluate(async()=> (await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0]?.url);
      if (activeUrl===base+'preferences.html') break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(activeUrl,base+'preferences.html');
    assert.equal(await panel.locator('dialog').count(),0);
    assert.equal(await worker.evaluate(()=>fixtureRequests.filter(item=>item.url.includes('deepseek')).length),0);
    await worker.evaluate(async()=>{
      const saved=await chrome.storage.local.get('ytd_settings');
      await chrome.storage.local.set({ytd_settings:{...saved.ytd_settings,aiApiKey:'fixture-updated-key'}});
    });
    await panel.bringToFront();
    console.log('PASS YouTube default entry exposes all four tabs; missing DeepSeek opens settings without a dialog or AI request');
    await panel.locator('[data-tab=overview]').click();
    await panel.locator('#chapterList .chapter-title').first().waitFor();
    assert.match(await panel.locator('#chapterList').textContent(),/视频字幕分析完成/);
    assert.equal(await worker.evaluate(()=>fixtureRequests.filter(item=>item.url.includes('deepseek')).at(-1).auth),'Bearer fixture-updated-key');
    await panel.locator('.chapter-item').first().click();
    const [summaryDownload]=await Promise.all([panel.waitForEvent('download'),panel.locator('#exportOverviewBtn').click()]);
    assert.match(fs.readFileSync(await summaryDownload.path(),'utf8'),/视频字幕分析完成/);
    console.log('PASS native YouTube transcript, DeepSeek summary, persisted updated key, timestamp action and report export');

    await panel.locator('[data-tab=comments]').click();
    await panel.locator('#commentFetchBtn').click();
    await panel.waitForFunction(()=>document.getElementById('commentsStatus').textContent.includes('请在设置中填写该可选项'));
    await settings.locator('#youtubeKey').fill('fixture-google-key');
    await settings.locator('#preferencesForm button[type=submit]').click();
    await settings.waitForFunction(()=>document.getElementById('saveStatus').textContent.includes('设置已保存'));
    await panel.locator('#commentFetchBtn').click();
    await panel.waitForFunction(()=>document.getElementById('commentsStatus').textContent.startsWith('已获取'));
    await panel.locator('#commentAnalyzeBtn').click();
    await panel.waitForFunction(()=>document.getElementById('commentsStatus').textContent.startsWith('评论分析完成'));
    assert.equal(await panel.locator('#commentStats .comment-stat-value').first().textContent(),'4');
    assert.equal(await panel.locator('#commentAnalysis img').count(),0);
    assert.match(await panel.locator('#commentAnalysis').textContent(),/<img src=x/);
    assert.equal(await panel.locator('#commentAnalysis').textContent().then(text=>text.includes('invented-id')),false);
    const calls=await worker.evaluate(()=>fixtureRequests.filter(item=>item.url.includes('googleapis')).map(item=>item.url));
    assert.equal(calls.length,3); assert.ok(calls.some(url=>url.includes('pageToken=fixture-page-2')));
    const [commentsDownload]=await Promise.all([panel.waitForEvent('download'),panel.locator('#exportCommentsBtn').click()]);
    assert.equal(JSON.parse(fs.readFileSync(await commentsDownload.path(),'utf8')).comments.length,4);
    console.log('PASS optional Google key, official comment API pagination/replies, source evidence, HTML escaping and comment export');

    await page.bringToFront();
    await page.goto('https://www.bilibili.com/video/BV13x41117TL/?p=2');
    await page.locator('#vca-open').waitFor({state:'visible'});
    assert.match(await page.locator('#vca-tip').textContent(),/哔哩哔哩.*字幕/);
    await panel.waitForURL(base+'panel.html');
    await panel.waitForFunction(()=>document.getElementById('platform').textContent==='哔哩哔哩');
    assert.equal(await panel.locator('#results').isVisible(),false);
    assert.equal(await panel.locator('[data-mode=comments]').isDisabled(),true);
    await panel.locator('#analyze').click();
    await panel.waitForFunction(()=>document.getElementById('status').textContent.startsWith('分析完成'));
    assert.match(await panel.locator('#title').textContent(),/P2/);
    assert.match(await panel.locator('#rawContent').textContent(),/第二部分第一句/);
    console.log('PASS Bilibili current-part subtitles and video analysis in the same panel');

    await page.bringToFront();
    await page.goto('https://www.xiaohongshu.com/explore/1234567890abcdef12345678');
    await page.locator('#vca-open').waitFor({state:'visible'});
    assert.match(await page.locator('#vca-tip').textContent(),/小红书.*评论/);
    await panel.waitForFunction(()=>document.getElementById('platform').textContent==='小红书');
    await panel.locator('#analyze').click();
    await panel.waitForFunction(()=>document.getElementById('status').textContent.startsWith('分析完成'),null,{timeout:30000});
    assert.match(await panel.locator('#status').textContent(),/3 条评论/);
    assert.equal(await panel.locator('#title').textContent(),'小红书测试笔记');
    assert.match(await panel.locator('#results').textContent(),/12,000 赞/);
    assert.equal(await panel.locator('#results img').count(),0);
    const [download]=await Promise.all([panel.waitForEvent('download'),panel.locator('#exportData').click()]);
    const exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.equal(exported.comments.length,3); assert.ok(!JSON.stringify(exported).includes('fixture-updated-key'));
    console.log('PASS reused XHS DOM selectors, expansion, wrapper/duplicate filtering, like counts and key-free export');

    await settings.locator('#xiaohongshuSettings summary').click();
    await settings.locator('#xhsMaxComments').fill('5001');
    await settings.locator('#xhsSettingsForm button[type=submit]').click();
    assert.equal(await settings.locator('#xhsMaxComments').evaluate(input=>input.validity.rangeOverflow),true);
    await settings.locator('#xhsMaxComments').fill('100');
    await settings.locator('#xhsMaxRounds').fill('5');
    await settings.locator('#xhsIdleRounds').fill('2');
    await settings.locator('#xhsSettingsForm button[type=submit]').click();
    await settings.waitForFunction(()=>document.getElementById('xhsSaveStatus').textContent.includes('已保存'));
    await settings.reload(); await settings.locator('#xiaohongshuSettings summary').click();
    assert.equal(await settings.locator('#xhsMaxComments').inputValue(),'100');
    assert.equal((await worker.evaluate(()=>chrome.storage.local.get('ytd_settings'))).ytd_settings.aiApiKey,'fixture-updated-key');
    const fillXhs=async count=>page.evaluate(count=>{
      const container=document.querySelector('.comments-container');container.replaceChildren();
      for(let i=1;i<=count;i++){
        const item=document.createElement('div');item.className='comment-item';item.dataset.id=String(i);
        const author=document.createElement('div');author.className='author';const name=document.createElement('span');name.className='name';name.textContent=`体验用户 ${i}`;author.append(name);
        const content=document.createElement('div');content.className='content';content.textContent=`第 ${i} 条：用了两周后，我更关注实际效果和日常使用成本，希望补充不同场景下的体验。`;
        item.append(author,content);container.append(item);
      }
    },count);
    await fillXhs(431);
    const requestsBeforeCollect=await worker.evaluate(()=>fixtureRequests.length);
    await panel.locator('#collect').click();
    await panel.waitForFunction(()=>document.getElementById('status').textContent.includes('100 条上限'));
    assert.match(await panel.locator('#xhsProgressText').textContent(),/100 条/);
    assert.equal(await worker.evaluate(()=>fixtureRequests.length),requestsBeforeCollect);
    await panel.evaluate(async()=>{
      const query=chrome.tabs.query;
      chrome.tabs.query=async()=>[{id:999,url:chrome.runtime.getURL('preferences.html')+'#xiaohongshuSettings'}];
      await refreshContext(); chrome.tabs.query=query;
      if(state.data?.comments.length!==100)throw new Error('Opening collection settings must preserve collected comments');
      await refreshContext();
    });
    await panel.locator('#continueCollect').click();
    await panel.waitForFunction(()=>document.getElementById('status').textContent.includes('调高上限'));
    await settings.locator('#xhsMaxComments').fill('600');
    await settings.locator('#xhsSettingsForm button[type=submit]').click();
    await settings.waitForFunction(()=>document.getElementById('xhsSaveStatus').textContent.includes('已保存'));
    await panel.locator('#continueCollect').click();
    await panel.waitForFunction(()=>document.getElementById('analyze').textContent.includes('431')&&!document.getElementById('analyze').disabled);
    assert.match(await panel.locator('#xhsProgressText').textContent(),/431 条/);
    assert.equal(await worker.evaluate(()=>fixtureRequests.length),requestsBeforeCollect);
    await panel.evaluate(()=>{
      window.fixtureProgress=[];
      chrome.runtime.onMessage.addListener(message=>{if(message.action==='mediaProgress')fixtureProgress.push(message);});
    });
    await worker.evaluate(()=>{fixtureXhsFailAt='xhs-121';fixtureDelay=350;});
    await panel.locator('#analyze').click();
    await panel.waitForFunction(()=>document.getElementById('xhsProgressText').textContent.includes('60 / 431'));
    await panel.screenshot({path:path.join(os.tmpdir(),'video-comment-analyzer-xhs-progress.png'),fullPage:true,animations:'disabled'});
    await panel.waitForFunction(()=>document.getElementById('analyze').textContent==='重试分析'&&!document.getElementById('analyze').disabled);
    assert.match(await panel.locator('#xhsProgressText').textContent(),/120 \/ 431/);
    await panel.locator('#analyze').click();
    await panel.waitForFunction(()=>document.getElementById('status').textContent.startsWith('分析完成'),null,{timeout:30000});
    await worker.evaluate(()=>{fixtureDelay=0;});
    assert.deepEqual(await panel.locator('.xhs-metrics dd').allTextContents(),['431','431','4','8']);
    const analyzed=await panel.evaluate(()=>fixtureProgress.filter(p=>p.phase==='analyze').map(p=>p.analyzed));
    assert.ok(analyzed.includes(60)&&analyzed.includes(120)&&analyzed.includes(431));
    const batchStarts=await worker.evaluate(offset=>fixtureRequests.slice(offset).map(r=>{try{return JSON.parse(JSON.parse(r.body).messages.at(-1).content);}catch{return {};}}).filter(r=>r.task==='xhs_batch').map(r=>r.comments[0].id),requestsBeforeCollect);
    assert.equal(batchStarts.filter(id=>id==='xhs-1').length,1,'retry must reuse a successful batch');
    assert.equal(batchStarts.filter(id=>id==='xhs-121').length,2,'retry repeats only failed/unprocessed work');
    assert.equal(await panel.locator('#xhsTopics .xhs-topic').count(),4);
    assert.equal(await panel.locator('#xhsFeatured .xhs-featured').count(),8);
    for (const width of [320,375,414,768]) {
      await panel.setViewportSize({width,height:900});
      assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`XHS result overflow at ${width}`);
    }
    await panel.setViewportSize({width:414,height:900});
    const [reportDownload]=await Promise.all([panel.waitForEvent('download'),panel.locator('#exportReport').click()]);
    const report=fs.readFileSync(await reportDownload.path(),'utf8');
    assert.match(report,/实际分析 431 条/);assert.match(report,/入选理由/);assert.match(report,/议题态度/);
    await panel.evaluate(()=>window.scrollTo(0,0));
    await panel.screenshot({path:path.join(os.tmpdir(),'video-comment-analyzer-xhs-results.png'),fullPage:true,animations:'disabled'});
    await panel.screenshot({path:path.join(os.tmpdir(),'video-comment-analyzer-xhs-overview.png'),animations:'disabled'});
    await settings.screenshot({path:path.join(os.tmpdir(),'video-comment-analyzer-xhs-settings.png'),fullPage:true,animations:'disabled'});
    console.log('PASS adjustable XHS limits, pause/continue with deduplication, 431-comment full analysis, progress, resume after failure, topic counts, featured comments and report export');

    await fillXhs(12); await panel.reload();
    await panel.waitForFunction(()=>!document.getElementById('analyze').disabled);
    await panel.locator('#analyze').click();
    await panel.waitForFunction(()=>document.getElementById('xhsProgressText').textContent.includes('12 条'));
    await panel.locator('#stopCollect').click();
    await panel.waitForFunction(()=>document.getElementById('status').textContent.startsWith('分析完成'));
    assert.match(await panel.locator('#status').textContent(),/按你的操作停止/);
    assert.deepEqual((await panel.locator('.xhs-metrics dd').allTextContents()).slice(0,2),['12','12']);
    await page.evaluate(()=>{const captcha=document.createElement('div');captcha.id='captcha';captcha.textContent='请完成验证';document.body.append(captcha);});
    const beforeBlocked=await worker.evaluate(()=>fixtureRequests.length);
    await panel.locator('#collect').click();
    await panel.waitForFunction(()=>document.getElementById('status').textContent.includes('出现验证'));
    assert.equal(await worker.evaluate(()=>fixtureRequests.length),beforeBlocked);
    assert.match(await panel.locator('#xhsProgressText').textContent(),/0 条/);
    await page.evaluate(()=>document.getElementById('captcha').remove());
    await panel.locator('#continueCollect').click();
    await panel.waitForFunction(()=>document.getElementById('analyze').textContent.includes('12')&&!document.getElementById('analyze').disabled);
    assert.match(await panel.locator('#status').textContent(),/连续 2 轮/);
    console.log('PASS stop-and-analyze partial comments, visible verification pause and configured idle threshold');

    for (const width of [320,375,414,768]) {
      await panel.setViewportSize({width,height:900});
      const dimensions=await panel.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
      assert.ok(dimensions.scroll<=dimensions.width,`horizontal overflow at ${width}`);
    }
    await panel.setViewportSize({width:414,height:900});
    await panel.screenshot({path:path.join(os.tmpdir(),'panorama-panel-smoke.png'),fullPage:true,animations:'disabled'});
    console.log('PASS panel layout at 320, 375, 414 and 768 pixels');

    await page.bringToFront();
    await page.goto('https://xueqiu.com/123/456');
    await page.locator('#vca-open').waitFor({state:'visible'});
    await panel.waitForFunction(()=>document.getElementById('platform').textContent==='雪球');
    await panel.locator('#collect').click();
    await panel.waitForFunction(()=>document.getElementById('status').textContent.startsWith('内容已获取'));
    assert.match(await panel.locator('#rawContent').textContent(),/雪球评论/);
    console.log('PASS retained Xueqiu comments');

    await worker.evaluate(()=>chrome.storage.local.remove('digest_dQw4w9WgXcQ'));
    await page.bringToFront();
    await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await panel.waitForURL(base+'sidepanel.html');
    await panel.locator('#transcriptList .transcript-entry').first().waitFor();
    await worker.evaluate(()=>{fixtureDelay=1500;});
    await panel.locator('[data-tab=overview]').click();
    await panel.waitForFunction(()=>document.getElementById('chapterList').textContent.includes('DeepSeek 正在生成'));
    await page.bringToFront();
    await page.goto('https://www.bilibili.com/video/BV13x41117TL/?p=1');
    await panel.waitForURL(base+'panel.html');
    await panel.waitForFunction(()=>document.getElementById('platform').textContent==='哔哩哔哩');
    await panel.waitForTimeout(1800);
    assert.equal(await panel.locator('#results').isVisible(),false);
    assert.equal(await panel.locator('#analyze').isDisabled(),false);
    assert.deepEqual(pageErrors,[]);
    console.log('PASS navigation discards a late analysis response and leaves the new page usable');

    await worker.evaluate(async()=>{
      fixtureDelay=0;
      const saved=await chrome.storage.local.get('ytd_settings');
      await chrome.storage.local.set({ytd_settings:{...saved.ytd_settings,supadataApiKey:'fixture-subtitle-key'},ytd_notes:[{
        id:'fixture-note',videoId:'dQw4w9WgXcQ',videoTitle:'测试视频',text:'已经保存的片段笔记。',timestamp:'0:05',timestampSeconds:5,
        timestampedUrl:'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5s'
      }]});
    });
    await page.bringToFront();
    await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    // This UI is hosted in a tab for inspection. A native side panel does not
    // become an active chrome-extension: tab when a tester clicks its controls.
    const learning = panel;
    learning.on('pageerror',error=>pageErrors.push(error.message));
    await learning.waitForURL(base+'sidepanel.html');
    await learning.locator('#transcriptList .transcript-entry').first().waitFor();
    await learning.screenshot({path:path.join(os.tmpdir(),'video-comment-analyzer-subtitle-study.png'),fullPage:true,animations:'disabled'});
    await learning.locator('#transcriptSearch').fill('TRANSCRIPT LINE');
    await learning.waitForFunction(()=>document.getElementById('transcriptSearchCount').textContent==='1 / 2');
    await learning.locator('#transcriptSearchNext').click();
    assert.equal(await learning.locator('#transcriptSearchCount').textContent(),'2 / 2');
    await learning.locator('#transcriptSearch').press('Shift+Enter');
    assert.equal(await learning.locator('#transcriptSearchCount').textContent(),'1 / 2');
    await learning.locator('#transcriptSearch').fill('[');
    assert.equal(await learning.locator('#transcriptSearchCount').textContent(),'未找到');
    await learning.locator('#transcriptSearch').press('Escape');
    assert.equal(await learning.locator('mark.transcript-match').count(),0);
    const selectTranscript = async()=>learning.evaluate(()=>{
      const field=document.querySelector('#transcriptList .transcript-text');
      const range=document.createRange();range.setStart(field.firstChild,0);range.setEnd(field.firstChild,5);
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      field.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    });
    const beforeSelectedNote=await worker.evaluate(()=>fixtureRequests.length);
    await selectTranscript();
    await learning.locator('.selection-note-btn').click();
    await learning.waitForFunction(()=>document.querySelector('.selection-note-btn').textContent==='已保存');
    const selectedNote=await worker.evaluate(async()=> (await chrome.storage.local.get('ytd_notes')).ytd_notes.find(note=>note.rawText==='First'));
    assert.equal(selectedNote.text,'First');assert.equal(selectedNote.timestampSeconds,0);
    assert.equal(await worker.evaluate(()=>fixtureRequests.length),beforeSelectedNote,'Saving a selection must not call AI or Supadata');
    await selectTranscript();
    await learning.locator('.explain-btn').click();
    await learning.waitForFunction(()=>document.getElementById('explanationContent')?.textContent.includes('简短解释'));
    await learning.locator('#closeExplain').click();
    console.log('PASS transcript search, match navigation, literal queries, selection explanation and exact timestamped notes without AI costs');
    await learning.locator('[data-tab=overview]').click();
    await learning.locator('#chapterList .chapter-title').first().waitFor();
    await learning.locator('[data-tab=comments]').click();
    await learning.locator('#commentFetchBtn').click();
    await learning.waitForFunction(()=>document.getElementById('commentsStatus').textContent.startsWith('已获取'));
    await learning.locator('#commentAnalyzeBtn').click();
    await learning.waitForFunction(()=>document.getElementById('commentsStatus').textContent.startsWith('评论分析完成'));
    assert.equal(await learning.locator('#commentSentiment').textContent(),'褒贬不一');
    await learning.locator('[data-tab=notes]').click();
    await learning.locator('.note-copy-link').first().waitFor();
    await learning.screenshot({path:path.join(os.tmpdir(),'video-comment-analyzer-notes.png'),fullPage:true,animations:'disabled'});
    await learning.locator('[data-tab=transcript]').click();
    await learning.locator('[data-language-mode=bilingual]').click();
    await learning.waitForFunction(()=>document.querySelector('#transcriptList .transcript-translation')?.textContent==='翻译后的测试字幕。');
    assert.match(await learning.locator('#transcriptList .transcript-original').first().textContent(),/First transcript/);
    await learning.screenshot({path:path.join(os.tmpdir(),'video-comment-analyzer-youtube-bilingual.png'),fullPage:true,animations:'disabled'});
    await learning.locator('[data-language-mode=zh]').click();
    await learning.waitForFunction(()=>document.querySelector('#transcriptList .transcript-translation')?.textContent==='翻译后的测试字幕。');
    assert.equal(await learning.locator('#transcriptList .transcript-original').count(),0);
    await learning.locator('[data-language-mode=bilingual]').click();
    for (const width of [320,414,768]) {
      await learning.setViewportSize({width,height:900});
      assert.ok(await learning.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`learning layout overflow at ${width}`);
    }
    await learning.setViewportSize({width:414,height:900});
    await learning.locator('[data-language-mode=original]').click();
    await worker.evaluate(async()=>{
      const saved=await chrome.storage.local.get('ytd_settings');
      await chrome.storage.local.set({ytd_settings:{...saved.ytd_settings,aiApiKey:''}});
    });
    await learning.locator('[data-tab=comments]').click();
    await learning.locator('#commentAnalyzeBtn').click();
    await learning.waitForFunction(()=>document.getElementById('commentsStatus').textContent.includes('填写 DeepSeek API Key'));
    assert.doesNotMatch(await learning.locator('#commentsStatus').textContent(),/NO_AI_KEY/);
    assert.deepEqual(pageErrors,[]);
    console.log('PASS subtitle study, summary, comments, clip notes and bilingual translation; responsive Chinese copy and actionable missing-key message');

    await worker.evaluate(async()=>{
      const saved=await chrome.storage.local.get('ytd_settings');
      await chrome.storage.local.set({ytd_settings:{...saved.ytd_settings,aiApiKey:'fixture-updated-key'}});
    });
    await learning.bringToFront();
    await learning.locator('[data-tab=transcript]').click();
    await learning.locator('[data-language-mode=bilingual]').click();
    await learning.waitForFunction(()=>!document.getElementById('langSpinner').classList.contains('visible'));
    const beforeNewVideo=await worker.evaluate(()=>fixtureRequests.length);
    await page.bringToFront();
    await page.goto('https://www.youtube.com/watch?v=M7lc1UVf-VE');
    await learning.waitForFunction(()=>currentVideoId==='M7lc1UVf-VE'&&currentTranscript?.length);
    assert.equal(await learning.locator('[data-language-mode=original]').getAttribute('aria-pressed'),'true');
    assert.equal(await worker.evaluate(()=>fixtureRequests.length),beforeNewVideo,'New videos must start in original without auto translation or Supadata');
    await page.evaluate(()=>{delete window.ytInitialPlayerResponse.captions;});
    await worker.evaluate(()=>chrome.storage.local.remove('digest_M7lc1UVf-VE'));
    await learning.reload();
    await learning.waitForFunction(()=>document.getElementById('transcriptNoticeText').textContent.includes('未能读取'));
    assert.equal(await learning.locator('#tabsNav .tab:visible').count(),4,'No subtitles must not hide comments and notes');
    assert.equal(await worker.evaluate(()=>fixtureRequests.length),beforeNewVideo);
    await learning.locator('#transcriptFetchBtn').click();
    await learning.waitForFunction(()=>document.getElementById('transcriptSourceBadge')?.textContent.includes('Supadata'));
    assert.match(await learning.locator('#transcriptList').textContent(),/Fallback native subtitle/);
    assert.equal(await worker.evaluate(()=>fixtureRequests.filter(item=>item.url.includes('supadata')).length),1);
    console.log('PASS new-video original default, no-subtitle independent tabs and explicit optional Supadata fallback');
    await page.bringToFront();
    await page.goto('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    await learning.waitForFunction(()=>currentVideoId==='aqz-KE-bpKQ'&&currentTranscript?.length===20);
    await learning.locator('#transcriptSearch').fill('Part 15');
    await learning.locator('#transcriptSearch').press('Escape');
    const readingScroll=await learning.locator('#contentArea').evaluate(el=>el.scrollTop);
    assert.ok(readingScroll>500);
    const readingAnchor=await learning.evaluate(()=>captureTranscriptPosition());
    await learning.locator('[data-tab=notes]').click();
    await learning.locator('[data-tab=transcript]').click();
    assert.ok(Math.abs(await learning.locator('#contentArea').evaluate(el=>el.scrollTop)-readingScroll)<3);
    await learning.locator('[data-language-mode=bilingual]').click();
    await learning.waitForFunction(()=>!document.getElementById('langSpinner').classList.contains('visible'));
    const translatedAnchor=await learning.evaluate(()=>captureTranscriptPosition());
    assert.equal(translatedAnchor.seconds,readingAnchor.seconds);
    assert.ok(Math.abs(translatedAnchor.offset-readingAnchor.offset)<3);
    assert.deepEqual(pageErrors,[]);
    console.log('PASS long-transcript reading position survives tab changes and progressive bilingual translation');
    console.log('All browser smoke tests passed. APIs mocked; no real keys or paid requests used.');
  } finally { await context.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
