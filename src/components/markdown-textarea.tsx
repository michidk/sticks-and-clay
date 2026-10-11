import * as React from "react";

import { Textarea } from "@/components/ui/textarea";

type MarkdownTextareaProps = Omit<
  React.ComponentProps<"textarea">,
  "name" | "value" | "onChange"
> & {
  name: string;
  value: string;
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
};

export function MarkdownTextarea({
  className,
  disabled,
  name,
  value,
  onChange,
  ...props
}: MarkdownTextareaProps) {
  return (
    <div className="markdown-input">
      <div className="markdown-input-toolbar">
        <span>Markdown supported</span>
      </div>
      <Textarea
        className={className}
        disabled={disabled}
        name={name}
        value={value}
        onChange={onChange}
        {...props}
      />
    </div>
  );
}
