import { acceptedMockups } from "./design-mockups.server";
import { workshopSchema, type WorkshopSnapshot } from "./workshop";
/** Freezes the collection settings and accepted mockups a new batch will build from. */
export async function snapshotWorkshop(
  projectId: string,
  value: unknown,
): Promise<WorkshopSnapshot> {
  return {
    ...workshopSchema.parse(value || {}),
    mockups: await acceptedMockups(projectId),
  };
}
