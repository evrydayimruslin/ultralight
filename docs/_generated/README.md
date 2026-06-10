# Generated Release Evidence

This directory is the home for generated launch evidence and other operator
artifacts that are useful during release work but usually should not be kept in
git.

The canonical policy is documented in
[docs/LAUNCH_EVIDENCE_REGISTRY.md](../LAUNCH_EVIDENCE_REGISTRY.md).

## What Goes Here

- local staging and production release evidence under `launch/`
- audit JSON outputs from Wave 4 and Wave 6 release tasks
- smoke summaries and logs
- manual smoke notes and optional screenshots

## What Stays In Git

This directory keeps only:

- this README
- local ignore rules
- any future deliberately redacted example artifacts

Real release evidence should be treated as local-only by default unless it has
been explicitly sanitized and reviewed for commit safety.

## Recommended Layout

```text
docs/_generated/
  launch/
    staging/
    production/
```

Use the candidate-specific layout from
[docs/LAUNCH_EVIDENCE_REGISTRY.md](../LAUNCH_EVIDENCE_REGISTRY.md)
for actual runs.
