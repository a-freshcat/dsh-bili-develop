import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,BV} from './fixtures.mjs';

for(const scheduled of [false,true]) test((scheduled?'scheduled browsing':'manual reading')+' sends frames and original subtitles together',async t=>{
 let f; const requests=[];
 f=fixture(t,{now:()=>Date.parse('2026-10-26T04:00:00Z'),call:async(method,p)=>{
  if(method==='account')return {status:'logged_in',uid:'123'};
  if(method==='search_videos')return {videos:[{bvid:BV}]};
  if(method==='read_video')return {...f.evidence,cid:234,duration:74};
  if(method==='vision_check')return {ready:true};
  if(method==='sample_frames')return {bvid:BV,cid:234,accountUid:'123',source:'frames',coverage:'partial',processedSeconds:65.9,
    frames:[{at:20,data:'YWJj',width:768,height:432}],processor:'fixture'};
  throw Error('Unexpected '+method);
 }});
 await f.bind();f.controller.configure({visionEnabled:true,visionFramesPerVideo:1,keywords:['合成主题'],autoEnabled:scheduled,
  activityStart:'00:00',activityEnd:'24:00',videosPerRound:1});
 const prompt=f.ctx.sessionController.prompt;
 f.ctx.sessionController.prompt=async request=>{requests.push(request);return prompt(request);};
 if(scheduled){await f.controller.scheduler.begin('scheduled-mixed-round','scheduled');
  for(let i=0;i<6;i++){await f.controller.scheduler.tick();await f.controller.idle();await new Promise(r=>setImmediate(r));}
 }else{await f.controller.start({requestId:'manual-mixed-reading',bvid:BV});await f.controller.idle();}
 const run=f.store.list(20).find(r=>r.kind==='video');
 assert.equal(run?.state,'preview',JSON.stringify(run?.error));assert.equal(run.evidence.source,'frames');
 assert.equal(run.evidence.text,f.evidence.text);assert.equal(run.evidence.textCoverage,'complete');assert.equal(run.evidence.coverage,'partial');
 assert.match(requests[0].content[0].text,/测试字幕原文内容/);assert.match(requests[0].content[0].text,/同时提供抽帧画面与字幕/);
 assert.equal(requests[0].content.filter(p=>p.type==='image').length,1);
});
