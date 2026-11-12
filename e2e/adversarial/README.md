# Adversarial prompt fixtures

The AI Office repository maintainers own this fixture pack. Update it when a new external-content source, prompt boundary, approval path, or memory trust rule is added.

`fixtures.ts` contains inert test strings only. `injection.spec.ts` feeds them through prompt assembly and verifies policy denial and untrusted memory status in isolated mock services.
