import { referenceNotesFor, workshopSchema, type WorkshopSnapshot } from "./workshop";
/** Freezes the collection settings and the owner's reference notes a new batch will build from. */
export function snapshotWorkshop(
  project: { references: string[]; referenceNotes: Record<string, string> },
  value: unknown,
): WorkshopSnapshot {
  return {
    ...workshopSchema.parse(value || {}),
    references: [...project.references],
    projectReferences: [...project.references],
    projectReferenceNotes: { ...project.referenceNotes },
    referenceNotes: referenceNotesFor(project.references, project.referenceNotes),
  };
}
