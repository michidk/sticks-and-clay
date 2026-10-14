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
import { TooltipProvider } from "./primitives/tooltip";
import { cn } from "@/lib/utils";
import { indexHierarchy } from "./inspector-hierarchy";
import type { ModelInspection } from "./model-inspection";
import type { ModelInspectorPosition } from "./model-viewer-types";
import { ViewerControlButton as Button } from "./viewer-ui";
import "./model-viewer.css";

export type ModelInspectorProps = ComponentProps<"aside"> & {
  inspection: ModelInspection;
  selectedMesh?: string | null;
  onSelectMesh: (id: string | null) => void;
  onClose?: () => void;
  /** Side of the viewer used by the positioned inspector. Defaults to right. */
  position?: ModelInspectorPosition;
  className?: string;
};

export function ModelInspector({
  inspection,
  selectedMesh,
  onSelectMesh,
  onClose,
  position = "right",
  className,
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
    <TooltipProvider delay={350}>
      <aside
        data-slot="model-inspector"
        data-position={position}
        className={cn(
          "viewer-inspector flex flex-col overflow-x-hidden overflow-y-auto rounded-(--radius) border bg-popover text-[11px] text-popover-foreground shadow-md [scrollbar-width:thin] [&>*:not(ul)]:shrink-0",
          className,
        )}
        aria-labelledby={heading}
        {...props}
      >
        <header className="inspector-header flex items-center gap-2.5 border-b px-4 py-[15px] @max-[680px]/viewer:px-3 @max-[680px]/viewer:py-2.5">
          <span className="inspector-emblem grid size-[35px] place-items-center rounded-[calc(var(--radius)-2px)] border bg-secondary text-primary">
            <Box size={18} />
          </span>
          <div>
            <span className="inspector-eyebrow text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Scene overview
            </span>
            <h3 id={heading} className="mt-0.5 text-sm font-[650] tracking-[-0.02em]">
              Model inspector
            </h3>
          </div>
          {onClose && (
            <Button
              className="ml-auto"
              variant="ghost"
              size="icon-sm"
              aria-label="Close inspector"
              onClick={onClose}
            >
              <X size={16} />
            </Button>
          )}
        </header>
        <div className="inspector-metrics mx-3.5 my-[13px] grid grid-cols-3 gap-1.5 @max-[680px]/viewer:mx-3 @max-[680px]/viewer:my-[9px]">
          {[
            { label: "Triangles", value: inspection.triangles, Icon: Triangle },
            { label: "Materials", value: inspection.materials, Icon: Layers },
            { label: "Textures", value: inspection.textures, Icon: Image },
          ].map(({ label, value, Icon }) => (
            <div
              key={label}
              className="grid gap-1 rounded-[calc(var(--radius)-2px)] border bg-muted/40 p-2.5 @max-[680px]/viewer:gap-0.5 @max-[680px]/viewer:p-[7px]"
            >
              <Icon size={14} className="text-muted-foreground @max-[680px]/viewer:hidden" />
              <strong className="text-lg font-[650] tracking-[-0.04em] tabular-nums">
                {value.toLocaleString()}
              </strong>
              <span className="text-[9px] text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
        <section
          className="inspector-dimensions mx-3.5 mb-3.5 @max-[680px]/viewer:mx-3 @max-[680px]/viewer:mb-[9px]"
          aria-label="Dimensions"
        >
          <div className="inspector-section-label flex justify-between text-[10px] font-[650]">
            Dimensions{" "}
            <span className="text-[9px] font-normal text-muted-foreground">model units</span>
          </div>
          <div className="inspector-axis-values mt-[7px] grid grid-cols-3 gap-1.5">
            {inspection.dimensions.map((value, index) => (
              <div
                key={["X", "Y", "Z"][index]}
                className="flex items-center gap-[7px] rounded-md border px-2 py-1.5"
              >
                <span
                  data-axis={index}
                  className="text-[9px] font-[750] data-[axis=0]:text-[#b85b63] data-[axis=1]:text-[#58855c] data-[axis=2]:text-[#527da9]"
                >
                  {["X", "Y", "Z"][index]}
                </span>
                <strong className="font-mono text-[10px] font-medium wrap-anywhere">
                  {Number(value.toPrecision(4))}
                </strong>
              </div>
            ))}
          </div>
        </section>
        <div className="inspector-hierarchy-heading flex justify-between border-t px-4 pt-3 pb-2 @max-[680px]/viewer:px-3 @max-[680px]/viewer:pt-2 @max-[680px]/viewer:pb-1.5">
          <span className="inspector-section-label flex justify-between text-[10px] font-[650]">
            Hierarchy
          </span>
          <span className="text-[9px] text-muted-foreground">
            {inspection.nodes.filter((node) => node.mesh).length} meshes
          </span>
        </div>
        <label className="inspector-search mx-3.5 mb-2 flex items-center gap-2 rounded-[7px] border px-[9px] py-1.5 text-muted-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
          <Search size={14} />
          <input
            className="min-w-0 w-full bg-transparent text-[11px] text-foreground outline-none"
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
        <ul
          className="inspector-tree m-0 min-h-[60px] flex-1 list-none overflow-y-auto px-2.5 pb-2.5 [scrollbar-width:thin]"
          aria-label="Scene hierarchy"
        >
          {visible.slice(0, limit).map((node) => {
            const hasChildren = hierarchy.branches.has(node.id);
            return (
              <li
                data-slot="model-inspector-node"
                data-state={selectedMesh === node.id ? "selected" : undefined}
                key={node.id}
                style={{ paddingLeft: Math.min(node.depth, 8) * 12 }}
                className="flex items-center rounded-md data-[state=selected]:bg-secondary data-[state=selected]:shadow-[inset_2px_0_var(--primary)]"
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
                  <span className="inspector-spacer w-7 shrink-0" />
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="inspector-node min-w-0 flex-1 justify-start [&>span]:truncate"
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
        {visible.length === 0 && (
          <div className="inspector-empty px-3.5 py-[18px] text-muted-foreground">
            No objects match “{query}”.
          </div>
        )}
        <footer className="inspector-selection m-0 flex items-center gap-[9px] border-t bg-secondary/30 px-3.5 py-[11px] @max-[680px]/viewer:px-3 @max-[680px]/viewer:py-2">
          <Crosshair size={15} />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="text-[9px] text-muted-foreground">
              {selected ? "Selected object" : "Nothing selected"}
            </span>
            <strong className="truncate text-[10px] font-[550]">
              {selected?.name ?? "Choose a mesh to inspect"}
            </strong>
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
    </TooltipProvider>
  );
}
