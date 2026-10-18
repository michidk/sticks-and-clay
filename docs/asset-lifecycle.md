# Assets, versions, and review rounds

An **asset** is one item the owner wants to create. Its identity stays the same
while its brief, references, and generation settings change. A car, a switch
with a base and moving lever, and a set of related interface images can each
be one asset. Each asset belongs to one project.

A **version** is one generation attempt for an asset. Asking to iterate creates
a new version of that asset. Forking creates another asset. Failed versions,
AI requests, costs, source files, and rendered results stay in history.
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
| Ideas | The asset's brief can still be developed. Returning here preserves its versions. |
| Ready | The owner marked the asset's brief ready. This does not start paid work. |
| In progress | Generation is queued, running, waiting for a visual target decision, or needs recovery. |
| Review | The latest version finished and awaits the owner's decision. |
| Done | The owner explicitly accepted the finished version. |

A passing AI review does not accept the asset. Exhausting AI review rounds
can produce a finished version with issues for the owner to assess. The owner
can accept it or request another version. A newer version requires a new
acceptance decision. Design and visual-target approval remain separate human
checkpoints.

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
