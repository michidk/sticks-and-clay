"use client";
import { ModelInspector, type ModelInspectorProps } from "./model-inspector";
import { useModelViewer } from "./model-viewer-context";

export type ModelViewerInspectorProps = Omit<
  ModelInspectorProps,
  "inspection" | "selectedMesh" | "onSelectMesh"
>;

/** Connected inspector; ModelInspector remains available for standalone data. */
export function ModelViewerInspector({ onClose, ...props }: ModelViewerInspectorProps) {
  const viewer = useModelViewer();
  if (!viewer.inspectorOpen || !viewer.inspection) return null;
  return (
    <ModelInspector
      inspection={viewer.inspection}
      selectedMesh={viewer.selectedMesh}
      onSelectMesh={viewer.setSelectedMesh}
      onClose={() => {
        viewer.setInspectorOpen(false);
        onClose?.();
      }}
      {...props}
    />
  );
}
