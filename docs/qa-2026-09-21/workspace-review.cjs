const { chromium } = require('/Users/ilaohuyo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const out = path.join(__dirname, 'workspace-review');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const results = [];
  for (const [width, height] of [[900,600], [1000,650], [1440,900]]) {
    for (const language of ['zh','en']) for (const theme of ['light','dark','system']) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(({language, theme}) => {
        localStorage.setItem('language', language);
        localStorage.setItem('relaydesk-theme', theme);
        const account = {baseUrl:'https://relay.example.test',username:'Review account',quota:56090000,usedQuota:43910000,currencySymbol:'¥',currencyCode:'CNY',quotaPerUnit:500000,displayInCurrency:true,updatedAt:1789980180,group:'standard',applyApps:{claude:true,codex:true,gemini:true},groupTargets:{}};
        const models = [{group:'claude',ratio:.85,models:['claude-fable-5','claude-fable-5-1','claude-opus-4-6-thinking','claude-opus-4-8','claude-opus-5'].map(id=>({id,modelRatio:2.5,tags:[]}))},{group:'OpenAI',ratio:1,models:['gpt-6-astra','gpt-5.6-sol','gpt-5.6-luna','gpt-5.6-terra'].map(id=>({id,modelRatio:1,tags:['tools']}))}];
        let id=1; const callbacks={};
        window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
        window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const n=id++;callbacks[n]=fn;return n;},unregisterCallback(n){delete callbacks[n];},runCallback(n,p){callbacks[n]?.(p);},async invoke(cmd,args={}){
          if(cmd==='relay_get_account'||cmd==='relay_refresh_account')return account;
          if(cmd==='relay_list_models')return models;
          if(cmd==='relay_list_groups')return models.map(g=>({name:g.group,ratio:g.ratio}));
          if(cmd==='relay_get_topup_info')return {enabled:true,currencySymbol:'¥',amountOptions:[10,25,50,100,200,500,1000],payMethods:[{id:'wxpay',label:language==='zh'?'微信':'WeChat Pay',enabled:true},{id:'alipay',label:language==='zh'?'支付宝':'Alipay',enabled:true}]};
          if(cmd==='relay_calculate_topup_amount')return {amount:args.amount,payAmount:args.amount,currencySymbol:'¥'};
          if(cmd==='relay_list_topup_history')return {items:[],total:0,isComplete:true};
          if(cmd==='relay_get_restart_capabilities')return [];
          if(cmd==='plugin:event|listen')return id++;
          if(cmd==='plugin:window|is_focused')return true;
          return null;
        }};
      },{language,theme});
      await page.goto('http://127.0.0.1:3000/');
      await page.locator('.rd-model-table tbody tr').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      if(theme==='system') {
        await page.emulateMedia({colorScheme:'dark'});
        await page.locator('html.dark').waitFor();
        await page.emulateMedia({colorScheme:'light'});
        await page.locator('html.light').waitFor();
      }
      for(const view of ['models','wallet']) {
        if(view==='wallet') await page.locator('.rd-sidebar nav button').nth(3).click();
        if(view==='wallet') await page.locator('.rd-wallet-choice').first().waitFor();
        await page.screenshot({path:path.join(out,view+'-'+language+'-'+theme+'-'+width+'.png')});
        results.push(await page.evaluate(({view,language,theme})=>{
          const rect=s=>document.querySelector(s)?.getBoundingClientRect().toJSON();
          return {view,language,theme,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,table:rect('.rd-model-table'),metrics:rect('.rd-metrics'),current:rect('.rd-current'),toolbar:rect('.rd-model-toolbar'),heading:rect('.rd-catalog-heading'),summary:rect('.rd-account-summary'),checkout:rect('.rd-wallet-checkout'),apply:[...document.querySelectorAll('.rd-action-col button')].map(el=>({width:el.clientWidth,height:el.clientHeight,overflow:el.scrollWidth>el.clientWidth}))};
        },{view,language,theme}));
      }
      const nav=page.locator('.rd-sidebar nav button').nth(3);
      const before=await nav.boundingBox();
      await nav.hover();
      await page.waitForTimeout(50);
      const after=await nav.boundingBox();
      if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Navigation hit area moved');
      await page.locator('.rd-collapse').click();
      await page.screenshot({path:path.join(out,'wallet-collapsed-'+language+'-'+theme+'-'+width+'.png')});
      await page.evaluate(() => {
        document.querySelectorAll('.rd-account-summary-card strong').forEach((el,i)=>{if(i<2)el.textContent='¥123,456,789.12';});
      });
      if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Long amount overflow');
      await page.locator('.rd-sidebar nav button').first().click();
      await page.locator('.rd-model-table').waitFor();
      await page.evaluate(() => {
        document.querySelector('.rd-model-id').textContent='claude-model-with-an-extremely-long-custom-version-name-2026-09-21';
      });
      if(await page.locator('.rd-model-table').evaluate(el=>el.getBoundingClientRect().right>innerWidth))throw Error('Long model overflow');
      await page.emulateMedia({reducedMotion:'reduce'});
      await nav.hover();
      await page.waitForTimeout(100);
      const navState=await nav.locator('.rd-nav-content').evaluate(el=>({transform:getComputedStyle(el).transform,transition:getComputedStyle(el).transitionDuration}));
      if(navState.transform!=='none' && navState.transform!=='matrix(1, 0, 0, 1, 0, 0)')throw Error('Navigation transform remains');
      if(navState.transition!=='0s' && navState.transition!=='0ms')throw Error('Navigation transition remains');
      if(errors.length)throw Error(errors.join('; '));
      await page.close();
    }
  }
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
  if(results.some(r=>r.overflow||r.apply.some(b=>b.overflow||b.height>44)))throw Error('Layout overflow');
  console.log('Passed: '+results.length+' page layouts; stable hover targets; reduced motion; screenshots in '+out);
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
