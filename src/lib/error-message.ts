/** Turn raw provider failures stored on jobs into text a user can act on. */
export function describeError(raw: string | null | undefined) {
  const text = (raw ?? "").replace(/^Error:\s*/, "");
  if (/\b429\b|usage_limit|cooling down|rate limit/i.test(text)) {
    const model = text.match(/model\s+([\w./:-]+)/i)?.[1];
    return `The AI provider's usage limit${model ? ` for ${model}` : ""} has been reached. Wait for it to reset, or pick a different model under Admin → Agents, then retry.`;
  }
  return text;
}
