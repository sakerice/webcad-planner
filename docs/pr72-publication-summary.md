# PR72 local publication candidate

This snapshot uses the existing PR72 remote commit as its only parent. It keeps reviewed runtime source and the separate local deployment guard, without publishing the intervening development/QA history. No push, PR update, merge or deployment is performed by producing this candidate.

## Runtime and limits

The opt-in local internal API reuses the catalogue, SceneIR compiler and actual editor: `read_catalog`, `get_scene`, and `preview_patch`. Patches compile detached source snapshots and render an isolated memory-only proposal with the same camera. Revision/source/catalogue fences and native-render proofs reject stale or fallback results. The original DATA/history/redo/dirty/raw/options/storage stay unchanged. Apply is outside this API.

The optional tailored-sofa regional profile maps exact retained raw body/seat colors to the audited native asset. It leaves source geometry and unknown height intact; model height, fixed legs/seams and front are explicit display assumptions. Complete reconstruction and Apply remain unavailable. See [profile contract](scene-ir/native-appearance-profile-v1.md) and [internal API schemas](internal-api/README.md).

`build.sh` may call its deployment step only with exact `WORKERS_CI=1`, `WORKERS_CI_BRANCH=main`, unset/zero `SKIP_DEPLOY`, and no contradictory provider branch/tag. Tests use fixed stubs and never real Wrangler. This local gate cannot constrain a separate Workers Builds dashboard deploy command. Dashboard branch/command settings remain unconfirmed, so branch push safety is not certified.

## Reproduce

Run Node tests from the repository root:

```sh
node --test tools/tests/*.test.cjs
```

For the actual native replay, use a new browser process/profile and dedicated loopback port, with an existing Playwright installation. It blocks external and `/api/` traffic and does not attach existing tabs or call AI.

```sh
WEBCAD_PREVIEW_PORT=65360 python3 local-preview/server.py
APP_URL=http://127.0.0.1:65360 OUTPUT_DIR=/tmp/webcad-native-profile-replay \
  PLAYWRIGHT_MODULE=/path/to/playwright \
  node tools/tests/native-appearance-profile.browser.cjs
```

The replay submits exactly two hand-authored patches: missing dependent room binding returns diagnostics; adding that binding renders one native sofa plus floor. Reports/screenshots distinguish actual Chrome rendering from Node callbacks. Stop only the server/browser processes you started. Protected ports 63239/65236 and historical candidate-run port 65352 must remain untouched.

## Publication-only changes

Large new QA logs, screenshots and local profile/path records are excluded. Their originals remain in the reviewed source tree and private Library review packet. Required public sample fixture plans, door review results and API contracts are moved byte-for-byte. Two historical browser baselines become explicit immutable fixtures instead of requiring unpublished Git objects. Test output paths become portable. The material/structure historical-ledger checks require `FROZEN_LEDGER_PATH` to an explicitly materialized original ledger and still assert exact preservation.

Frozen AI extraction schema/prompt/freeze, raw snapshots, native asset/manifests and existing source facts are preserved. The source and publication-only file changes are distinguished in the accompanying handoff manifest. Original historical counts and candidate ledgers are not recomputed or overwritten by this snapshot.
