import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";
import { amendmentFixture } from "./support/organizer-amendment-fixture.mjs";
import { githubPublicationFixture } from "./support/github-publication-fixture.mjs";
const vite = await createServer({ configFile:false, root:process.cwd(), server:{middlewareMode:true}, appType:"custom", environments:{ssr:{}}, logLevel:"silent" });
if (!isRunnableDevEnvironment(vite.environments.ssr)) throw Error("SSR unavailable");
const runner=vite.environments.ssr.runner;
const {createPublicationRecoveryAuditor}=await runner.import('/app/organizer-publication-recovery.ts');
const {PUBLICATION_REQUIRED_CHECKS}=await runner.import('/app/publication-rollout.ts');
after(()=>vite.close());

async function setup() {
  const f=await amendmentFixture(runner);
  const remote=await githubPublicationFixture({data:f.dataFiles,main:f.mainFiles},PUBLICATION_REQUIRED_CHECKS);
  const data=remote.repos.get('tw_doujin_event-data'), main=remote.repos.get('tw_doujin_event');
  const dataBase=data.refs.get('main'), mainBase=main.refs.get('main');
  f.baseline.pin.commit=dataBase;
  const mainFiles=remote.filesAt(main,mainBase);
  mainFiles.set('data/event-data-pins/event-alpha.json',JSON.stringify(f.baseline.pin));
  main.refs.set('main',remote.commit(main,remote.tree(main,mainFiles),[mainBase],'Original published pin'));
  const job={id:'failed-amendment',status:'failed',step:'merging_main',approval_hash:'a'.repeat(64),
    data_pr_number:6,main_pr_number:375,main_merge_sha:null,workflow_run_id:null};
  const wrong=remote.filesAt(data,dataBase);
  wrong.set('events/event-alpha/event.json',wrong.get('events/event-alpha/event.json').replace('測試活動','錯誤產物'));
  job.data_head_sha=remote.commit(data,remote.tree(data,wrong),[dataBase],'Failed amendment');
  job.data_merge_sha=remote.commit(data,remote.tree(data,wrong),[dataBase],'Squash failed amendment');
  const restoredFiles=remote.filesAt(data,dataBase);
  const restoration=remote.commit(data,remote.tree(data,restoredFiles),[job.data_merge_sha],'Restore unpublished amendment');
  data.refs.set('main',restoration);
  job.main_head_sha=remote.commit(main,remote.tree(main,mainFiles),[main.refs.get('main')],'Unmerged publication');
  const pull=(repo,number,branch,head,merged,merge,body)=>({number,state:'closed',merged,merge_commit_sha:merge,body,
    base:{ref:'main',repo:{full_name:`dekkmarsvin/${repo}`}},head:{ref:branch,sha:head,repo:{full_name:`dekkmarsvin/${repo}`}},user:{login:'publisher[bot]'}});
  for(const [stage,repo,number,head,merged,merge] of [
    ['data',data,6,job.data_head_sha,true,job.data_merge_sha],['main',main,375,job.main_head_sha,false,null]]) {
    const name=stage==='data'?'tw_doujin_event-data':'tw_doujin_event', branch=`organizer/${job.id}/${stage}`;
    repo.refs.set(branch,head);repo.pulls.set(number,pull(name,number,branch,head,merged,merge,`Organizer publication ${job.id}/${stage}\n\nApproval snapshot ${job.approval_hash}`));
  }
  data.pulls.set(9,pull('tw_doujin_event-data',9,'codex/restore',restoration,true,restoration,'Maintenance restoration'));
  data.pulls.get(9).user.login='maintainer';
  remote.green('data',restoration);
  const input={job,baseline:f.baseline,restorationPullNumber:9};
  const audit=createPublicationRecoveryAuditor({tokenProvider:{getToken:async()=> 'test-token',invalidate(){}},fetch:remote.fetch});
  const replaceRestoration=(alter)=>{
    const changed=new Map(restoredFiles);alter(changed);
    const sha=remote.commit(data,remote.tree(data,changed),[job.data_merge_sha],'Invalid restoration');
    data.refs.set('main',sha);Object.assign(data.pulls.get(9),{merge_commit_sha:sha});data.pulls.get(9).head.sha=sha;remote.green('data',sha);
  };
  return {remote,data,main,input,audit,restoration,replaceRestoration};
}

test('exact restoration is verified without remote mutation; original branches and failure checkpoints remain',async()=>{
  const s=await setup();const before=structuredClone(s.input.job);
  const result=await s.audit(s.input);
  assert.equal(result.restorationPullNumber,9);assert.equal(result.restorationMergeSha,s.restoration);
  assert.equal(result.sourceDataCommit,s.input.baseline.pin.commit);
  assert.deepEqual(s.input.job,before);
  assert.ok(s.remote.calls.every(call=>call.method==='GET'));
});

for(const [name,change] of [
  ['open main PR',s=>s.main.pulls.get(375).state='open'],
  ['merged main without checkpoint',s=>s.main.pulls.get(375).merged=true],
  ['changed original data head',s=>s.data.pulls.get(6).head.sha='b'.repeat(40)],
  ['changed original approval',s=>s.data.pulls.get(6).body='other approval'],
  ['ambiguous original main PR',s=>s.main.pulls.set(376,{...s.main.pulls.get(375),number:376})],
  ['unmerged restoration',s=>s.data.pulls.get(9).merged=false],
  ['failed restoration CI',s=>s.data.checks.get(s.restoration)[0].conclusion='failure'],
  ['data not restored',s=>s.data.refs.set('main',s.input.job.data_merge_sha)],
  ['main checkpoint already exists',s=>s.input.job.main_merge_sha='c'.repeat(40)],
  ['restore another event',s=>s.replaceRestoration(files=>files.set('events/other/event.json','{}'))],
  ['restore shared reference',s=>s.replaceRestoration(files=>files.set([...files.keys()].find(p=>p.startsWith('references/')),'{}'))],
  ['leave a changed event leaf',s=>s.replaceRestoration(files=>files.set('events/event-alpha/extra.json','{}'))],
  ['changed public pin',s=>{
    const base=s.main.refs.get('main'),files=s.remote.filesAt(s.main,base);
    const pin={...s.input.baseline.pin,commit:s.input.job.data_merge_sha};
    files.set('data/event-data-pins/event-alpha.json',JSON.stringify(pin));
    s.main.refs.set('main',s.remote.commit(s.main,s.remote.tree(s.main,files),[base],'Changed pin'));
  }],
]) test(`restoration audit rejects ${name}`,async()=>{
  const s=await setup();change(s);await assert.rejects(s.audit(s.input));
  assert.ok(s.remote.calls.every(call=>call.method==='GET'));
});

test('unrelated later data changes are preserved, but changes to this restored event block recovery',async()=>{
  const s=await setup();let base=s.data.refs.get('main'),files=s.remote.filesAt(s.data,base);
  files.set('events/other/event.json','{}');
  s.data.refs.set('main',s.remote.commit(s.data,s.remote.tree(s.data,files),[base],'Another event'));
  await s.audit(s.input);
  base=s.data.refs.get('main');files=s.remote.filesAt(s.data,base);files.set('events/event-alpha/event.json','{}');
  s.data.refs.set('main',s.remote.commit(s.data,s.remote.tree(s.data,files),[base],'Changed event'));
  await assert.rejects(s.audit(s.input));
});

test('incomplete pagination and API failure never count as absent remote effects',async()=>{
  const s=await setup();
  for(const response of [new Response('{}',{status:403}),Response.json([],{headers:{link:'<https://api.github.com/next>; rel="next"'}})]) {
    const audit=createPublicationRecoveryAuditor({tokenProvider:{getToken:async()=> 'test-token',invalidate(){}},fetch:async(url,init)=>
      new URL(url).pathname.endsWith('/pulls')?response.clone():s.remote.fetch(url,init)});
    await assert.rejects(audit(s.input));
  }
});
