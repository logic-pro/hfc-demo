// Client-side export of a report result to CSV and XLSX (§C3).
//
// Both exports write RAW numeric values (not the human-formatted display string),
// so the numbers stay usable in a spreadsheet — XLSX additionally carries a
// per-column number format mirroring the in-app unit. Honest provenance travels
// with the data: a header note and a per-metric provenance row make clear which
// columns are measured vs. illustrative, so an exported file can't quietly launder
// a seeded placeholder into a "real" figure.

import { ReportResult, PROVENANCE_LABEL, excelNumFmt, formatValue } from './reports.models';

// exceljs is heavy (~1.5 MB). It is pulled in via dynamic import only when an XLSX
// export is actually triggered, so visiting the builder route never pays for it —
// it becomes its own lazy chunk loaded on first export.

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has committed.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** RFC-4180 quoting: wrap in quotes and double any embedded quote. */
function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(result: ReportResult): string {
  const header = result.columns.map((c) => csvCell(c.label)).join(',');
  const lines = result.rows.map((row) =>
    result.columns.map((c) => csvCell(row.cells[c.key] ?? '')).join(','),
  );
  return [header, ...lines].join('\r\n');
}

export function downloadCsv(result: ReportResult, filename = 'report.csv'): void {
  // BOM so Excel opens UTF-8 cleanly.
  const blob = new Blob(['﻿', toCsv(result)], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
}

export async function downloadXlsx(
  result: ReportResult,
  filename = 'report.xlsx',
  title = 'Report',
): Promise<void> {
  // exceljs is CommonJS; normalise the default-interop so this works under both
  // the browser bundler and a plain ESM `import()`.
  const mod = (await import('exceljs')) as unknown as { default?: typeof import('exceljs') } & typeof import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HFC Back Office · Report Builder';
  wb.created = new Date();
  const ws = wb.addWorksheet('Report', {
    views: [{ state: 'frozen', ySplit: 3 }],
  });

  const colCount = result.columns.length;
  const lastCol = String.fromCharCode(64 + Math.min(colCount, 26)); // A.. (≤9 cols here)

  // Title band.
  ws.mergeCells(`A1:${lastCol}1`);
  const titleCell = ws.getCell('A1');
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14 };

  // Provenance caption — honest by construction.
  ws.mergeCells(`A2:${lastCol}2`);
  const cap = ws.getCell('A2');
  cap.value =
    `${result.meta.dimensionLabel} · ${result.meta.periodLabel} · generated ${result.meta.generatedAt} · ` +
    `Measured: ${result.meta.measuredMetrics.length}, Reported: ${result.meta.reportedMetrics.length}, ` +
    `Illustrative: ${result.meta.illustrativeMetrics.length}`;
  cap.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };

  // Header row (row 3).
  const headerRow = ws.getRow(3);
  result.columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.provenance ? `${c.label} (${PROVENANCE_LABEL[c.provenance]})` : c.label;
    cell.font = { bold: true };
    cell.alignment = { vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFBFC5CC' } } };
  });
  headerRow.commit();

  // Data rows.
  result.rows.forEach((row) => {
    const r = ws.addRow(
      result.columns.map((c) => {
        const v = row.cells[c.key];
        return v === null || v === undefined ? '' : v;
      }),
    );
    result.columns.forEach((c, i) => {
      if (c.kind === 'metric') {
        const cell = r.getCell(i + 1);
        cell.numFmt = excelNumFmt(c.unit);
        cell.alignment = { horizontal: 'right' };
      }
    });
  });

  // Column widths: dimension wide, metrics comfortable.
  result.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.kind === 'dimension' ? 28 : 16;
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, filename);
}

/** Suggest a filesystem-safe filename stem from a report name. */
export function safeStem(name: string): string {
  const stem = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return stem || 'report';
}

// formatValue is re-exported for callers that want the display string alongside
// the raw export (kept here so the export surface is one import).
export { formatValue };
