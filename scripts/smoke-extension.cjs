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
    assert.equal((await worker.evaluate(() => chrome.runtime.getManifest())).version, '0.2.4');
    await worker.evaluate(() => {
      const originalFetch = fetch;
      globalThis.fixtureRequests = [];
      globalThis.fixtureDelay = 0;
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
          const segmentIds = [...new Set([...body.messages.map(item=>item.content).join('\n').matchAll(/"id"\s*:\s*"(segment-[^"]+|ui-\d+)"/g)].map(match=>match[1]))];
          if (segmentIds.length) return response({choices:[{message:{content:JSON.stringify({segments:segmentIds.map(id=>({id,text:'翻译后的测试字幕。'}))})}}]});
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
      if (url.pathname === '/api/timedtext') return json({events:[{tStartMs:0,dDurationMs:5000,segs:[{utf8:'First transcript line'}]},{tStartMs:5000,dDurationMs:5000,segs:[{utf8:'Second transcript line'}]}]});
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
    await panel.waitForFunction(()=>!document.getElementById('analyze').disabled);
    await worker.evaluate(async()=>{
      const saved=await chrome.storage.local.get('ytd_settings');
      await chrome.storage.local.set({ytd_settings:{...saved.ytd_settings,aiApiKey:''}});
    });
    await panel.bringToFront();
    await panel.locator('#analyze').click();
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
    console.log('PASS missing DeepSeek key opens the settings page without a dialog or AI request');
    await panel.locator('#analyze').click();
    await panel.waitForFunction(()=>document.getElementById('status').textContent.startsWith('分析完成'));
    assert.match(await panel.locator('#results').textContent(),/视频字幕分析完成/);
    assert.equal(await worker.evaluate(()=>fixtureRequests.filter(item=>item.url.includes('deepseek')).at(-1).auth),'Bearer fixture-updated-key');
    await panel.locator('.time').first().click();
    console.log('PASS native YouTube transcript, DeepSeek analysis, persisted updated key and timestamp action');

    await panel.locator('[data-mode=comments]').click();
    await panel.locator('#analyze').click();
    await panel.waitForFunction(()=>document.getElementById('status').textContent.includes('请在设置中填写该可选项'));
    assert.equal(await panel.locator('#fixSettings').isVisible(),true);
    await settings.locator('#youtubeKey').fill('fixture-google-key');
    await settings.locator('#preferencesForm button[type=submit]').click();
    await settings.waitForFunction(()=>document.getElementById('saveStatus').textContent.includes('设置已保存'));
    await panel.locator('#analyze').click();
    await panel.waitForFunction(()=>document.getElementById('status').textContent.startsWith('分析完成'));
    assert.match(await panel.locator('#status').textContent(),/4 条评论/);
    assert.equal(await panel.locator('#results img').count(),0);
    assert.match(await panel.locator('#results').textContent(),/<img src=x/);
    assert.equal(await panel.locator('#results').textContent().then(text=>text.includes('invented-id')),false);
    const calls=await worker.evaluate(()=>fixtureRequests.filter(item=>item.url.includes('googleapis')).map(item=>item.url));
    assert.equal(calls.length,3); assert.ok(calls.some(url=>url.includes('pageToken=fixture-page-2')));
    console.log('PASS optional Google key, official comment API pagination/replies, source evidence and HTML escaping');

    await page.goto('https://www.bilibili.com/video/BV13x41117TL/?p=2');
    await page.locator('#vca-open').waitFor({state:'visible'});
    assert.match(await page.locator('#vca-tip').textContent(),/哔哩哔哩.*字幕/);
    await panel.waitForFunction(()=>document.getElementById('platform').textContent==='哔哩哔哩');
    assert.equal(await panel.locator('#results').isVisible(),false);
    assert.equal(await panel.locator('[data-mode=comments]').isDisabled(),true);
    await panel.locator('#analyze').click();
    await panel.waitForFunction(()=>document.getElementById('status').textContent.startsWith('分析完成'));
    assert.match(await panel.locator('#title').textContent(),/P2/);
    assert.match(await panel.locator('#rawContent').textContent(),/第二部分第一句/);
    console.log('PASS Bilibili current-part subtitles and video analysis in the same panel');

    await page.goto('https://www.xiaohongshu.com/explore/1234567890abcdef12345678');
    await page.locator('#vca-open').waitFor({state:'visible'});
    assert.match(await page.locator('#vca-tip').textContent(),/小红书.*评论/);
    await panel.waitForFunction(()=>document.getElementById('platform').textContent==='小红书');
    await panel.locator('#analyze').click();
    await panel.waitForFunction(()=>document.getElementById('status').textContent.startsWith('分析完成'),null,{timeout:30000});
    assert.match(await panel.locator('#status').textContent(),/3 条评论/);
    assert.equal(await panel.locator('#title').textContent(),'小红书测试笔记');
    assert.match(await panel.locator('#results').textContent(),/12000 赞/);
    assert.equal(await panel.locator('#results img').count(),0);
    const [download]=await Promise.all([panel.waitForEvent('download'),panel.locator('#exportData').click()]);
    const exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.equal(exported.comments.length,3); assert.ok(!JSON.stringify(exported).includes('fixture-updated-key'));
    console.log('PASS reused XHS DOM selectors, expansion, wrapper/duplicate filtering, like counts and key-free export');

    for (const width of [320,375,414,768]) {
      await panel.setViewportSize({width,height:900});
      const dimensions=await panel.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
      assert.ok(dimensions.scroll<=dimensions.width,`horizontal overflow at ${width}`);
    }
    await panel.setViewportSize({width:414,height:900});
    await panel.screenshot({path:path.join(os.tmpdir(),'panorama-panel-smoke.png'),fullPage:true,animations:'disabled'});
    console.log('PASS panel layout at 320, 375, 414 and 768 pixels');

    await page.goto('https://xueqiu.com/123/456');
    await page.locator('#vca-open').waitFor({state:'visible'});
    await panel.waitForFunction(()=>document.getElementById('platform').textContent==='雪球');
    await panel.locator('#collect').click();
    await panel.waitForFunction(()=>document.getElementById('status').textContent.startsWith('内容已获取'));
    assert.match(await panel.locator('#rawContent').textContent(),/雪球评论/);
    console.log('PASS retained Xueqiu comments');

    await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await panel.waitForFunction(()=>document.getElementById('platform').textContent==='YouTube');
    await worker.evaluate(()=>{fixtureDelay=1500;});
    await panel.locator('#analyze').click();
    await panel.waitForFunction(()=>document.getElementById('status').textContent.includes('DeepSeek 正在分析'));
    await page.goto('https://www.bilibili.com/video/BV13x41117TL/?p=1');
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
    await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    // This UI is hosted in a tab for inspection. A native side panel does not
    // become an active chrome-extension: tab when a tester clicks its controls.
    await context.addInitScript(()=>{if(location.pathname==='/sidepanel.html') window.close=()=>{};});
    const learning = await context.newPage();
    learning.on('pageerror',error=>pageErrors.push(error.message));
    await learning.goto(base+'sidepanel.html');
    await learning.locator('#transcriptList .transcript-entry').first().waitFor();
    await learning.screenshot({path:path.join(os.tmpdir(),'video-comment-analyzer-subtitle-study.png'),fullPage:true,animations:'disabled'});
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
    console.log('All browser smoke tests passed. APIs mocked; no real keys or paid requests used.');
  } finally { await context.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
