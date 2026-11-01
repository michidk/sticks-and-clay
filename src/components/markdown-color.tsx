import type { Components } from "react-markdown";

import { Badge } from "@/components/ui/badge";

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// Inline code that is exactly a hex color becomes a badge led by its swatch.
export const markdownColorComponents: Components = {
  code({ children, className, node: _node, ...props }) {
    const text = typeof children === "string" ? children : "";
    if (className || !HEX.test(text)) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <Badge variant="outline" className="gap-1.5 font-mono">
        <span
          aria-hidden
          className="inline-block size-3 shrink-0 rounded-sm border border-border"
          style={{ backgroundColor: text }}
        />
        {text}
      </Badge>
    );
  },
};
