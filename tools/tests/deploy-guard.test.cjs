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
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFileSync, existsSync } = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = join(__dirname, '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('build.sh は、ビルドするだけで本番に出さない', () => {
  const src = read('build.sh');
  // 行頭のコマンドとしての wrangler 呼び出しが無いこと（説明の文中は除く）
  const lines = src.split('\n').filter((l) => !l.trim().startsWith('#'));
  for (const line of lines) {
    assert.ok(!/wrangler\s+(deploy|versions)/.test(line),
      `build.sh がデプロイを実行している: ${line.trim()}`);
  }
  // 出さないことを、実行した人に伝えていること
  assert.match(src, /本番には出していません/, 'ビルドだけだと伝えていない');
  assert.match(src, /tools\/deploy\.sh/, '本番へ出す手順を案内していない');
});

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

test('フックが、本番を触るコマンドを実際に止める', () => {
  const hook = join(ROOT, 'tools', 'deny-deploy.sh');
  assert.ok(existsSync(hook), 'フックが無い');
  const ask = (command) => execFileSync('bash', [hook], {
    input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8',
  });
  const blocked = (command) => {
    const out = ask(command);
    assert.ok(out.includes('"permissionDecision":"deny"'), `止めていない: ${command}`);
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

  // 通す。調べるだけのものと、ふだんの作業を止めない。
  allowed('bash build.sh');
  allowed('npx wrangler deployments list');
  allowed('npx wrangler versions list');
  allowed('git status');
  allowed('node --test tools/tests/*.test.cjs');
  allowed('python3 tools/lint_plan.py');
});

test('プロジェクトの設定が、フックと拒否の両方を持っている', () => {
  const settings = JSON.parse(read('.claude/settings.json'));
  const hooks = (settings.hooks && settings.hooks.PreToolUse) || [];
  const bash = hooks.find((h) => h.matcher === 'Bash');
  assert.ok(bash, 'Bash のフックが無い');
  assert.ok(bash.hooks.some((h) => h.command && h.command.includes('deny-deploy.sh')),
    'フックがこのリポジトリの門を呼んでいない');

  const deny = (settings.permissions && settings.permissions.deny) || [];
  for (const want of ['deploy', 'rollback', 'secret']) {
    assert.ok(deny.some((rule) => rule.includes(want)), `拒否に ${want} が無い`);
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
