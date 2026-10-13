"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type ViewerFeedback = { message: string; error: boolean };
export type ReportFeedback = (message: string, error?: boolean) => void;

/** Short-lived status message shown in the viewer's status part. */
export function useViewerFeedback() {
  const [feedback, setFeedback] = useState<ViewerFeedback | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clearTimer, [clearTimer]);
  const report = useCallback<ReportFeedback>(
    (message, error = false) => {
      setFeedback({ message, error });
      clearTimer();
      timer.current = setTimeout(() => setFeedback(null), 4500);
    },
    [clearTimer],
  );
  const clearFeedback = useCallback(() => {
    clearTimer();
    setFeedback(null);
  }, [clearTimer]);
  return { feedback, report, clearFeedback };
}
