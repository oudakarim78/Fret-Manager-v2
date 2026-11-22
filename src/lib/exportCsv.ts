function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const raw = String(value).replace(/\r?\n/g, ' ');
  if (/[;"\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/**
 * Generates an Excel-compatible CSV file using UTF-8 BOM and semicolon separator
 * so accented Latin and Arabic text open cleanly in Microsoft Excel.
 */
export function downloadExcelCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  const lines = [
    headers.map(escapeCsvCell).join(';'),
    ...rows.map((row) => row.map(escapeCsvCell).join(';')),
  ];
  const csvContent = `\uFEFF${lines.join('\r\n')}`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
