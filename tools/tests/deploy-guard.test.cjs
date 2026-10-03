// 本番へ出す経路の門。
//
// なぜ在るのか
// ------------
// build.sh の末尾に `npx wrangler deploy` が入っていて、SKIP_DEPLOY=1 を
// 付けたときだけ止まる形だった。「ビルドを確かめよう」と `bash build.sh` と
// 打った結果、本番がそのまま差し替わる事故が2度起きている。
//
// **この検査が落ちたら、同じ事故がまた起きる。** 直し方は「検査を緩める」
// ではなく「既定でデプロイしない形に戻す」。
//
// 門は「拒否」ではなく「毎回たずねる」。本番は許可制で、利用者が確認の窓で
// 押したときだけ通る。**見ているのは「黙って通らないこと」**であって、
// 「絶対に通らないこと」ではない。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = join(__dirname, '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('build.sh は、ビルドするだけで本番に出さない', () => {
  const src = read('build.sh');
  // 配信は WORKERS_CI(Cloudflare のビルド環境)の中だけ。**その外では出さない。**
  const lines = src.split('\n').filter((l) => !l.trim().startsWith('#'));
  const deploys = lines.filter((l) => /wrangler\s+(deploy|versions)/.test(l));
  assert.equal(deploys.length, 1, `配信の行が ${deploys.length} 本ある（1本だけのはず）`);
  assert.match(src, /\[ "\$\{WORKERS_CI:-\}" = "1" \]/, 'CI の値が厳密でない');
  assert.match(src, /\[ "\$\{WORKERS_CI_BRANCH:-\}" = "main" \]/, 'source main の一致が無い');
  assert.match(src, /if workers_ci_production_deploy_allowed; then/, '配信がfail-closedの門を通っていない');
  // 出さないことを、実行した人に伝えていること
  assert.match(src, /本番には出していません/, 'ビルドだけだと伝えていない');
  assert.match(src, /tools\/deploy\.sh/, '本番へ出す手順を案内していない');
});

// Actual build.sh control flow in an empty sandbox. Fixed PATH never reaches real npx.
function stubbedBuild(run) {
  const dir=mkdtempSync(join(tmpdir(),'build-guard-stub-')),bin=join(dir,'bin'),flag=join(dir,'deploy-calls');
  require('node:fs').mkdirSync(bin);writeFileSync(join(dir,'build.sh'),read('build.sh'));
  for(const name of ['node','python3','cp','mkdir','rm','ls','du','find'])writeFileSync(join(bin,name),'#!/bin/sh\nexit 0\n',{mode:0o755});
  writeFileSync(join(bin,'npx'),'#!/bin/sh\nprintf "%s\\n" "$*" >> "$TASK_BUILD_DEPLOY_CALLS"\nexit "${TASK_BUILD_NPX_EXIT:-0}"\n',{mode:0o755});
  function invoke(values={}) {
    rmSync(flag,{force:true});
    const result=spawnSync('/bin/bash',['build.sh'],{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{PATH:bin+':/usr/bin:/bin',LANG:'C',TASK_BUILD_DEPLOY_CALLS:flag,...values}});
    return {...result,calls:existsSync(flag)?readFileSync(flag,'utf8').trim().split('\n'):[]};
  }
  try{run(invoke);}finally{rmSync(dir,{recursive:true,force:true});}
}
test('actual build flow refuses missing/feature/typo CI and unknown skip values without real deployment',()=>stubbedBuild(run=>{
  const main={WORKERS_CI:'1',WORKERS_CI_BRANCH:'main'};
  const denied=[{}, {WORKERS_CI:'1'}, {WORKERS_CI:'1',WORKERS_CI_BRANCH:'feature'}, {WORKERS_CI:'1',WORKERS_CI_BRANCH:'Main'}, {WORKERS_CI:'1',WORKERS_CI_BRANCH:'refs/heads/main'}, {WORKERS_CI:'0',WORKERS_CI_BRANCH:'main'}, {WORKERS_CI:'true',WORKERS_CI_BRANCH:'main'}, {WORKERS_CI:'1',GITHUB_BASE_REF:'main'}, ...['1','','true','2','false','unknown'].map(SKIP_DEPLOY=>({...main,SKIP_DEPLOY}))];
  for(const values of denied){const r=run(values);assert.equal(r.status,0,JSON.stringify(values));assert.deepEqual(r.calls,[],JSON.stringify(values));}
}));
test('provider branch contradictions and tag refs cannot override the exact Workers source branch',()=>stubbedBuild(run=>{
  const main={WORKERS_CI:'1',WORKERS_CI_BRANCH:'main'};
  for(const key of ['CF_PAGES_BRANCH','GITHUB_REF_NAME','GITHUB_HEAD_REF','GITHUB_BASE_REF','CI_COMMIT_BRANCH','CI_COMMIT_REF_NAME','BITBUCKET_BRANCH','VERCEL_GIT_COMMIT_REF']){const r=run({...main,[key]:'feature'});assert.equal(r.status,0);assert.deepEqual(r.calls,[],key);}
  for(const GITHUB_REF of ['refs/heads/feature','refs/tags/main'])assert.deepEqual(run({...main,GITHUB_REF}).calls,[]);
  assert.deepEqual(run({...main,CI_COMMIT_TAG:'main'}).calls,[]);
}));
test('only exact Workers main and unset/zero skip reach one fixed-stub wrangler deploy',()=>stubbedBuild(run=>{
  const main={WORKERS_CI:'1',WORKERS_CI_BRANCH:'main'};
  for(const values of [main,{...main,SKIP_DEPLOY:'0'},{...main,SKIP_DEPLOY:'0',CF_PAGES_BRANCH:'main',GITHUB_REF_NAME:'main',GITHUB_REF:'refs/heads/main'}]){const r=run(values);assert.equal(r.status,0);assert.deepEqual(r.calls,['wrangler deploy']);}
}));
test('actual main deployment stub failure propagates its exit status without retry',()=>stubbedBuild(run=>{
  const r=run({WORKERS_CI:'1',WORKERS_CI_BRANCH:'main',TASK_BUILD_NPX_EXIT:'23'});assert.equal(r.status,23);assert.deepEqual(r.calls,['wrangler deploy']);
}));

test('Workers Builds のビルドコマンドは、これまでどおり通る', () => {
  // wrangler.toml の [build] command が build.sh を呼んでいること。
  // **ここを壊すと Git からの自動デプロイが止まる。**（以前、dist/ を誰も
  // 作らないまま versions upload へ進んで必ず失敗していた）
  const toml = read('wrangler.toml');
  assert.match(toml, /\[build\]/, '[build] が無い');
  assert.match(toml, /command\s*=\s*"SKIP_DEPLOY=1 bash build\.sh"/,
    'Workers Builds のビルドコマンドが変わっている');
});

test('tools/deploy.sh は、端末からでなければ動かない', () => {
  assert.ok(existsSync(join(ROOT, 'tools', 'deploy.sh')), '本番へ出す手順が無い');
  // 標準入力を端末でない形にして呼ぶ。**ここで止まらなければ自動実行できてしまう。**
  const run = spawnSync('bash', [join(ROOT, 'tools', 'deploy.sh')], {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
  });
  assert.notEqual(run.status, 0, '端末でないのに先へ進んだ');
  assert.match(run.stderr, /端末から人が実行/, '止めた理由を伝えていない');
});

test('フックが、本番を触るコマンドで実際に確認を出す', () => {
  const hook = join(ROOT, 'tools', 'confirm-deploy.sh');
  assert.ok(existsSync(hook), 'フックが無い');
  const ask = (command) => execFileSync('bash', [hook], {
    input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8',
  });
  const blocked = (command) => {
    const out = ask(command);
    assert.ok(out.includes('"permissionDecision":"ask"'), `確認なしで通した: ${command}`);
  };
  const allowed = (command) => {
    assert.equal(ask(command).trim(), '', `止めてはいけないものを止めた: ${command}`);
  };

  // 止める。**つなげた形・スクリプト越しでも止まること。**
  blocked('npx wrangler ' + 'deploy');
  blocked('cd /tmp && npx wrangler ' + 'deploy');
  blocked('bash build.sh && npx wrangler ' + 'deploy');
  blocked('npx wrangler ' + 'rollback 1234');
  blocked('npx wrangler versions ' + 'upload');
  blocked('npx wrangler ' + 'secret put OPENAI_API_KEY');
  blocked('bash tools/' + 'deploy.sh');
  // CI の名札を手元で名乗れば配信できてしまう。そこも塞ぐ。
  blocked('WORKERS' + '_CI=1 bash build.sh');

  // 通す。調べるだけのものと、ふだんの作業を止めない。
  allowed('bash build.sh');
  allowed('npx wrangler deployments list');
  allowed('npx wrangler versions list');
  allowed('git status');
  allowed('node --test tools/tests/*.test.cjs');
  allowed('python3 tools/lint_plan.py');
});

// **本番へ出る経路は wrangler だけではない。**
//
//   origin/main へのマージ / push  → Cloudflare Workers Builds が本番を差し替える
//   main への push(pv/storyboard)  → .github/workflows/deploy-pv-storyboard.yml
//
// どちらも「デプロイ」という語が出てこない。`git push origin main` と
// `gh pr merge` が、そのまま本番の差し替えである。
test('main へ載せる操作で確認を出し、枝の作業は止めない', () => {
  const hook = join(ROOT, 'tools', 'confirm-deploy.sh');
  const ask = (command) => execFileSync('bash', [hook], {
    input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
  });
  const blocked = (command) => assert.ok(ask(command).includes('"permissionDecision":"ask"'),
    `本番に出る操作を確認なしで通した: ${command}`);
  const allowed = (command) => assert.equal(ask(command).trim(), '',
    `枝の作業を止めた: ${command}`);

  blocked('git push origin main');
  blocked('git push -u origin main');
  blocked('git push origin HEAD:main');
  blocked('git push --force origin main');
  blocked('gh pr ' + 'merge 41');
  blocked('gh pr ' + 'merge --squash --auto 41');
  blocked('gh workflow ' + 'run deploy-pv-storyboard.yml');

  // 枝で仕事をする経路は塞がない。ここを塞ぐと作業が回らない。
  allowed('git push');
  allowed('git push -u origin claude/some-feature');
  allowed('git push origin HEAD');
  allowed('gh pr create --title x --body y');
  allowed('gh pr view 41');
  allowed('git status');
  allowed('git fetch origin');
  allowed('git merge origin/main');   // main を**取り込む**のは安全
});

test('main に居るときは、宛先を書かない push でも確認を出す', () => {
  // 宛先を書かない push は、いまの枝に出る。main に居れば本番に出る。
  const repo = mkdtempSync(join(tmpdir(), 'pushguard-'));
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  const out = execFileSync('bash', [join(ROOT, 'tools', 'confirm-deploy.sh')], {
    input: JSON.stringify({ tool_input: { command: 'git push' } }), encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  });
  assert.ok(out.includes('"permissionDecision":"ask"'), 'main に居るのに push を確認なしで通した');
  rmSync(repo, { recursive: true, force: true });
});

test('自動デプロイの引き金が、検査の知っているものと一致している', () => {
  // ワークフローが増えたり引き金が変わったら、ここが落ちる。
  // **落ちたら門を広げる。** 検査を消さない。
  const wf = read('.github/workflows/deploy-pv-storyboard.yml');
  assert.match(wf, /branches:\s*\n\s*-\s*main/, 'main 以外でも出るようになっている');
  assert.match(wf, /workflow_dispatch/, '手動実行の口が変わっている');
  // Cloudflare 側は wrangler.toml の [build] があること＝Git からの自動デプロイ
  assert.match(read('wrangler.toml'), /\[build\]/, 'Workers Builds の設定が無い');
});

test('プロジェクトの設定が、フックと確認の両方を持っている', () => {
  const settings = JSON.parse(read('.claude/settings.json'));
  const hooks = (settings.hooks && settings.hooks.PreToolUse) || [];
  const bash = hooks.find((h) => h.matcher === 'Bash');
  assert.ok(bash, 'Bash のフックが無い');
  assert.ok(bash.hooks.some((h) => h.command && h.command.includes('confirm-deploy.sh')),
    'フックがこのリポジトリの門を呼んでいない');

  // 本番は許可制。**確認の一覧に載っていること**を見る。
  // ここから外れると、確認なしで通る道ができる。
  const asked = (settings.permissions && settings.permissions.ask) || [];
  for (const want of ['deploy', 'rollback', 'secret', 'gh pr merge', 'push origin main']) {
    assert.ok(asked.some((rule) => rule.includes(want)), `確認の一覧に ${want} が無い`);
  }
  // 許可(allow)へ入れてしまうと、たずねずに通る。そこは塞ぐ。
  const allow = (settings.permissions && settings.permissions.allow) || [];
  for (const rule of allow) {
    assert.ok(!/deploy|rollback|secret|pr merge|push origin main/.test(rule),
      `本番を触る規則が許可に入っている: ${rule}`);
  }
});

test('全許可の wrangler を、許可に戻していない', () => {
  // `Bash(npx wrangler *)` が許可に入っていたせいで、deploy が確認なしで
  // 通っていた。**戻ってきていないこと**を見る。
  for (const file of ['.claude/settings.local.json', '.claude/settings.json']) {
    if (!existsSync(join(ROOT, file))) continue;
    const allow = (JSON.parse(read(file)).permissions || {}).allow || [];
    for (const rule of allow) {
      assert.ok(!/^Bash\((npx )?wrangler \*\)$/.test(rule),
        `${file} に wrangler の全許可が戻っている: ${rule}`);
    }
  }
});
