import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,preview,BV} from './fixtures.mjs';
import {accountResource,AccountManager} from '../src/account-manager.mjs';
import {settingsHarness,flatten,nodeText} from './settings-harness.mjs';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
async function setup(t,{type='video',mode='preview',unknown=false,history=false}={}){
 const clock={now:Date.parse('2026-10-26T04:00:00Z')},calls=[],requests=[];
 const resource={type,id:type==='video'?BV:'987654321',oid:type==='video'?'987':'987654321',commentType:type==='video'?1:17,title:'合成账号作品',url:type==='video'?'https://www.bilibili.com/video/'+BV+'/':'https://t.bilibili.com/987654321'};
 const target={id:'201',root:'201',uid:'456',text:'这条作品挺有趣，想知道后续。',level:'top',at:clock.now+1000};
 const f=fixture(t,{now:()=>clock.now,output:(_text,id)=>JSON.stringify({...preview(id),evidence_quote:'这条作品挺有趣',comment:'后续还在准备，先把这一段讲清楚。'}),call:async(method,p)=>{
  calls.push({method,p});if(method==='account')return {status:'logged_in',uid:'123'};
  if(method==='account_resources')return {accountUid:'123',resources:[resource]};
  if(method==='account_comments')return {accountUid:'123',resource,comments:[target]};
  if(method==='account_reply_probe')return {accountUid:'123',resource,target};
  if(method==='account_reply_publish')return {accountUid:'123',resource,target,confirmed:!unknown,receipt:unknown?'':'555'};
  if(method==='account_reply_verify')return {accountUid:'123',resource,target,confirmed:true,receipt:'555'};
  throw Error('Unexpected '+method);
 }});
 await f.bind();f.controller.comments.kick=()=>{};f.controller.social.setAccount('123');
 f.controller.configure({accountReplyEnabled:true,accountReplyMode:mode,commentPrivacyMode:'content',accountReplyPerCheck:1});
 const prompt=f.ctx.sessionController.prompt;f.ctx.sessionController.prompt=async r=>{requests.push(r);return prompt(r);};
 return {...f,clock,calls,resource,target,requests,async scan(old=history){f.controller.accountManager.scan({history:old});await f.controller.accountManager.job;return f.controller.accountManager.status().records[0];}};
}
test('account resource input accepts only official video and dynamic links',()=>{
 assert.equal(accountResource(BV).type,'video');assert.equal(accountResource('https://t.bilibili.com/123').type,'dynamic');
 for(const x of ['https://evil.test/123','http://t.bilibili.com/123','https://user@t.bilibili.com/123','../../foo'])assert.throws(()=>accountResource(x));
});

test('account management defaults off and never polls or generates without being enabled',async t=>{
 const f=fixture(t);await f.bind();assert.throws(()=>f.controller.accountManager.scan(),{code:'ACCOUNT_DISABLED'});
 f.controller.accountManager.tick();assert.equal(f.counters.read,0);assert.equal(f.counters.prompt,0);
});
for(const type of ['video','dynamic'])test(type+' owner comments preview in the sole dialogue and are isolated from browsing records',async t=>{
 const f=await setup(t,{type});const r=await f.scan();assert.equal(r?.state,'draft',f.controller.accountManager.notice);
 assert.equal(f.counters.create,1);assert.equal(f.counters.prompt,1);assert.equal(f.requests[0].sessionId,f.store.get('binding').sessionId);
 assert.equal(f.store.budget(f.store.config(),f.clock.now).analyses,0);assert.equal(f.store.count(),0);
 assert.equal(f.calls.filter(c=>c.method==='account_reply_publish').length,0);
 await assert.rejects(f.controller.accountManager.send(r.id,r.revision),{code:'ACCOUNT_MODE'});
 await f.scan();assert.equal(f.counters.prompt,1);
});
test('manual replies publish only the saved draft, share global quota and never duplicate',async t=>{
 const f=await setup(t,{mode:'manual'}),r=await f.scan();assert.equal(r.state,'draft');
 f.controller.accountManager.publish(r.id,r.revision);await f.controller.accountManager.job;
 assert.equal(f.controller.accountManager.get(r.id).state,'sent');
 assert.equal(f.calls.find(c=>c.method==='account_reply_publish').p.text,r.draft);
 assert.equal(f.controller.comments.budget('123','x').attempts,1);
 const stored=f.store.run(r.id);assert.equal(stored.accountComment.state,'sent');
 assert.match(readFileSync(join(f.workspacePath,stored.notePath),'utf8'),/处理状态：sent/);
 await assert.rejects(f.controller.accountManager.send(r.id,r.revision));
 assert.equal(f.calls.filter(c=>c.method==='account_reply_publish').length,1);
});
test('automatic replies are opt-in; historical reads never automatically publish',async t=>{
 const f=await setup(t,{mode:'auto'});await f.scan();assert.equal(f.calls.filter(c=>c.method==='account_reply_publish').length,1);
 const g=await setup(t,{mode:'auto',history:true});g.target.at=g.clock.now-86400000;
 const r=await g.scan();assert.equal(r.state,'draft');assert.equal(g.calls.filter(c=>c.method==='account_reply_publish').length,0);
 g.controller.accountManager.tick();await g.controller.accountManager.job;assert.equal(g.calls.filter(c=>c.method==='account_reply_publish').length,0);
});

test('queued automatic drafts resume after cooldown without another model call',async t=>{
 const f=await setup(t,{mode:'auto'});
 f.store.db.prepare('INSERT INTO comment_attempts VALUES(?,?,?,?,?,?)').run('earlier-public-attempt','123','BV1xx411c7mE','previous','different-hash',f.clock.now);
 let r=await f.scan();assert.equal(r.state,'draft');assert.match(r.reason,/间隔/);
 f.clock.now+=301000;f.controller.accountManager.tick();await f.controller.accountManager.job;
 assert.equal(f.controller.accountManager.get(r.id).state,'sent');assert.equal(f.counters.prompt,1);
});

test('zero account evaluation and reply allowances block their respective work',async t=>{
 const f=await setup(t,{mode:'auto'});f.controller.configure({accountReplyDailyEvaluations:0});await f.scan();
 assert.equal(f.counters.prompt,0);assert.equal(f.calls.length,0);
 const g=await setup(t,{mode:'auto'});g.controller.configure({accountReplyDailyLimit:0});const r=await g.scan();
 assert.equal(r.state,'draft');assert.equal(g.calls.filter(c=>c.method==='account_reply_publish').length,0);
 assert.equal(g.controller.accountManager.budget().attempts,0);
});

test('shared private history requires explicit per-draft review in strict mode',async t=>{
 const f=await setup(t,{mode:'auto'});f.controller.configure({commentPrivacyMode:'strict'});
 f.controller.privacy.remember('private-fixture',f.store.get('binding').sessionId,'123','789',['synthetic private conversation material']);
 let r=await f.scan();assert.equal(r.state,'draft');assert.equal(f.calls.filter(c=>c.method==='account_reply_publish').length,0);
 f.controller.configure({accountReplyMode:'manual'});
 f.controller.accountManager.publish(r.id,r.revision,{privacyReviewed:true,privacyContext:f.controller.privacy.context().contextHash});await f.controller.accountManager.job;
 assert.equal(f.controller.accountManager.get(r.id).state,'sent');
});

test('browsing and account management cannot both reply to the same video comment',async t=>{
 const f=await setup(t,{mode:'manual'}),r=await f.scan();
 f.store.db.prepare('INSERT INTO reply_attempts VALUES(?,?,?,?,?,?,?,?,?)').run('browsing-reply','123',BV,r.target.id,'source-video','top','round','hash',f.clock.now-3600000);
 await assert.rejects(f.controller.accountManager.send(r.id,r.revision),{code:'COMMENT_DUPLICATE'});
 assert.equal(f.calls.filter(c=>c.method==='account_reply_publish').length,0);
});
test('uncertain results preserve attempts, cannot resend and verify read-only',async t=>{
 const f=await setup(t,{mode:'auto',unknown:true});const r=await f.scan();assert.equal(r.state,'unknown');
 await assert.rejects(f.controller.accountManager.send(r.id,r.revision));
 f.controller.accountManager.verify(r.id);await f.controller.accountManager.job;
 assert.equal(f.controller.accountManager.get(r.id).state,'sent');assert.equal(f.calls.filter(c=>c.method==='account_reply_publish').length,1);
});
test('persona changes, account switches and pauses stop pending sends before any POST',async t=>{
 const f=await setup(t,{mode:'manual'}),r=await f.scan();f.controller.configure({persona:'新的固定人设。'});
 await assert.rejects(f.controller.accountManager.send(r.id,r.revision),{code:'COMMENT_STALE'});
 f.controller.social.setAccount('999');assert.equal(f.controller.accountManager.status().records.length,0);
 await assert.rejects(f.controller.accountManager.send(r.id,r.revision),{code:'ACCOUNT_CHANGED'});
 assert.equal(f.calls.filter(c=>c.method==='account_reply_publish').length,0);
});
test('account management is a separate control page and parallel record section',async t=>{
 const f=await setup(t);await f.scan();const ui=await settingsHarness(f.controller);t.after(ui.close);
 let tree=ui.render();const nav=flatten(tree).find(n=>n?.props?.['aria-label']==='B站浏览设置');
 flatten(nav).find(n=>n?.type==='button'&&nodeText(n)==='账号管理').props.onClick();tree=ui.render();
 assert.equal(flatten(tree).find(n=>n?.props?.id==='bili-tab-account').props.hidden,false);
 ui.button(tree,'查看账号管理记录').props.onClick();tree=ui.render();
 const panel=flatten(tree).find(n=>n?.props?.id==='bili-history-account');assert.equal(panel.props.hidden,false);
 assert.match(nodeText(panel),/合成账号作品/);assert.match(nodeText(panel),/大肥鱼/);
 assert.equal(flatten(tree).find(n=>n?.props?.id==='bili-history-browse').props.hidden,true);
});

test('verified old publications join an account-scoped watch list and can be removed without deleting records',async t=>{
 const f=await setup(t,{type:'dynamic'});
 f.controller.accountManager.scan({url:f.resource.url,history:true});await f.controller.accountManager.job;
 assert.equal(f.controller.accountManager.status().watched.length,1);
 const original=f.controller.reader;
 f.controller.reader=()=>({call:(method,p)=>method==='account_resources'?Promise.resolve({accountUid:'123',resources:[]}):original().call(method,p)});
 f.clock.now+=121000;f.controller.accountManager.tick();await f.controller.accountManager.job;
 assert.equal(f.calls.filter(c=>c.method==='account_comments').length,2);
 f.controller.accountManager.unwatch('dynamic:'+f.resource.id);
 assert.equal(f.controller.accountManager.status().watched.length,0);assert.equal(f.controller.accountManager.status().total,1);
});

test('account records paginate and filter independently, without leaking another account',async t=>{
 const f=await setup(t),r=await f.scan();
 for(let i=1;i<=21;i++)f.controller.accountManager.save({...f.controller.accountManager.get(r.id),id:'account-page-'+i,target:{...r.target,id:String(201+i),at:f.clock.now+i},state:'failed'});
 const first=f.controller.accountManager.status(),second=f.controller.accountManager.status({offset:10});
 assert.equal(first.total,22);assert.equal(first.records.length,10);assert.equal(second.records.length,10);
 assert.ok(second.records.every(x=>!first.records.some(y=>y.id===x.id)));
 assert.equal(f.controller.accountManager.status({state:'failed'}).total,21);
 f.controller.social.setAccount('999');assert.equal(f.controller.accountManager.status().total,0);
});

test('manual regeneration uses a fresh model task, preserves evaluation charges and cannot retry attempted sends',async t=>{
 const f=await setup(t,{mode:'manual'}),old=await f.scan();f.controller.configure({persona:'新的固定人设，仍然友善简洁。'});
 f.controller.accountManager.retry(old.id);await f.controller.accountManager.job;
 const r=f.controller.accountManager.status().records[0];assert.notEqual(r.id,old.id);assert.equal(r.state,'draft');
 assert.match(r.reason,/人工重新生成/);assert.equal(f.counters.prompt,2);assert.equal(f.counters.create,1);
 assert.equal(f.controller.accountManager.budget().evaluations,2);
 f.controller.accountManager.publish(r.id,r.revision);await f.controller.accountManager.job;
 assert.equal(f.controller.accountManager.get(r.id).state,'sent');
 assert.throws(()=>f.controller.accountManager.retry(r.id),{code:'ACCOUNT_RECORD'});
 assert.equal(f.calls.filter(c=>c.method==='account_reply_publish').length,1);
});
