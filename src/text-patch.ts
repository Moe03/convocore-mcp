/**
 * Cursor-style string patch helpers with whitespace-tolerant fallback.
 * Used by patch_agent_prompt / patch_kb_doc so hosts can surgically edit
 * large prompts and KB content without rewriting the whole document.
 */

export type ReplaceMode = 'exact' | 'line_endings' | 'whitespace_flexible';

export type ExactReplaceSuccess = {
  ok: true;
  updated: string;
  occurrences: number;
  mode: ReplaceMode;
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

function normalizeLineEndings(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Escape a string for use inside a RegExp character-safe literal, then turn
 * each run of whitespace into `\s+` so CRLF/indent/trailing-space drift still matches.
 */
export function buildWhitespaceFlexiblePattern(needle: string): RegExp | null {
  const trimmed = needle.trim();
  if (!trimmed) return null;

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flexible = escaped.replace(/\s+/g, '\\s+');
  if (!flexible) return null;

  try {
    return new RegExp(flexible, 'g');
  } catch {
    return null;
  }
}

export type FlexibleMatch = { start: number; end: number; matched: string };

/** Find non-overlapping whitespace-flexible matches of needle in haystack. */
export function findWhitespaceFlexibleMatches(
  haystack: string,
  needle: string
): FlexibleMatch[] {
  const pattern = buildWhitespaceFlexiblePattern(needle);
  if (!pattern) return [];

  const matches: FlexibleMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(haystack)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, matched: m[0] });
    if (m[0].length === 0) {
      pattern.lastIndex += 1;
    }
  }
  return matches;
}

/**
 * Pick a short distinctive line from needle and, if found in haystack,
 * return a nearby excerpt so callers can copy the exact text.
 */
export function nearestMatchHint(haystack: string, needle: string): string | undefined {
  const lines = needle
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 12);

  // Prefer longer lines (more distinctive).
  const candidates = [...lines].sort((a, b) => b.length - a.length).slice(0, 6);
  const normalizedHaystack = normalizeLineEndings(haystack);

  for (const line of candidates) {
    const exactIdx = haystack.indexOf(line);
    if (exactIdx !== -1) {
      const from = Math.max(0, exactIdx - 80);
      const to = Math.min(haystack.length, exactIdx + line.length + 160);
      return haystack.slice(from, to);
    }

    const flex = findWhitespaceFlexibleMatches(haystack, line);
    if (flex.length === 1) {
      const m = flex[0]!;
      const from = Math.max(0, m.start - 80);
      const to = Math.min(haystack.length, m.end + 160);
      return haystack.slice(from, to);
    }

    // Last resort: first ~40 chars of the line as a soft probe.
    const probe = line.slice(0, Math.min(40, line.length));
    const probeIdx = normalizedHaystack.indexOf(probe);
    if (probeIdx !== -1) {
      const from = Math.max(0, probeIdx - 60);
      const to = Math.min(normalizedHaystack.length, probeIdx + 200);
      return normalizedHaystack.slice(from, to);
    }
  }

  return undefined;
}

function formatNotFoundError(content: string, oldString: string): string {
  const hint = nearestMatchHint(content, oldString);
  const base =
    'old_string not found in the target content. Re-read with get_agent / get_kb_doc and copy the exact text (whitespace-sensitive) into old_string. Include more surrounding context if needed.';
  if (!hint) return base;
  const clipped = hint.length > 400 ? `${hint.slice(0, 400)}…` : hint;
  return `${base} Nearest similar excerpt from target:\n---\n${clipped}\n---`;
}

/**
 * String replace with Cursor-like exact semantics, plus tolerant fallbacks:
 * 1. exact match (including whitespace)
 * 2. CRLF/LF-normalized exact match
 * 3. whitespace-flexible match (indent / blank-line / trailing-space drift)
 *
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

  // 1) Exact
  const exactCount = countExactOccurrences(content, oldString);
  if (exactCount === 1 || (exactCount > 1 && replaceAll)) {
    const updated = replaceAll
      ? content.split(oldString).join(newString)
      : content.replace(oldString, newString);
    return {
      ok: true,
      updated,
      occurrences: replaceAll ? exactCount : 1,
      mode: 'exact',
    };
  }
  if (exactCount > 1) {
    return {
      ok: false,
      error: `Found ${exactCount} occurrences of old_string. Provide a larger unique old_string, or set replace_all=true to change every match.`,
      occurrences: exactCount,
    };
  }

  // 2) Line-ending normalized exact (content may be CRLF while old_string is LF)
  const contentLf = normalizeLineEndings(content);
  const oldLf = normalizeLineEndings(oldString);
  const newLf = normalizeLineEndings(newString);
  if (oldLf !== oldString || contentLf !== content) {
    const lfCount = countExactOccurrences(contentLf, oldLf);
    if (lfCount === 1 || (lfCount > 1 && replaceAll)) {
      // Prefer patching the LF-normalized document so we don't reintroduce \r noise.
      const updated = replaceAll
        ? contentLf.split(oldLf).join(newLf)
        : contentLf.replace(oldLf, newLf);
      return {
        ok: true,
        updated,
        occurrences: replaceAll ? lfCount : 1,
        mode: 'line_endings',
      };
    }
    if (lfCount > 1) {
      return {
        ok: false,
        error: `Found ${lfCount} occurrences of old_string (after normalizing line endings). Provide a larger unique old_string, or set replace_all=true to change every match.`,
        occurrences: lfCount,
      };
    }
  }

  // 3) Whitespace-flexible (indent / blank lines / trailing spaces)
  const flexMatches = findWhitespaceFlexibleMatches(content, oldString);
  if (flexMatches.length === 1 || (flexMatches.length > 1 && replaceAll)) {
    const toApply = replaceAll ? flexMatches : [flexMatches[0]!];
    let updated = content;
    // Replace from the end so earlier offsets stay valid.
    for (let i = toApply.length - 1; i >= 0; i--) {
      const m = toApply[i]!;
      updated = updated.slice(0, m.start) + newString + updated.slice(m.end);
    }
    return {
      ok: true,
      updated,
      occurrences: toApply.length,
      mode: 'whitespace_flexible',
    };
  }
  if (flexMatches.length > 1) {
    return {
      ok: false,
      error: `Found ${flexMatches.length} whitespace-flexible matches for old_string. Provide a larger unique old_string, or set replace_all=true to change every match.`,
      occurrences: flexMatches.length,
    };
  }

  return {
    ok: false,
    error: formatNotFoundError(content, oldString),
    occurrences: 0,
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

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function looksLikeAgentRecord(value: Record<string, any>): boolean {
  return (
    Array.isArray(value.nodes) ||
    typeof value.ID === 'string' ||
    typeof value.id === 'string' ||
    typeof value.vg_instructions === 'string' ||
    typeof value.title === 'string'
  );
}

/**
 * GET /agents/{id} envelopes vary ({ data }, { data: { agent } }, { agent }).
 * Prefer the nested object that actually has nodes[] so updates do not PATCH
 * a skeleton graph and wipe the live prompt.
 */
export function unwrapAgentRecord(payload: unknown): Record<string, any> {
  const candidates: Record<string, any>[] = [];
  const visit = (value: unknown, depth: number) => {
    if (!isPlainObject(value) || depth > 5) return;
    candidates.push(value);
    visit(value.data, depth + 1);
    visit(value.agent, depth + 1);
    visit(value.result, depth + 1);
    visit(value.payload, depth + 1);
  };
  visit(payload, 0);

  const withNodes = candidates.find(
    (c) => Array.isArray(c.nodes) && c.nodes.length > 0
  );
  if (withNodes) return withNodes;

  const scored = candidates.find(looksLikeAgentRecord);
  if (scored) return scored;

  return unwrapRecord(payload);
}

/**
 * Surgical prompt edit. Never treat "GET returned empty instructions" as
 * permission to replace the whole prompt with new_string when old_string is set —
 * that is how patch_agent_prompt nuked live prompts.
 */
export function resolvePromptPatch(args: {
  currentText: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
  fieldLabel?: string;
}): ExactReplaceResult {
  const currentText = args.currentText ?? '';
  const oldString = args.oldString ?? '';
  const label = args.fieldLabel ?? 'prompt';

  if (!currentText.trim()) {
    if (oldString.trim()) {
      return {
        ok: false,
        error:
          `${label} came back empty from get_agent, but old_string was set. ` +
          'Refusing to write new_string as the entire prompt (that wipes the live agent). ' +
          'Re-fetch get_agent and copy the exact span, or use update_agent systemPrompt with the FULL prompt.',
        occurrences: 0,
      };
    }
    return {
      ok: true,
      updated: args.newString,
      occurrences: 1,
      mode: 'exact',
    };
  }

  if (!oldString) {
    return {
      ok: false,
      error: `${label} is not empty. Pass old_string to replace a span, or use update_agent systemPrompt for a full rewrite.`,
      occurrences: 0,
    };
  }

  return applyExactStringReplace(currentText, oldString, args.newString, args.replaceAll ?? false);
}
