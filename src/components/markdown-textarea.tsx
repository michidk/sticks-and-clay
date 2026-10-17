import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Textarea } from "@/components/ui/textarea";

type MarkdownTextareaProps = Omit<
  React.ComponentProps<"textarea">,
  "value" | "onChange"
> & {
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
};

export function MarkdownTextarea({
  value,
  onChange,
  ...props
}: MarkdownTextareaProps) {
  const [preview, setPreview] = React.useState(false);
  // Uncontrolled use (no value prop) still needs the text for the preview.
  const [typed, setTyped] = React.useState("");
  const text = value ?? typed;
  return (
    <div className="markdown-input">
      <div className="markdown-input-toolbar">
        <span>Markdown supported</span>
        <button type="button" onClick={() => setPreview((p) => !p)}>
          {preview ? "Edit" : "Preview"}
        </button>
      </div>
      {/* Kept mounted while previewing so form submission still reads it. */}
      <div hidden={preview}>
        <Textarea
          value={value}
          onChange={(e) => {
            setTyped(e.target.value);
            onChange?.(e);
          }}
          {...props}
        />
      </div>
      {preview && (
        <div className="markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {text.trim() || "Nothing to preview."}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}
