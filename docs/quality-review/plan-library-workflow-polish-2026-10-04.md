# Comparison workflow polish: bounded fix batch

## Scope and ownership

This batch changes `assets/js/plan-library.js` and adds anonymous controller regressions in `tools/tests/plan-library-workflows.test.cjs` and real-native keyboard regressions in `tools/tests/plan-library-modal-keyboard.test.cjs`. It does not replace the native editor, its header handlers, JSON format, repository schema, legacy-copy/source-CAS rules, or original saved plans.

No menu, button, dialog, editor shell, or alternate command was added. The existing New-plan dialog/Create button, current-plan selector, pane-close button, dirty-choice dialog, sync checkbox and one-shot alignment button are reused. The upper header still owns only common inventory/layout/camera operations; each native pane owns its plan's save, JSON and editing actions.

The common saved inventory remains unlimited by the working-set limit. The working set retains at most four plan IDs and mounts at most two live editors.

## Defects fixed

- A successful pane switch now updates its iframe title and close-button accessible name together with the selected plan identity
- Sync controls and external camera-change callbacks now respect the same save/transition lock as plan/layout controls; removed or unready panes cannot become the active camera source
- One-shot alignment works independently of the continuing-sync toggle, and keeps each pane's own view mode/floor; walking and non-walking cameras remain incompatible
- The existing New action can save a plan when both panes or all four working slots are full. It reports that the plan was saved to the common inventory and how to open it later, without replacing dirty panes or reporting the successful save as a failure
- If startup fails after creating a plan, the status identifies the already-saved recovery path. A creation transaction/quota failure never claims success
- Existing dialogs have keyboard focus, accessible dialog semantics, Tab containment, Escape/backdrop cancellation and stale-button guards. Their capture-phase keydown guard isolates native scene/document shortcuts even when Escape closes the dialog; browser input/select/button defaults and native key-release cleanup remain live. Dismissing/replacing a dirty-choice dialog resolves its pending choice as Cancel instead of leaving a transition locked forever
- A collapsed dirty working plan still participates in the unsaved-tab-close warning. Closing its working pane retains the recovery draft but releases that plan from the working set
- The edit hook reuses one immutable snapshot for its draft write instead of immediately taking it twice. Save and transition paths keep their fresh-snapshot/CAS behavior. No measured speed claim is made

## Verification evidence

The 13 workflow Node/VM tests exercise the real PlanLibrary controller and repository with an anonymous DOM/editor test double and transactional IndexedDB model. Two additional tests execute the actual `index.html` window shortcut and document 3D keydown/keyup handlers through a capture/bubble dispatcher, with 3D handlers registered both before and after the library. They cover destructive/editing/movement shortcuts, input and button defaults, held-key release cleanup, and Escape isolation; an outside-dialog Delete control proves the unchanged native handler remains live. They verify operation sequencing, payloads, identity, dirty/history state, generations, failure handling and control properties. They do not establish native rendering, real-browser focus behavior or measured responsiveness.

The initial regression run failed before the fixes. After implementation, all 15 new regressions pass. The final focused native-controller/shared-lifecycle/native-keyboard run passes 67/67 tests. Independent review reproduced a modal shortcut leak in the first pass; the capture-phase guard and real-handler regressions fix that blocker, and the reviewer’s broader native shortcut probe passes.

Commands:

- `node --test tools/tests/plan-library-workflows.test.cjs tools/tests/plan-library-modal-keyboard.test.cjs`
- `node --test tools/tests/plan-library-workflows.test.cjs tools/tests/plan-library-modal-keyboard.test.cjs tools/tests/plan-library-native.test.cjs tools/tests/shared-plan-lifecycle.test.cjs`
- `node tools/check-html-js.cjs`
- `node --check assets/js/plan-library.js`
- `git diff --check`
- `sh tools/run_tests.sh`: final keyboard-fix tree completed with exit 1; 208 of 215 test files passed, plus the lint self-test. The same seven failing files are listed below and were rerun unchanged on the source checkout, where each also exits 1

Aggregate baseline-input failures:

- `finish-channels.test.cjs`: referenced models absent
- `model-quality.test.cjs`: referenced model/thumbnail/plan assets and certified car absent
- `model-uv.test.cjs`: required original model GLBs absent
- `original-models.test.cjs`: editable original Blender sources absent
- `room-floor.test.cjs`: `tools/tests/fixtures/raised-floor-plan.json` absent
- `scene-bed-axis-audit.test.cjs`: certified `Bed01.glb` absent
- `scene-car-front.test.cjs`: certified `precision_car_v1.glb` absent

These are not an aggregate pass. None of the seven failing test files or their input paths is changed by this batch.

`bash build.sh` is blocked at the unchanged scene-asset certificate check: `assets/models/refined/precision_car_v1.glb` is absent in this checkout and in the source checkout. The certificate gate was not weakened and no model was substituted. No deployment was attempted.

Native browser QA was not rerun for this batch. Prior environment verification reported the standalone browser's socket/ptrace restrictions and the supported cloud browser's loopback `ERR_BLOCKED_BY_CLIENT`; this batch does not install another browser or bypass those restrictions. Earlier browser artifacts are not a pass for this changed tree.

## Essential journey acceptance ledger

| Journey | Covered here or by existing Node regressions | Still requires native browser acceptance |
| --- | --- | --- |
| Open ordinary plan and launch comparison | Same plan ID/checkpoint, separate comparison session, current draft/legacy bytes preserved | Popup behavior, initial rendering, header reachability on phone/tablet |
| Open a saved plan from common inventory | Identity, newest clean head, corruption rejection, two-editor cap, mount rollback | Native load timing, 3D readiness, readable selected-plan label |
| Save each pane | Correct plan ID; CAS conflict, quota/abort, concurrent-edit `canClean`, Save-and-continue and unlock semantics | Actual Save button completion/feedback, renderer state after save, reload after real storage failure |
| Reload current plan | Protected installer, corrupt-read rejection, dirty decision paths | Native reload buttons/mobile menu, camera and editor-option restoration |
| Switch retained plans | Peer plan disabled; same identity/title; dirty Cancel/Save/discard behavior; view-write rollback | Real click/keyboard navigation, A→C→A in 2D/interior/exterior/walk views |
| Add plan | Free second pane; full two-pane/four-working-slot inventory save; fifth saved entry; repeated Create; failure recovery | Status discoverability and native New interaction at narrow widths |
| Collapse, reopen or close panes | Dirty/history draft retained; four working IDs/two live editors; unsaved-close warning membership; repeated-transition locks | Renderer/context disposal, repeated real 3D close/reopen, touch/scroll focus and layout |
| Sync and one-shot alignment | Sync-off independence; forced one-shot; view/floor ownership; walking boundary; busy/install guards; no scene revisions | Real 2D pan/zoom and 3D orbit/wheel/touch; target camera projection and visual parity |
| Interrupt/cancel/repeat | Escape/Tab state, capture-phase isolation against actual native shortcuts/3D listeners, input/button defaults, key-release cleanup, stale detached button no-op, replacement dialog resolves Cancel, repeated save/layout/Create gates | Native iframe-to-parent focus, Escape/backdrop/Tab cycling, history Back/Forward and refresh |
| Existing header benefits | No native header/JSON/render command was replaced in this batch | Full native action inventory, including data and render panels, across responsive breakpoints |

## Remaining release gates

This batch is not overall comparison-mode release acceptance.

- Preserve pane-specific lighting, ceiling view, grid, dimensions and snap through switching and close/remount using existing serialization. The current EditorPane state omits these options; this needs a separate compatibility-reviewed fix
- Define the expected benefit of online AI extraction and collaboration controls inside comparison panes. Current pane API restrictions remain; enabling them by simply removing the guard is not an accepted fix
- Run native desktop/tablet/mobile journeys above on the final integrated tree, including quota/corruption/rapid-repeat behavior and successful reload from the actual browser repository
- Restore the exact certified build assets, rerun the full build and independently review the integrated diff
- Publication/CI/deployment acceptance is separate from this local fix batch
