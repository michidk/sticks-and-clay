# Evaluate material prompts

`scripts/evaluate-material-prompts.ts` compares the full material-builder instructions with an abbreviated control using the application's renderer, independent judge, checkpoints, and version persistence. Material maps are constructed locally by Python. The harness uses paid text-model calls when `--run` is present.

Configure a separate migrated database, a private provider credential, an isolated `STUDIO_DATA_DIR`, and an absolute `STUDIO_PYTHON` path. Do not run the harness inside the web server or worker: it changes its process directory to select frozen prompts.

```sh
bun scripts/evaluate-material-prompts.ts /absolute/evaluation-directory
bun scripts/evaluate-material-prompts.ts /absolute/evaluation-directory --run
```

The first command freezes inputs without contacting the provider. The second creates a dedicated evaluation project and records results in `evaluation.json`. Reusing the directory resumes incomplete work; a new directory starts a new experiment. Optional `--case=gravel` and `--variant=full` select a focused trial when preparing a new directory. Existing manifests retain their scope.

The paired cases cover gravel, wood, and painted metal. Each brief names three required features. Both arms share the model, toolkit guide, seed, tile dimensions, resolution, and upper review/repair budgets. Passing reviews stop early. The procedural seed does not make model sampling deterministic.

Keep generated maps, transcripts, reports, and credentials outside Git. Inspect final-resolution images before interpreting the judge's coverage labels. A small trial with the same model family constructing and judging does not establish general artistic quality or statistical superiority. Latency includes provider waiting; recorded costs are estimates, not invoices.
