/** Only link numbered actual renders, never concept/reference image numbers. */
export function reviewImageNumbers(view: string, renderCount: number) {
  const numbers = new Set<number>();
  for (const match of view.matchAll(/images?\s+(\d+)(?:\s*[-–—]\s*(\d+))?/gi)) {
    const start = Number(match[1]);
    const end = Math.min(Number(match[2] || match[1]), renderCount);
    for (let i = Math.max(1, start); i <= end; i++) numbers.add(i);
  }
  return [...numbers].sort((a, b) => a - b);
}
