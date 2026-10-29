import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fixture } from './fixtures.mjs';

test('private draft explains non-privacy blockers; reviewing cannot bypass score and becomes sendable when eligible', async t => {
 const f=fixture(t); await f.bind(); f.controller.configure({dmEnabled:true});
 f.controller.social.setAccount('123');
 f.controller.social.contacts.put('123','456',{fan:true,score:50});
 f.controller.social.contacts.saveMessage({id:'review-ui',accountUid:'123',uid:'456',state:'draft',at:Date.now(),
  text:'我们已互相关注，开始聊天吧~',draft:'互关啦，那我浮上来冒个泡。',reason:'同一对话含私密历史，已阻止未经隐私审核的自动外发。'});
 let settings,plugin,si=0,ri=0; const values=[],refs=[],effects=[],calls=[];
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
  useState(initial){const i=si++;if(!(i in values))values[i]=initial;return [values[i],v=>values[i]=typeof v==='function'?v(values[i]):v];},
  useRef(initial){const i=ri++;return refs[i]||=( {current:initial});},useEffect(fn){effects.push(fn);}};
 const status=async()=>({...await f.controller.status(),privacy:{privateRecipientCount:2,contextHash:'review-context'}});
 const scope={window:{__ModuleLoader__:{load:m=>plugin=m.factory(()=>React)}},
  fetch:async(_url,options)=>{const input=JSON.parse(options.body);calls.push(input);return Response.json({ok:true,value:input.action==='status'?await status():{message:'测试：未发送'}});},
  setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},AbortController,Response,crypto:{randomUUID:()=> 'dm-review-ui'}};
 scope.globalThis=scope;runInNewContext(readFileSync('client.js','utf8'),scope);
 plugin.apply({get:n=>n==='slots'?{inject:(_n,cb)=>cb(),register:(_o,fn)=>settings=fn}:{openSession(){}}});
 const panel=settings({});const flat=n=>n&&typeof n==='object'?[n,...n.children.flatMap(flat)]:[n];
 const text=n=>flat(n).filter(n=>typeof n==='string').join('');
 const render=()=>{si=0;ri=0;effects.length=0;return panel.type(panel.props);};
 const findButton=(tree,label)=>flat(tree).find(n=>n?.type==='button'&&text(n)===label);
 render();const cleanup=effects[0]();t.after(cleanup);await new Promise(r=>setImmediate(r));let tree=render();
 const message=()=>flat(tree).find(n=>n?.props?.id==='bili-private-review-ui');
 assert.equal(findButton(message(),'发送这条私信草稿').props.disabled,true);
 let check=flat(message()).find(n=>n?.type==='input'&&n.props.type==='checkbox');check.props.onChange({target:{checked:true}});tree=render();
 assert.equal(findButton(message(),'发送这条私信草稿').props.disabled,true);
 assert.match(text(message()),/当前不能发送：友善度低于60分/);
 await findButton(message(),'查看联系人评分').props.onClick();tree=render();
 assert.equal(flat(tree).find(n=>n?.props?.id==='bili-people-contacts').props.hidden,false);
 assert.ok(calls.every(c=>c.action==='status'));
 f.controller.social.contacts.put('123','456',{score:60});values[0]=await status();tree=render();
 assert.equal(findButton(message(),'发送这条私信草稿').props.disabled,false);
 check=flat(message()).find(n=>n?.type==='input'&&n.props.type==='checkbox');check.props.onChange({target:{checked:false}});tree=render();
 assert.equal(findButton(message(),'发送这条私信草稿').props.disabled,true);
 assert.match(text(message()),/当前不能发送：请先勾选本条隐私审核/);
 flat(message()).find(n=>n?.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});tree=render();
 await findButton(message(),'发送这条私信草稿').props.onClick();
 assert.equal(calls.find(c=>c.action==='dm_send').privacyReviewed,true);
 assert.equal(calls.find(c=>c.action==='dm_send').privacyContext,'review-context');
 values[0]={...await status(),social:{...(await status()).social,paused:true}};tree=render();
 assert.equal(findButton(message(),'发送这条私信草稿').props.disabled,true);
 assert.match(text(message()),/当前不能发送：私信已暂停/);
 values[0]={...await status(),privacy:{privateRecipientCount:2,contextHash:'changed-context'}};tree=render();
 assert.equal(findButton(message(),'发送这条私信草稿').props.disabled,true,'a changed private context invalidates old consent');
 assert.equal(flat(message()).find(n=>n?.type==='input'&&n.props.type==='checkbox').props.checked,false);
});
