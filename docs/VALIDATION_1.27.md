# 1.27 Real validation

> Date: 2026-11-28 · Version 1.27.0 · macOS · temporary state clone

This is a real workflow run, not a mock. The original nine missions were not
modified: `missions.json`, uploads and bridge state were copied into a temporary
directory, a bridge was started on port 8790 with the copy, and the validation
mission was created there.

## Scenario

- Synthetic mission: **VALIDATION 真实模型闭环临时副本**
- One real provider call through the bridge (`anthropic` adapter; the
  provider-reported model alias is intentionally not published).
- Task: implement a small model/cost/evidence/sandbox acceptance package,
  including a pytest suite.
- Only a **validation price table** of `1.00 USD / 1M input` and
  `2.00 USD / 1M output` was set. It is not a vendor quote; it verifies the
  formula end to end.
- No network access was allowed inside the test sandbox.

## Result

| Item | Result |
| --- | --- |
| Provider / model | anthropic / provider-reported alias (not published) |
| Tokens in / out | **512 / 5,165** |
| Wall time (model call) | **16.5 s** |
| Artifacts | **10** files, including source, config, fixtures, README and `tests/test_acceptance.py` |
| Static verification | **passed** (syntax/structure; project tests were not run at this point) |
| Evidence receipt | **1 receipt**, attestation `bridge-local-hmac` / `local-member` / identity verified |
| Evidence chain | **valid**, no issues |
| Model-call ledger | 1 call, 0 failures, 5,677 total tokens |
| Cost | **0.010842 USD** from the validation prices (1 × 512/1M + 2 × 5,165/1M) |
| Sandbox runner | `python-pytest`, macOS seatbelt, network denied |
| Sandbox test counts | **6 tests: 3 passed, 3 failed**, exit 1 |

The three pytest failures were defects in the model-generated tests, not sandbox
escapes:

- a test called `socket.socket.connect(None, ...)` and raised `TypeError` instead
  of the expected `RuntimeError`;
- a generated evidence digest was not stable across two builds;
- a live-mode test did not raise when credentials were removed.

The executor correctly reported **failed**, preserved the output and did not
change the task to done. This is the behavior the product promises.

## Bug found and fixed during validation

The first pytest run failed before importing pytest:

```text
PermissionError: '/private/tmp/ao-pytest-venv/pyvenv.cfg'
```

The sandbox resolved a venv symlink to the base Python and granted only the base
interpreter root, not the venv root. `execution._runtime_roots()` now includes
both the symlink path and the resolved path, and a regression test covers a
symlinked venv. This fix is included in 1.27.0.

## Limitations

- One synthetic mission and one real model call; not a statistical benchmark.
- The cost is computed with a **test price table**, not a vendor price.
- pytest was installed in a throw-away `/tmp/ao-pytest-venv` for validation; the
  installed bridge still uses the system Python. To use pytest in normal product
  operation, install pytest into the bridge Python or use a custom test command.
- macOS seatbelt only in this run. Linux/Windows were not available on this
  machine.
- External Agent identity was not exercised against a live Codex/DeepSeek
  process in this run; the receipt source was a local mission member.

## Reproduction outline

1. Copy `~/.agent-office` state to a temporary directory.
2. Write a validation-only price table in the temporary `providers.json`.
3. Start `bridge.py --port 8790` with `BRIDGE_STATE_DIR` and
   `BRIDGE_PROVIDERS` pointing at the copy.
4. Create a small mission with built-in roles; run one task.
5. Query `/missions/<id>`, `/model-calls`, `/missions/<id>/evidence/verify`.
6. With a pytest-enabled Python (throw-away venv), start the bridge and call
   `POST /missions/<id>/tasks/<taskId>/run-tests`.

The original bridge state and missions were not touched.
