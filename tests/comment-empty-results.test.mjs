import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,BV,preview} from './fixtures.mjs';
import {parsePreview} from '../src/decision.mjs';
import {DEFAULT_CONFIG} from '../src/store.mjs';
import {PluginError} from '../src/errors.mjs';

test('visual preview cannot request sending an empty or invisible-only comment',()=>{
 const run={id:'empty-visual-comment'}, evidence={source:'frames',totalFrames:1,text:''};
 for(const comment of ['','  \n','\u200b\u2060']){
  assert.throws(()=>parsePreview(JSON.stringify({...preview(run.id),comment,evidence_quote:'蓝色雨伞'}),run,evidence,DEFAULT_CONFIG),{code:'MODEL_FORMAT'});
 }
});

test('an already saved empty comment is blocked before platform probe and quota reservation',async t=>{
 const f=fixture(t);await f.bind();f.controller.comments.kick=()=>{};f.controller.configure({commentMode:'manual'});
 const id='saved-empty-comment';f.store.start({id,kind:'video',bvid:BV,accountUid:'123',sessionId:f.store.get('binding').sessionId});
 f.store.update(id,{state:'preview',evidence:f.evidence,configSnapshot:f.store.config(),preview:preview(id)});
 f.controller.comments.stage(id,[],true);const d=f.controller.comments.get(id);f.controller.comments.save({...d,text:'\u200b'});
 await assert.rejects(f.controller.comments.send(id,d.revision),{code:'COMMENT_EMPTY'});
 assert.equal(f.counters.read,0);assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM comment_attempts').get().n,0);
});

test('checking an ended empty model result marks failure and releases the task without any publication attempt',async t=>{
 const f=fixture(t,{noResult:true,neverIdle:true});await f.bind();
 const id='ended-empty-comment';await f.controller.start({requestId:id,bvid:BV});await f.controller.idle();
 assert.equal(f.store.run(id).state,'awaiting_model');
 const session=f.sessions.get(f.store.get('binding').sessionId);
 session.events.push({seq:1,type:'user/message',data:{source:{rpcId:id},turn:3}},
  {seq:2,type:'assistant/message',data:{message:{content:[{type:'reasoning',text:'not-public'}]}}},
  {seq:3,type:'turn/end',data:{turn:3,reason:{kind:'completed'}}});
 await f.controller.dispatch({action:'reconcile',requestId:id});
 assert.equal(f.store.run(id).state,'failed');assert.equal(f.store.run(id).error.code,'MODEL_EMPTY');
 assert.equal(f.store.active(),null);assert.equal(f.controller.comments.get(id),null);
 assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM comment_attempts').get().n,0);
});

test('foreign account drafts do not block automatically sending a current-account draft',async t=>{
 const calls=[],now=Date.parse('2026-10-26T04:00:00Z');
 const f=fixture(t,{now:()=>now,call:async(method,p)=>{
  calls.push({method,p});
  if(p.expected_account!=='123')throw new PluginError('ACCOUNT_CHANGED','合成账号已切换');
  const found={accountUid:'123',bvid:p.bvid,oid:'987',mentions:[]};
  if(method==='comment_probe')return found;
  if(method==='comment_publish')return {...found,confirmed:true,receipt:'555'};
  throw Error('Unexpected '+method);
 }});
 await f.bind();f.controller.comments.kick=()=>{};
 f.controller.configure({commentMode:'auto',commentPrivacyMode:'content'});f.controller.social.setAccount('123');
 for(const [uid,id,sessionId] of [['999','account-comment-999',f.store.get('binding').sessionId],['123','old-session-comment','previous-binding'],['123','account-comment-123',f.store.get('binding').sessionId]]){
  f.store.start({id,kind:'video',bvid:BV,accountUid:uid,sessionId,now});
  f.store.update(id,{state:'preview',evidence:{...f.evidence,accountUid:uid},configSnapshot:f.store.config(),preview:preview(id)});
  f.controller.comments.stage(id,[],true);
 }
 f.controller.comments.tick();await f.controller.comments.job;
 assert.equal(f.controller.comments.get('account-comment-123').state,'sent');
 assert.equal(f.controller.comments.get('account-comment-999').state,'draft');
 assert.equal(f.controller.comments.get('old-session-comment').state,'draft');
 assert.equal(calls.filter(c=>c.method==='comment_publish').length,1);
 assert.ok(calls.every(c=>c.p.expected_account==='123'));
});

for(const wrongId of [false,true]) test(wrongId?'foreign model task id cannot stage or publish a comment':'model declining a comment is a completed preview with no publication draft',async t=>{
 const f=fixture(t,{output:(_text,id)=>JSON.stringify({...preview(id),...(wrongId?{runId:'another-task'}:{should_comment:false,comment:''})})});await f.bind();
 const id='comment-pipeline-'+(wrongId?'mismatch':'decline');await f.controller.start({requestId:id,bvid:BV});await f.controller.idle();
 assert.equal(f.store.run(id).state,wrongId?'failed':'preview');
 if(wrongId)assert.equal(f.store.run(id).error.code,'MODEL_FORMAT');
 assert.equal(f.controller.comments.get(id),null);
 assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM comment_attempts').get().n,0);
});
