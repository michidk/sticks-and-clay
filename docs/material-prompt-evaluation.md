# Material prompt pilot

The live evaluation on 2026-10-11 uses the application's normal material builder,
Python renderer, independent visual judge, checkpoints and version persistence.
The model writes construction code; the material maps are generated locally by
Python. These trials do not call an image-generation API.

## Method

Compare the full builder policy with a deliberately abbreviated control, keeping
the toolkit guide, model (`gpt-6-sol`, high effort), briefs, seed 17, 256px output,
1m tile, 80mm features and two review rounds fixed. Each build permits at most two
runtime repairs. There are at most eight calls per trial; a passing review stops
early. Calibration is disabled and no external reference images are supplied.
The three briefs cover gravel with dirt pockets, boards with curved knot grain,
and painted metal with chips and scratches. Each has three named requirements.
The seed controls procedural construction; model sampling itself is not seeded.

This is an ablation pilot, not a comparison against a historical production
prompt. One sample per arm is too small to establish superiority. The same model
constructs and judges, so its coverage labels are useful diagnostic evidence,
not an independent human quality rating. Call latency includes provider waiting;
costs use the application's snapshotted estimates, not the gateway's invoice.

The initial trials freeze both prompt directories before execution. The source
base is commit `44b91ef`, with the then-uncommitted evaluation harness and coverage
schema/guard. Subsequent instruction and evidence fixes are excluded from those
trials. Saved runs retain exact system/input text and model usage; generated
bundles retain scripts, parameters, toolkit hashes and receipt-backed outputs.
The compact result record includes hashes and per-round coverage. Generated
assets and credentials remain outside the repository.

## Changes justified by the trials

The six paired trials completed with 26 calls and two runtime repairs. The full
policy did not outperform the abbreviated control in this sample.

| Brief | Policy | Outcome | Features present | Calls | Runtime repairs | Seconds | Estimated USD |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Gravel | Control | Issues | 2/3 | 5 | 1 | 200.4 | 0.1332 |
| Gravel | Full | Issues | 2/3 | 4 | 0 | 183.1 | 0.1165 |
| Wood | Control | Approved | 3/3 | 4 | 0 | 216.3 | 0.1410 |
| Wood | Full | Issues | 2/3 | 5 | 1 | 306.5 | 0.1857 |
| Paint | Control | Approved | 3/3 | 4 | 0 | 202.7 | 0.1392 |
| Paint | Full | Issues | 3/3 | 4 | 0 | 226.1 | 0.1419 |

Both gravel results lacked sufficient evidence for dirt-channel correspondence.
Wood's full-policy revision regressed the knot requirement. Full-policy paint
met all three named requirements, but the judge retained a major finding about
recognizable repeating wear. Feature coverage alone therefore does not imply
approval. These are model verdicts on a small stylized-material sample; review
the actual maps before generalizing the findings.

See [the recorded results](material-prompt-pilot.json) for per-round coverage,
findings, usage, source/toolkit hashes and output hashes.

- The builder in both arms treated `heightWindowMm` as a scalar. Document its
  two-value shape, physical decoding and the tuple returned by `derive_surface`
  in both the guide and per-call capabilities. Add executable composition
  examples and test them against the actual facade.
- Gravel judges could not establish dirt/roughness/height correspondence from
  the small sheet thumbnails. Supply native-resolution roughness, height and
  metallic maps alongside albedo, normal and lighting evidence.
- Require explicit feature coverage and block approval for missing or uncertain
  entries. Retain defaults when reading old saved reviews.
- Specify the score's 0 to 100 scale. Initial judges returned fractional values;
  those scores must not be compared with later scores or used as quality gains.
- The full wood trial removed a seam and excessive ribbing but lost readable
  grain curvature around knots. Instruct revisions to preserve established
  feature fields and correct the failing layer with a localized mask. This is
  a targeted response to a recorded regression, not a demonstrated quality gain.

## Focused follow-up

The updated gravel policy and evidence completed two build/review rounds without
a runtime repair. Both reviews marked all three requested features present,
including the dirt-channel relationship that was uncertain in the initial pair.
The result still finished with issues: the judge retained a major finding about
conspicuously repeating stone clusters. This supports the API/evidence fixes in
one example, not a general approval-rate improvement or a claim of visual quality.

The follow-up had four completed calls, 172.3 seconds after resume and USD 0.1115
in recorded estimates. An earlier builder call was interrupted when the thread
was stopped; its failed record is retained, but usage is unavailable. Total cost
and elapsed time are therefore incomplete and must not be compared as a saving
against the initial trial. [Follow-up results](material-prompt-followup.json)
record that unknown usage and the separate prompt hashes.

## Repeating the evaluation

Configure the provider through the existing private environment setup. Use an
isolated test database and data directory, with `STUDIO_PYTHON` pointing to the
configured material environment. Never put the API credential in an argument,
report, source file or committed environment file.

```sh
bun scripts/evaluate-material-prompts.ts /absolute/evaluation-directory
bun scripts/evaluate-material-prompts.ts /absolute/evaluation-directory --run
```

The first command prepares frozen inputs without calling the provider. The
second creates a dedicated evaluation project and records `evaluation.json`.
Running it again resumes incomplete work using saved checkpoints. A new directory
starts a new experiment. Optional `--case=gravel` and `--variant=full` select a
focused follow-up when preparing a new directory; an existing manifest retains
its original scope. Do not run the harness inside the application's worker: it
changes its own process working directory to select the frozen prompts.
