/** Retired Astra selections, including saved sessions, use Sol. */
export function textModel(model: string) {
  const id = model.replace(/^openai\//, "");
  return /astra/i.test(id) ? "gpt-6-sol" : id;
}
