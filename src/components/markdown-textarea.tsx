import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

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
    <Tabs defaultValue="write" className="markdown-input">
      <div className="markdown-input-toolbar">
        <TabsList aria-label="Brief editor view">
          <TabsTrigger value="write" disabled={disabled}>
            Write
          </TabsTrigger>
          <TabsTrigger value="preview" disabled={disabled}>
            Preview
          </TabsTrigger>
        </TabsList>
        <span>Markdown supported</span>
      </div>
      <input type="hidden" name={name} value={value} disabled={disabled} />
      <TabsContent value="write">
        <Textarea
          className={className}
          disabled={disabled}
          value={value}
          onChange={onChange}
          {...props}
        />
      </TabsContent>
      <TabsContent value="preview">
        <div
          className={cn(
            "markdown markdown-input-preview",
            !value.trim() && "is-empty",
          )}
          role="region"
          aria-label="Brief preview"
        >
          {value.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
          ) : (
            <p>Nothing to preview yet.</p>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}
