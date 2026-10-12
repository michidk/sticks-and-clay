import type { ReactNode } from "react";
import { Card, CardContent } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { cn } from "@/lib/utils";

export function LoadingRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

export function TextSkeleton({
  label = "Loading content",
  lines = 4,
}: {
  label?: string;
  lines?: number;
}) {
  return (
    <LoadingRegion label={label} className="py-4">
      <div className="space-y-3">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton
            key={i}
            className={cn("h-3 w-full", i === lines - 1 && "w-2/3")}
          />
        ))}
      </div>
    </LoadingRegion>
  );
}

export function CardsSkeleton({
  label = "Loading projects",
  covers = true,
  count = 6,
}: {
  label?: string;
  covers?: boolean;
  count?: number;
}) {
  return (
    <LoadingRegion label={label}>
      <div className="project-grid">
        {Array.from({ length: count }, (_, i) => (
          <Card key={i} className="overflow-hidden border-[#dce1d5]">
            {covers && <Skeleton className="h-[205px] rounded-none" />}
            <CardContent className="space-y-5 p-6">
              <Skeleton className="h-5 w-3/4" />
              <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
              <div className="flex justify-between border-t pt-4">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-3 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function WorkspaceSkeleton() {
  return (
    <LoadingRegion label="Opening project">
      <div className="space-y-8 pt-5">
        <Skeleton className="h-3 w-40" />
        <div className="space-y-4">
          <Skeleton className="h-10 w-3/4 max-w-xl" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="flex gap-6 border-b border-[#dce3d3] pb-4">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-4 w-16" />
          ))}
        </div>
        <div className="project-grid">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}

export function QueueSkeleton() {
  return (
    <LoadingRegion label="Loading queue">
      <div className="space-y-6">
        <Skeleton className="h-4 w-48" />
        {Array.from({ length: 3 }, (_, i) => (
          <Card key={i} className="space-y-5 border-[#dce1d5] p-6">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2 w-full" />
          </Card>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function ViewerSkeleton({ overlay = false }: { overlay?: boolean }) {
  return (
    <LoadingRegion
      label="Loading 3D model"
      className={overlay ? "absolute inset-0" : "viewer"}
    >
      <Skeleton className="absolute inset-0 flex items-center justify-center rounded-lg">
        <div className="size-24 rotate-12 rounded-2xl border border-border bg-background/40" />
      </Skeleton>
    </LoadingRegion>
  );
}
