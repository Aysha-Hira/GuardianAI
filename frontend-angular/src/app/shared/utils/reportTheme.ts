/** Shared light palette for Excel / PDF exports (readable on white paper). */
export const EXPORT_THEME = {
  /** Primary body text — slate 800 */
  text: 'FF1E293B',
  /** Secondary labels */
  muted: 'FF64748B',
  /** Brand accent — emerald 600 (readable on white) */
  accent: 'FF059669',
  /** Table header background — slate 700 */
  headerBg: 'FF334155',
  /** Header text on dark band */
  headerText: 'FFFFFFFF',
  /** Table borders */
  border: 'FFCBD5E1',
  /** Alternating row */
  rowAlt: 'FFF8FAFC',
  /** White row */
  row: 'FFFFFFFF',
  /** Status / clearance banner */
  clearanceBg: 'FFECFDF5',
  clearanceBorder: 'FF6EE7B7',
  clearanceText: 'FF047857',
  /** Info banner (has incidents) */
  infoBg: 'FFEFF6FF',
  infoBorder: 'FF93C5FD',
  infoText: 'FF1D4ED8',
} as const

export const PDF_RGB = {
  text: [30, 41, 59] as [number, number, number],
  muted: [100, 116, 139] as [number, number, number],
  accent: [5, 150, 105] as [number, number, number],
  headerBg: [51, 65, 85] as [number, number, number],
  headerText: [255, 255, 255] as [number, number, number],
  border: [203, 213, 225] as [number, number, number],
  rowAlt: [248, 250, 252] as [number, number, number],
  row: [255, 255, 255] as [number, number, number],
  panelBg: [241, 245, 249] as [number, number, number],
  clearanceBg: [236, 253, 245] as [number, number, number],
  clearanceText: [4, 120, 87] as [number, number, number],
}

/** jsPDF-autotable styles for light professional tables. */
export const PDF_TABLE_STYLES = {
  theme: 'grid' as const,
  headStyles: {
    fillColor: PDF_RGB.headerBg,
    textColor: PDF_RGB.headerText,
    fontStyle: 'bold' as const,
    fontSize: 9,
  },
  styles: {
    fontSize: 9,
    cellPadding: 3,
    textColor: PDF_RGB.text,
    fillColor: PDF_RGB.row,
    lineColor: PDF_RGB.border,
    lineWidth: 0.1,
  },
  alternateRowStyles: {
    fillColor: PDF_RGB.rowAlt,
  },
}
