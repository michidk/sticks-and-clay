"use client";
import { useCallback, useState } from "react";

/** Controlled/default/onChange triplet; the third item resets the uncontrolled value silently. */
export function useControlledState<T>(
  controlled: T | undefined,
  defaultValue: T,
  onChange?: (value: T) => void,
): [T, (value: T) => void, (value: T) => void] {
  const [internal, setInternal] = useState(defaultValue);
  const value = controlled === undefined ? internal : controlled;
  const setValue = useCallback(
    (next: T) => {
      if (controlled === undefined) setInternal(next);
      onChange?.(next);
    },
    [controlled, onChange],
  );
  return [value, setValue, setInternal];
}
