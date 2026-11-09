/**
 * Shared JSON string/escape scanner state for char-by-char parsing.
 *
 * One primitive for all scan sites that must know whether a char sits
 * inside a JSON string (fence-close detection, tool-call splitting, brace
 * tracking). O(1) per char, zero allocations — the trackers are fed whole
 * streams and JSON.parse-per-chunk would be O(n^2).
 */

export interface JsonScanState {
  inString: boolean;
  escaped: boolean;
}

export function newJsonScanState(): JsonScanState {
  return { inString: false, escaped: false };
}

/** Advance the state by one char. Escaped chars never toggle anything. */
export function advanceJsonScan(state: JsonScanState, char: string): void {
  if (state.escaped) {
    state.escaped = false;
  } else if (state.inString) {
    if (char === "\\") state.escaped = true;
    else if (char === '"') state.inString = false;
  } else if (char === '"') {
    state.inString = true;
  }
}
