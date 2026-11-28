// Plain-text tables and byte figures for the three scripts' output.

const MB = 1048576;

/** Bytes as megabytes with one decimal: `12.5`. Under a tenth of a megabyte it says so in KB, under a KB in B. */
export function mb(bytes) {
  if (bytes !== 0 && Math.abs(bytes) < 1024) return `${bytes} B`;
  if (bytes !== 0 && Math.abs(bytes) < MB / 10) return `${(bytes / 1024).toFixed(0)} KB`;
  return (bytes / MB).toFixed(1);
}

/** A signed change in bytes: `+12.5`, `-3.0`, `0.0`. */
export function signedMb(bytes) {
  const text = mb(bytes);
  return bytes > 0 ? `+${text}` : text;
}

/**
 * Rows as aligned text. `columns` is `[{ title, align: "left" | "right" }]`; `rows` are arrays of
 * strings. A cell longer than `width` (default 70) is cut with an ellipsis, so one long name
 * cannot push the numbers off the screen.
 */
export function renderTable(columns, rows, { width = 70 } = {}) {
  const cut = (s) => (s.length > width ? `${s.slice(0, width - 1)}…` : s);
  const cells = rows.map((row) => row.map((c) => cut(String(c))));
  const widths = columns.map((c, i) => Math.max(c.title.length, ...cells.map((r) => r[i].length)));
  const fit = (text, i) => (columns[i].align === 'right' ? text.padStart(widths[i]) : text.padEnd(widths[i]));
  const line = (row) => row.map((t, i) => fit(t, i)).join('  ').trimEnd();
  return [line(columns.map((c) => c.title)), ...cells.map(line)].join('\n');
}
