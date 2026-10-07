import type { DrawingMeta } from './types'

export const DEFAULT_DRAWING_META: DrawingMeta = {
  title: 'WIRING DIAGRAM',
  drawingNumber: 'WD-001',
  revision: 'A',
  date: '2026-08-16',
  author: '',
  notes: '',
}

export function drawingFilename(meta: DrawingMeta, extension: string): string {
  const base = (meta.drawingNumber.trim() || 'wiring-diagram').replaceAll(
    /[^\w.-]+/g,
    '-',
  )
  const rev = meta.revision.trim() ? `-rev${meta.revision.trim()}` : ''
  return `${base}${rev}.${extension}`
}
