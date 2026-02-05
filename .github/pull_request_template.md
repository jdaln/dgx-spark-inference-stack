# Pull Request

## Type of Change
- [ ] 🤖 New Model / Model Update
- [ ] 🐛 Bug Fix
- [ ] ✨ New Feature
- [ ] 📚 Documentation Update
- [ ] 🛡️ Security Fix

## Description
Please include a summary of the change and which issue is fixed.

## Validation & Testing Criteria (CRITICAL)

**If adding or modifying a model, you must check the following:**

- [ ] **Tool Calling Verification**: I have verified that the model correctly handles tool calls (if enabled) and does not output raw XML/JSON thinking tokens to the user unexpectedly.
- [ ] **Hardware Compatibility**: I have tested this on the target hardware (DGX Spark / GB10) and confirmed it does not OOM or crash vLLM.
- [ ] **Production Proven**: I have run this specific configuration in a production-like environment for **at least a few days** without stability issues.
- [ ] **No-Log Compliance**: I have verified that any new container or service adheres to the strict "No-Log Policy" (disabled request logging).

## Checklist
- [ ] My code follows the style guidelines of this project.
- [ ] I have performed a self-review of my own code.
- [ ] I have commented my code, particularly in hard-to-understand areas.
- [ ] I have made corresponding changes to the documentation.
