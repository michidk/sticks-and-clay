import type { assetEntries, projects } from "../db/schema";
import { MAX_REFERENCE_IMAGES } from "./image-file";
import { mockupReferences, referenceNotesFor, type WorkshopSnapshot } from "./workshop";
import { snapshotWorkshop } from "./workshop.server";

/** One ordered set is used by planning, building and judging a queued version. */
export function assetSnapshot(
  project: Pick<typeof projects.$inferSelect, "references" | "referenceNotes" | "workshop">,
  asset: Pick<typeof assetEntries.$inferSelect, "references" | "referenceNotes" | "input">,
  base?: WorkshopSnapshot,
): WorkshopSnapshot {
  const projectReferences = base?.projectReferences ?? base?.references ?? project.references;
  // Legacy snapshots have only the combined list, so retain its keys and recover notes by position.
  const projectReferenceNotes = base?.projectReferenceNotes ?? (base
    ? Object.fromEntries((base.referenceNotes ?? []).flatMap(({ position, note }) => {
        const key = projectReferences[position - 1];
        return key ? [[key, note]] : [];
      }))
    : project.referenceNotes);
  const references = [...new Set([...projectReferences, ...asset.references, ...mockupReferences(base)])];
  if (references.length > MAX_REFERENCE_IMAGES)
    throw new Error(`Use at most ${MAX_REFERENCE_IMAGES} reference images across the project and asset`);
  return {
    ...(base ?? snapshotWorkshop(project, project.workshop)),
    projectReferences: [...projectReferences],
    projectReferenceNotes: { ...projectReferenceNotes },
    references,
    referenceNotes: referenceNotesFor(references, { ...projectReferenceNotes, ...asset.referenceNotes }),
    parts: asset.input.parts,
  };
}
