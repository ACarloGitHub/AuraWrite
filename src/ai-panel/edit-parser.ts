import type { AuraEdit } from "./operations";

export function parseAuraEdit(response: string): AuraEdit | null {
  const trimmed = response.trim();

  const delimitedMatch = trimmed.match(
    /<<<AURA_EDIT>>>\s*([\s\S]*?)\s*<<<END_AURA_EDIT>>>/,
  );
  if (delimitedMatch) {
    try {
      const parsed = JSON.parse(delimitedMatch[1]);
      if (parsed.aura_edit) return parsed;
    } catch {
      // continue
    }
  }

  const jsonBlockMatch = trimmed.match(/```json\n([\s\S]*?)\n```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1]);
      if (parsed.aura_edit) return parsed;
    } catch {
      // continue
    }
  }

  const keyMatch = trimmed.match(/\{"\s*aura_edit"\s*:/);
  if (keyMatch) {
    try {
      const startIdx = trimmed.indexOf('{"aura_edit"');
      let endIdx = trimmed.length - 1;
      let braceCount = 0;
      for (let i = startIdx; i < trimmed.length; i++) {
        if (trimmed[i] === "{") braceCount++;
        else if (trimmed[i] === "}") {
          braceCount--;
          if (braceCount === 0) {
            endIdx = i + 1;
            break;
          }
        }
      }
      const jsonStr = trimmed.slice(startIdx, endIdx);
      const parsed = JSON.parse(jsonStr);
      if (parsed.aura_edit) return parsed;
    } catch {
      // continue
    }
  }

  return null;
}

export function hasValidOperations(edit: AuraEdit): boolean {
  return (
    edit.aura_edit !== undefined &&
    Array.isArray(edit.aura_edit.operations) &&
    edit.aura_edit.operations.length > 0
  );
}
