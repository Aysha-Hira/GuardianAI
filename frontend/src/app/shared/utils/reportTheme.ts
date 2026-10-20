export const EXPORT_THEME = {
  text: 'FF1E293B',
  muted: 'FF64748B',
  accent: 'FF059669',
  headerBg: 'FF334155',
  headerText: 'FFFFFFFF',
  border: 'FFCBD5E1',
  rowAlt: 'FFF8FAFC',
  row: 'FFFFFFFF',
  clearanceBg: 'FFECFDF5',
  clearanceBorder: 'FF6EE7B7',
  clearanceText: 'FF047857',
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
