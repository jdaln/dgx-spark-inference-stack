# Model Bring-Up Agent Guide

Use this file when your task is to add, adapt, or validate a new model in this repo.

This stack is not "done" when a container starts or when a direct `/v1/chat/completions` call returns `200`. A new model is only considered wired correctly after the real gateway path works on this host and the repo records the validated constraints.

## Principles

- Do not run Python on the host. Run Python only inside containers.
- Prefer containerized pulls, conversions, and probes over host-direct commands.
- Reuse the nearest existing model or family shape before inventing a new runtime pattern.
- Read the model card before assuming the runtime shape. Some checkpoints need a nonstandard runner, direct snapshot path, custom template, parser plugin, or quantization flags that do not match the nearest family by name.
- Keep changes minimal. Only add validator logic, parser plugins, templates, or custom images when the model actually needs them.
- Do not change `gateway.conf` for a normal model addition. New models should route through `models.json` plus `request-validator`.
- Treat every new model as `experimental` until gateway-path validation and context soak are complete.
- A healthy direct path does not prove the gateway path. Validate both.

## Workflow

1. Pick the nearest existing family and copy that runtime shape first. Reuse an existing compose fragment if possible.
2. Add or edit the model service in the relevant `compose/models-*.yml` file.
3. Add the model entry in `models.json` with the correct container name, `maxModelLen`, lifecycle, `toolSupport`, and an honest `experimental` note.
4. Update `request-validator` only if the model needs request-shape normalization that cannot be handled by the existing defaults. Add or update tests when you do.
5. If the model needs a custom parser, template, or runtime overlay, add the narrowest possible asset and a focused regression for it.
6. Run the structural checks before bring-up:
   - `bash tools/validate-stack.sh`
   - `bash tools/check-models.sh`
7. Bring the model up with the repo harness when possible:
   - `bash tools/run-model.sh --timeout 7200 --no-build <model-id>`
8. If long pulls or fragile cold starts are being interrupted by the control plane, temporarily stop it during that phase, then restore it before final validation.
9. If you changed `models.json` or `request-validator`, reload the live control plane before drawing conclusions from gateway behavior:
   - `bash tools/reload-control-plane.sh`
10. Probe the direct model path for the capabilities the model claims to support.
11. Probe the real gateway path with the same shapes. If you had to add a parser, template, or wrapper, add a targeted live gateway regression under `tools/`.
12. If the model claims tool support, validate structured `tool_calls` on the gateway path for the modes the stack will expose, usually both `tool_choice=auto` and `tool_choice=required`.
13. Run the shared gateway smoke matrix:
   - `bash tools/smoke-gateway.sh`
14. Run a real context soak on the gateway path. Never trust the raw checkpoint card or `max_position_embeddings` alone:
   - `node tools/soak-context.mjs --model <model-id> --target-prompt-tokens <n>`
15. Once validation is complete, commit the production runtime shape rather than the noisy debug shape. Disable access/request/stats logs in compose using the flags that the specific runtime image supports.
16. Update repo docs after validation, not before.

## Common Pitfalls

- Compose bind mounts are resolved relative to the compose fragment location. Check them carefully when mounting repo assets.
- The files a container mounts may not be the files you think you downloaded. Confirm the live model store, not just a repo-local copy.
- Model-family similarity can be misleading. If the card or snapshot layout says the checkpoint wants a different runner, tokenizer/config format, quantization mode, or chat template path, treat that as the starting constraint instead of trying to force the house default first.
- Waker and the control plane can interfere with slow cold starts or long pulls.
- `waker` and `request-validator` read the bind-mounted `/config/models.json` at startup. Rebuilding an image is not enough if the host `models.json` entry is still stale, and gateway behavior can disagree with direct-path behavior until you reload the control plane.
- Direct-path success and gateway-path success are different checks.
- If a model claims tool support, verify structured `tool_calls`, not just a `200` response, and check both direct and gateway paths before promoting the lane.
- Do not leave verbose runtime logging enabled after bring-up. Use the image-appropriate access/request/stats log suppression flags before treating the compose service as final.

## Deliverable

When you finish a new-model task, leave the repo in a state where another contributor can see:

- which files were changed
- the exact runtime shape that worked
- the exact validations that passed
- the remaining risks or unvalidated areas

If any of those are missing, the bring-up is not finished.
