"use client";

import {
  Box,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Image,
  Layers,
  Search,
  Triangle,
  X,
} from "lucide-react";
import { type ComponentProps, useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { indexHierarchy } from "./inspector-hierarchy";
import type { ModelInspection } from "./model-inspection";
import type { ModelInspectorPosition } from "./model-viewer-types";
import {
  ViewerControlButton as Button,
  type ViewerUiComponents,
  ViewerUiProvider,
} from "./viewer-ui";
import "./model-viewer.css";

export type ModelInspectorProps = ComponentProps<"aside"> & {
  inspection: ModelInspection;
  selectedMesh?: string | null;
  onSelectMesh: (id: string | null) => void;
  onClose?: () => void;
  /** Side of the viewer used by the positioned inspector. Defaults to right. */
  position?: ModelInspectorPosition;
  className?: string;
  components?: Partial<ViewerUiComponents>;
};

export function ModelInspector({
  inspection,
  selectedMesh,
  onSelectMesh,
  onClose,
  position = "right",
  className,
  components,
  ...props
}: ModelInspectorProps) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const heading = useId();
  const selected = inspection.nodes.find((node) => node.id === selectedMesh);
  const hierarchy = useMemo(() => indexHierarchy(inspection.nodes), [inspection.nodes]);
  const visible = useMemo(() => hierarchy.visible(query, collapsed), [hierarchy, query, collapsed]);
  const [page, setPage] = useState({ nodes: inspection.nodes, query, limit: 200 });
  const limit = page.nodes === inspection.nodes && page.query === query ? page.limit : 200;
  function changeQuery(next: string) {
    setQuery(next);
    setPage({ nodes: inspection.nodes, query: next, limit: 200 });
  }
  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <ViewerUiProvider components={components}>
      <aside
        data-slot="model-inspector"
        data-position={position}
        className={cn("viewer-inspector", className)}
        aria-labelledby={heading}
        {...props}
      >
        <header className="inspector-header">
          <span className="inspector-emblem">
            <Box size={18} />
          </span>
          <div>
            <span className="inspector-eyebrow">Scene overview</span>
            <h3 id={heading}>Model inspector</h3>
          </div>
          {onClose && (
            <Button variant="ghost" size="icon-sm" aria-label="Close inspector" onClick={onClose}>
              <X size={16} />
            </Button>
          )}
        </header>
        <div className="inspector-metrics">
          {[
            { label: "Triangles", value: inspection.triangles, Icon: Triangle },
            { label: "Materials", value: inspection.materials, Icon: Layers },
            { label: "Textures", value: inspection.textures, Icon: Image },
          ].map(({ label, value, Icon }) => (
            <div key={label}>
              <Icon size={14} />
              <strong>{value.toLocaleString()}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <section className="inspector-dimensions" aria-label="Dimensions">
          <div className="inspector-section-label">
            Dimensions <span>model units</span>
          </div>
          <div className="inspector-axis-values">
            {inspection.dimensions.map((value, index) => (
              <div key={["X", "Y", "Z"][index]}>
                <span data-axis={index}>{["X", "Y", "Z"][index]}</span>
                <strong>{Number(value.toPrecision(4))}</strong>
              </div>
            ))}
          </div>
        </section>
        <div className="inspector-hierarchy-heading">
          <span className="inspector-section-label">Hierarchy</span>
          <span>{inspection.nodes.filter((node) => node.mesh).length} meshes</span>
        </div>
        <label className="inspector-search">
          <Search size={14} />
          <input
            aria-label="Search hierarchy"
            placeholder="Find an object…"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
          />
          {query && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Clear search"
              onClick={() => changeQuery("")}
            >
              <X size={12} />
            </Button>
          )}
        </label>
        <ul className="inspector-tree" aria-label="Scene hierarchy">
          {visible.slice(0, limit).map((node) => {
            const hasChildren = hierarchy.branches.has(node.id);
            return (
              <li
                data-slot="model-inspector-node"
                data-state={selectedMesh === node.id ? "selected" : undefined}
                key={node.id}
                style={{ paddingLeft: Math.min(node.depth, 8) * 12 }}
                className={cn(selectedMesh === node.id && "is-selected")}
              >
                {hasChildren ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${collapsed.has(node.id) ? "Expand" : "Collapse"} ${node.name}`}
                    aria-expanded={!collapsed.has(node.id)}
                    onClick={() => toggle(node.id)}
                  >
                    {collapsed.has(node.id) ? (
                      <ChevronRight size={12} />
                    ) : (
                      <ChevronDown size={12} />
                    )}
                  </Button>
                ) : (
                  <span className="inspector-spacer" />
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="inspector-node min-w-0 flex-1 justify-start"
                  disabled={!node.mesh}
                  aria-pressed={node.mesh ? selectedMesh === node.id : undefined}
                  onClick={() => onSelectMesh(node.id)}
                >
                  {node.mesh ? <Box size={13} /> : <Layers size={13} />}
                  <span>{node.name}</span>
                  <small className="ml-auto rounded-sm bg-muted px-1 text-xs text-muted-foreground">
                    {node.mesh ? "Mesh" : node.type}
                  </small>
                </Button>
              </li>
            );
          })}
        </ul>
        {visible.length > limit && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage({ nodes: inspection.nodes, query, limit: limit + 200 })}
          >
            Show {Math.min(200, visible.length - limit)} more objects
          </Button>
        )}
        {visible.length === 0 && <div className="inspector-empty">No objects match “{query}”.</div>}
        <footer className="inspector-selection">
          <Crosshair size={15} />
          <div>
            <span>{selected ? "Selected object" : "Nothing selected"}</span>
            <strong>{selected?.name ?? "Choose a mesh to inspect"}</strong>
          </div>
          {selected && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clear selection"
              onClick={() => onSelectMesh(null)}
            >
              <X size={14} />
            </Button>
          )}
        </footer>
      </aside>
    </ViewerUiProvider>
  );
}
