## Change

What changes and why. Link the issue if there is one.

## Checks

- [ ] `bash tools/validate-stack.sh` and `bash tools/check-models.sh` pass.
- [ ] Validator or waker changes: their tests pass (see `skills/stack-checks/SKILL.md`).

For a new or changed model:

- [ ] Tested on a DGX Spark (GB10): the model starts and does not run out of memory.
- [ ] `bash tools/test-lane.sh <model-id>` passes through the gateway, tool calls included
      if the model claims them.
- [ ] Context soak with `tools/soak-context.mjs`; the result is in the model's `notes`.
- [ ] Request, access and stats logs are off in the compose service.
- [ ] `docs/models.md` is updated.
