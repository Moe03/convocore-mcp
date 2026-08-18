/**
 * Cursor-style exact string patch helpers.
 * Used by patch_agent_prompt / patch_kb_doc so hosts can surgically edit
 * large prompts and KB content without rewriting the whole document.
 */

export type ExactReplaceSuccess = {
  ok: true;
  updated: string;
  occurrences: number;
};

export type ExactReplaceFailure = {
  ok: false;
  error: string;
  occurrences: number;
};

export type ExactReplaceResult = ExactReplaceSuccess | ExactReplaceFailure;

/** Count non-overlapping occurrences of `needle` in `haystack`. */
export function countExactOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (from <= haystack.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
}

/**
 * Exact string replace (same semantics as Cursor StrReplace):
 * - old_string must match exactly (including whitespace)
 * - fails if 0 matches
 * - fails if >1 match unless replace_all is true
 * - old_string and new_string must differ
 */
export function applyExactStringReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false
): ExactReplaceResult {
  if (oldString.length === 0) {
    return {
      ok: false,
      error:
        'old_string must be non-empty. Provide the exact text to find (include enough surrounding context to make it unique).',
      occurrences: 0,
    };
  }

  if (oldString === newString) {
    return {
      ok: false,
      error: 'old_string and new_string must be different (no-op patch rejected).',
      occurrences: 0,
    };
  }

  const occurrences = countExactOccurrences(content, oldString);

  if (occurrences === 0) {
    return {
      ok: false,
      error:
        'old_string not found in the target content. Re-read with get_agent / get_kb_doc and copy the exact text (whitespace-sensitive) into old_string. Include more surrounding context if needed.',
      occurrences: 0,
    };
  }

  if (occurrences > 1 && !replaceAll) {
    return {
      ok: false,
      error: `Found ${occurrences} occurrences of old_string. Provide a larger unique old_string, or set replace_all=true to change every match.`,
      occurrences,
    };
  }

  const updated = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString);

  return {
    ok: true,
    updated,
    occurrences: replaceAll ? occurrences : 1,
  };
}

export function unwrapRecord(payload: unknown): Record<string, any> {
  if (!payload || typeof payload !== 'object') return {};
  const root = payload as Record<string, any>;
  if (root.data && typeof root.data === 'object' && !Array.isArray(root.data)) {
    return root.data as Record<string, any>;
  }
  return root;
}
