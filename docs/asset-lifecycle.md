# Assets, versions, and review rounds

An **asset** is one item the owner wants to create. Its identity stays the same
while its brief, references, and generation settings change. A car, a switch
with a base and moving lever, and a set of related interface images can each
be one asset. Each asset belongs to one project.

A **version** is one generation attempt for an asset. Asking to iterate creates
a new version of that asset. Forking creates another asset. Failed versions,
AI requests, costs, source files, and rendered results stay in history.
The model page can also create a variation from a saved model. It copies the
model prompt, adds optional variation context, and uses the model's first
saved render as a reference image on a new asset. The source asset is unchanged.
Branches preserve the source version's sprite-generation settings. The original
prompt, requested change, and connecting text must fit the 12,000-character
prompt limit; an oversized branch request is rejected before creating records.
Retrying a failed job resumes that version with its saved checkpoints and Eve
session. It does not create a version.

A **build** is an output produced by a builder inside a version. A version can
contain several builds without becoming several assets.

A **review round** is an AI review and possible repair inside a version. It is
not another asset or version. For new v4 3D jobs, zero review rounds still
runs the four modeling passes. Older saved jobs keep their original pipeline.

A request for several assets at once (a count above one) creates its assets with the request's first line as a
stand-in title. When the planner names them, each asset and its version take the planner's name and own brief. An
idea's own title, written by the owner or by AI, is kept.

## Board stages

| Stage | Meaning |
| --- | --- |
| Ideas | The asset's brief can still be developed. Reopening a generated asset as a new idea copies its brief, settings and references into a fresh asset and leaves the original and its versions as they are. |
| Ready | The owner marked the asset's brief ready. This does not start paid work. |
| In progress | Generation is queued, running, waiting for a visual target decision, or needs recovery. |
| Review | The latest version finished and awaits the owner's decision. |
| Done | The owner explicitly accepted the finished version. |

A passing AI review does not accept the asset. Exhausting AI review rounds
can produce a finished version with issues for the owner to assess. The owner
can accept it or choose **Iterate** to create another version, with an optional
comment. Leaving the comment blank uses the current approved design and latest
saved result, just like regeneration. Iterate is available on every Review card,
even when the design version has not changed. Previous
versions remain available. A newer version requires a new
acceptance decision. Design and visual-target approval remain separate human
checkpoints.

**Abort** stops queued or running generation, including planning, and returns
the asset to its previous state. A first attempt returns to Ideas (still Ready if
it was Ready); an iteration leaves the earlier version as the card, in Review
or Done. The cancelled attempt stays in version history and accounting, and
already incurred provider costs remain.

Each asset page shows a **History** of every state its versions entered and every
change to the asset: creation, edits to its title, brief and settings (with the
brief before and after), Ready, starts, returns to Ideas, reference changes,
new versions, status changes, and acceptance. Database triggers on `assets` and
`asset_versions` write the append-only `asset_history` table, so any code path
that changes a status is recorded. Entries from before the log existed were
reconstructed from saved timestamps and are marked as such; their intermediate
states were not kept.

The project workspace lists these stages as a left-to-right strip, and the
global board shows them as columns with each asset's project and a project
filter. Both offer the same actions.

## References and parts

Project references describe shared visual direction. Asset references describe
one asset. Uploads use the same image picker in either case. A mockup can be
attached to the project design or a specific asset, with a note explaining
what to use from it.

Starting a version freezes its approved design, settings, parts, reference
images, and reference notes. Later edits affect future versions. They never
change a running version's contract.

Parts are named pieces of one asset. Three-dimensional parts remain named
objects in one shared Blender file and exported GLB. Image parts have separate
named files within the same version. Accepting the asset reviews the version
and its related parts together.

## Code vocabulary

Use `assetId` for the stable item, `versionId` for a generation attempt, and
`review round` for an AI repair cycle. Persisted legacy job kinds and checkpoint
keys retain their historical names so interrupted jobs remain resumable.
Materials also have versions, but keep their existing material workflow.

## Storage and migration

The asset table extends the former idea records so existing idea links keep
their identities. Versions stay separate records because each owns durable
jobs, checkpoints, files, and accounting. The migration groups iteration
ancestry under one asset, gives forks separate assets, and preserves every
result from older multi-result batches. Queued planner slots receive asset
identities before work begins.
