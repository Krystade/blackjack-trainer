import type { SpreadRow } from '../engine/game';

export function parseCvcxRamp(
  text: string,
  unitDollars?: number
): { ok: true; rows: SpreadRow[] } | { ok: false; error: string } {
  const lines = text.split('\n');
  const processedLines: Array<{ lineNum: number; tc: number; units: number }> = [];
  let lineNum = 0;
  let firstValidLineIdx = -1;

  for (const line of lines) {
    lineNum++;
    const trimmed = line.trim();

    // Skip blank lines
    if (!trimmed) {
      continue;
    }

    // Parse the line into two columns
    const columns = parseColumns(trimmed);
    if (!columns) {
      return {
        ok: false,
        error: `Line ${lineNum}: could not parse "${trimmed}"`,
      };
    }

    const [tcStr, betStr] = columns;

    // Parse TC
    const tc = parseTC(tcStr);
    if (tc === null) {
      // Failed to parse TC column. Check if this is a header on the first line.
      // A header is ONLY valid if:
      // 1. It's the first line (firstValidLineIdx === -1)
      // 2. The entire line contains no digits
      // 3. At least one column looks like a recognized header label (e.g., "TC", "Bet")
      if (
        firstValidLineIdx === -1 &&
        !hasAnyDigit(trimmed) &&
        (looksLikeHeaderLabel(tcStr) || looksLikeHeaderLabel(betStr))
      ) {
        // This is a valid header row on line 1
        firstValidLineIdx = lineNum;
        continue;
      }
      // Not a valid header; error
      return {
        ok: false,
        error: `Line ${lineNum}: could not parse "${trimmed}"`,
      };
    }

    // Mark first valid line if this is the first numeric line
    if (firstValidLineIdx === -1) {
      firstValidLineIdx = lineNum;
    }

    // Check for dollar amounts
    if (betStr.includes('$')) {
      if (!unitDollars) {
        return {
          ok: false,
          error: 'Dollar amounts found — enter your unit size first',
        };
      }

      // Parse dollar amount
      const dollarAmount = parseDollarAmount(betStr);
      if (dollarAmount === null) {
        return {
          ok: false,
          error: `Line ${lineNum}: could not parse "${trimmed}"`,
        };
      }

      const units = dollarAmount / unitDollars;
      // Check if it divides to a clean 0.5 multiple
      if (!isCleanHalfMultiple(units)) {
        return {
          ok: false,
          error: `Line ${lineNum}: bet amount $${dollarAmount} does not divide cleanly by unit $${unitDollars}`,
        };
      }

      processedLines.push({ lineNum, tc, units });
    } else {
      // Parse as plain units
      const units = parseUnitAmount(betStr);
      if (units === null) {
        return {
          ok: false,
          error: `Line ${lineNum}: could not parse "${trimmed}"`,
        };
      }

      processedLines.push({ lineNum, tc, units });
    }
  }

  // Check if we have any valid rows
  if (processedLines.length === 0) {
    return {
      ok: false,
      error: 'No rows found',
    };
  }

  // Check for duplicate minTc
  const tcMap = new Map<number, number>();
  for (const { lineNum, tc } of processedLines) {
    if (tcMap.has(tc)) {
      return {
        ok: false,
        error: `Line ${lineNum}: duplicate TC ${tc}`,
      };
    }
    tcMap.set(tc, lineNum);
  }

  // Sort by minTc and build output
  const rows: SpreadRow[] = processedLines
    .sort((a, b) => a.tc - b.tc)
    .map(({ tc, units }) => ({
      minTc: tc,
      units,
    }));

  return { ok: true, rows };
}

/**
 * Parse a line into two columns, tolerating tabs, spaces, or commas as separators.
 */
function parseColumns(line: string): [string, string] | null {
  // Try tab separator first
  if (line.includes('\t')) {
    const parts = line.split('\t').map((s) => s.trim());
    const filtered = parts.filter((s) => s.length > 0);
    if (filtered.length >= 2) {
      return [filtered[0], filtered[1]];
    }
  }

  // Try comma separator
  if (line.includes(',')) {
    const parts = line.split(',').map((s) => s.trim());
    if (parts.length >= 2) {
      return [parts[0], parts[1]];
    }
  }

  // Try space separator (runs of 2+ spaces)
  const spaceParts = line.split(/\s{2,}/).map((s) => s.trim());
  if (spaceParts.length >= 2) {
    return [spaceParts[0], spaceParts[1]];
  }

  // Try single-space separator
  const singleSpaceParts = line.split(/\s+/).filter((s) => s.length > 0);
  if (singleSpaceParts.length === 2) {
    return [singleSpaceParts[0], singleSpaceParts[1]];
  }

  // If 3 tokens and first is "TC" (case-insensitive), join first two
  if (
    singleSpaceParts.length === 3 &&
    /^tc$/i.test(singleSpaceParts[0])
  ) {
    return [singleSpaceParts[0] + ' ' + singleSpaceParts[1], singleSpaceParts[2]];
  }

  return null;
}

/**
 * Check if a string contains any decimal digits at all.
 */
function hasAnyDigit(s: string): boolean {
  return /\d/.test(s);
}

/**
 * Check if a column looks like a valid header label.
 * Valid header labels contain recognizable words (case-insensitive).
 */
function looksLikeHeaderLabel(s: string): boolean {
  const lower = s.toLowerCase().trim();
  // List of recognized header words/abbreviations
  const headerWords = [
    'tc', 'rc', 'true count', 'running count', 'count',
    'bet', 'units', 'unit', 'wager', 'amount', 'min', 'minimum', 'max', 'maximum',
    'dollar', 'dollars', 'spread', 'deviation'
  ];

  // Check if the label contains or is one of the known header words
  for (const word of headerWords) {
    if (lower === word || lower.includes(word)) {
      return true;
    }
  }
  return false;
}

/**
 * Parse a TC value, stripping decorations like "TC 2", "+3", "3+", "≤ -1", "<= -1".
 */
function parseTC(s: string): number | null {
  let normalized = s.trim();

  // Remove "TC " prefix (case-insensitive)
  normalized = normalized.replace(/^tc\s+/i, '');

  // Remove "≤" or "<=" prefix
  normalized = normalized.replace(/^≤\s*/, '').replace(/^<=\s*/, '');

  // Remove "+" prefix
  normalized = normalized.replace(/^\+/, '');

  // Remove "+" suffix
  normalized = normalized.replace(/\+$/, '');

  // Remove spaces
  normalized = normalized.trim();

  // Check that the entire normalized string is a valid integer (no trailing junk like "1x")
  if (!/^-?\d+$/.test(normalized)) {
    return null;
  }

  const num = parseInt(normalized, 10);
  return num;
}

/**
 * Parse a dollar amount string like "$40" or "40$" and return the numeric value.
 */
function parseDollarAmount(s: string): number | null {
  const normalized = s.replace(/\$/g, '').trim();
  const num = parseFloat(normalized);
  return isNaN(num) ? null : num;
}

/**
 * Parse a unit amount string (plain number).
 */
function parseUnitAmount(s: string): number | null {
  const num = parseFloat(s.trim());
  return isNaN(num) ? null : num;
}

/**
 * Check if a number is a clean multiple of 0.5 (i.e., it can be represented
 * without floating-point precision errors as a 0.5 multiple).
 */
function isCleanHalfMultiple(n: number): boolean {
  // Multiply by 2 to see if we get an integer
  const doubled = n * 2;
  // Use a small epsilon to account for floating-point errors
  return Math.abs(doubled - Math.round(doubled)) < 1e-9;
}
