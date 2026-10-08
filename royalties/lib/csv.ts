/**
 * A CSV reader, written out rather than pulled in.
 *
 * The files this has to read are royalty statements and publisher catalogues:
 * titles with commas in them, writer lists in quotes, the occasional embedded
 * newline, and Excel's BOM on the front. A split on commas mangles all of
 * those, and mangling a statement means inventing or losing money.
 *
 * Handles RFC 4180 plus what spreadsheets actually emit: CRLF or LF, doubled
 * quotes inside quoted fields, a UTF-8 BOM, and a missing final newline.
 */
export function parseCsv(input: string): string[][] {
  // Excel writes a BOM; left in place it becomes part of the first header.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A trailing newline shouldn't produce a final row of one empty string.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }

    if (char === '"' && field === "") {
      quoted = true;
      i++;
      continue;
    }
    if (char === ",") {
      endField();
      i++;
      continue;
    }
    if (char === "\r") {
      // CRLF or a lone CR; either ends the row.
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (char === "\n") {
      endRow();
      i++;
      continue;
    }

    field += char;
    i++;
  }

  if (field !== "" || row.length > 0) endRow();
  return rows;
}

export type Sheet = {
  headers: string[];
  rows: Array<Record<string, string>>;
};

/**
 * Parse with the first non-empty row as headers.
 *
 * Statements often carry a title block above the real header — a few lines of
 * "ASCAP", a period, a payee — so the header row is found rather than assumed
 * to be first: the first row that has at least two non-empty cells and no
 * duplicate names.
 */
export function parseSheet(input: string): Sheet {
  const rows = parseCsv(input);

  let headerIndex = rows.findIndex((row) => {
    const filled = row.filter((cell) => cell.trim() !== "");
    if (filled.length < 2) return false;
    const names = filled.map((cell) => cell.trim().toLowerCase());
    return new Set(names).size === names.length;
  });
  if (headerIndex === -1) headerIndex = 0;

  const headers = (rows[headerIndex] ?? []).map((cell) => cell.trim());

  const out: Array<Record<string, string>> = [];
  for (const row of rows.slice(headerIndex + 1)) {
    if (row.every((cell) => cell.trim() === "")) continue;
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) record[header] = (row[index] ?? "").trim();
    });
    out.push(record);
  }

  return { headers, rows: out };
}

/**
 * Find the column holding a given thing, by trying likely names.
 *
 * Every PRO and every publisher names its columns differently, and a mapping
 * that has to be configured before the first import is a mapping nobody gets
 * to. Guessing from the header text gets most files in on the first try; the
 * guess is always reported so a wrong one is visible rather than silent.
 */
export function pickColumn(
  headers: string[],
  candidates: string[],
): string | null {
  const normalized = headers.map((h) => ({
    header: h,
    key: h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
  }));

  for (const candidate of candidates) {
    const want = candidate.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const exact = normalized.find((h) => h.key === want);
    if (exact) return exact.header;
  }
  for (const candidate of candidates) {
    const want = candidate.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const partial = normalized.find(
      (h) => h.key.includes(want) && h.key !== "",
    );
    if (partial) return partial.header;
  }
  return null;
}
