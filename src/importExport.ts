import type { Connector, ValidationError, Wire } from './types'

export const MAX_IMPORT_BYTES = 8 * 1024 * 1024
export const MAX_IMPORT_ROWS = 10_000

export const CONNECTOR_HEADERS = [
  'connector_id',
  'connector_name',
  'pin_count',
  'position_x',
  'position_y',
] as const

export const WIRE_HEADERS = [
  'wire_id',
  'from_connector',
  'from_pin',
  'to_connector',
  'to_pin',
  'wire_color',
  'gauge',
  'signal_name',
  'twist_group',
  'shield_group',
  'overall_shield',
] as const

export type SheetAoa = {
  name: string
  rows: unknown[][]
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function cell(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') {
    const record = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: string }> }
    if (typeof record.text === 'string') return record.text.trim()
    if (record.result !== undefined && record.result !== null) return cell(record.result)
    if (Array.isArray(record.richText)) {
      return record.richText.map((part) => part.text ?? '').join('').trim()
    }
  }
  return String(value).trim()
}

function optionalNumber(value: unknown): number | undefined {
  const raw = cell(value)
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

function normalizeHeader(value: unknown): string {
  return cell(value).toLowerCase().replaceAll(/\s+/g, '_')
}

function aoaToObjects(rows: unknown[][]): Record<string, unknown>[] {
  if (!rows.length) return []
  const headers = (rows[0] ?? []).map(normalizeHeader)
  return rows.slice(1).map((row) => {
    const obj: Record<string, unknown> = {}
    headers.forEach((header, i) => {
      if (header) obj[header] = row[i]
    })
    return obj
  })
}

function looksLikeConnectors(headers: string[]): boolean {
  return headers.includes('connector_id') || headers.includes('pin_count')
}

function looksLikeWires(headers: string[]): boolean {
  return (
    headers.includes('wire_id') ||
    headers.includes('from_connector') ||
    headers.includes('from_pin')
  )
}

function parseConnectors(rows: Record<string, unknown>[]): Connector[] {
  return rows
    .filter((row) => cell(row.connector_id) || cell(row.connector_name))
    .map((row) => ({
      connector_id: cell(row.connector_id),
      connector_name: cell(row.connector_name),
      pin_count: Number(row.pin_count) || 0,
      position_x: optionalNumber(row.position_x),
      position_y: optionalNumber(row.position_y),
    }))
}

function parseWires(rows: Record<string, unknown>[]): Wire[] {
  return rows
    .filter(
      (row) =>
        cell(row.wire_id) ||
        cell(row.from_connector) ||
        cell(row.to_connector),
    )
    .map((row) => ({
      wire_id: cell(row.wire_id),
      from_connector: cell(row.from_connector),
      from_pin: cell(row.from_pin),
      to_connector: cell(row.to_connector),
      to_pin: cell(row.to_pin),
      wire_color: cell(row.wire_color),
      gauge: cell(row.gauge),
      signal_name: cell(row.signal_name) || undefined,
      twist_group: cell(row.twist_group) || undefined,
      shield_group: cell(row.shield_group) || undefined,
      overall_shield: cell(row.overall_shield) || undefined,
    }))
}

export type ImportResult = {
  connectors?: Connector[]
  wires?: Wire[]
  errors: ValidationError[]
}

export function parseCsvText(text: string): unknown[][] {
  const rows: unknown[][] = []
  let row: string[] = []
  let cellValue = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cellValue += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cellValue += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ',') {
      row.push(cellValue)
      cellValue = ''
      continue
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(cellValue)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      cellValue = ''
      continue
    }
    cellValue += ch
  }
  row.push(cellValue)
  if (row.some((value) => String(value).trim())) rows.push(row)
  return rows
}

export function parseSheets(sheets: SheetAoa[]): ImportResult {
  const errors: ValidationError[] = []
  let connectors: Connector[] | undefined
  let wires: Wire[] | undefined

  const namedConnectors = sheets.find(
    (sheet) => sheet.name.toLowerCase() === 'connectors',
  )
  const namedWires = sheets.find((sheet) => sheet.name.toLowerCase() === 'wires')

  if (namedConnectors) connectors = parseConnectors(aoaToObjects(namedConnectors.rows))
  if (namedWires) wires = parseWires(aoaToObjects(namedWires.rows))

  for (const sheet of sheets) {
    const headerNames = (sheet.rows[0] ?? []).map(normalizeHeader)
    if (!connectors && looksLikeConnectors(headerNames)) {
      connectors = parseConnectors(aoaToObjects(sheet.rows))
    } else if (!wires && looksLikeWires(headerNames)) {
      wires = parseWires(aoaToObjects(sheet.rows))
    }
  }

  const connectorRows = connectors?.length ?? 0
  const wireRows = wires?.length ?? 0
  if (connectorRows + wireRows > MAX_IMPORT_ROWS) {
    errors.push({
      kind: 'import',
      message: `Import exceeds ${MAX_IMPORT_ROWS} data rows`,
    })
    return { errors }
  }

  if (!connectors && !wires) {
    errors.push({
      kind: 'import',
      message:
        'Could not find a Connectors or Wires table. Use the template headers.',
    })
  } else {
    if (!connectors) {
      errors.push({
        kind: 'import',
        message: 'No Connectors sheet/table found — wires were imported only.',
      })
    }
    if (!wires) {
      errors.push({
        kind: 'import',
        message: 'No Wires sheet/table found — connectors were imported only.',
      })
    }
  }

  return { connectors, wires, errors }
}

function mergeById<T>(
  current: T[] | undefined,
  incoming: T[] | undefined,
  id: (row: T) => string,
): T[] | undefined {
  if (!current && !incoming) return undefined
  const map = new Map<string, T>()
  let index = 0
  for (const row of [...(current ?? []), ...(incoming ?? [])]) {
    const key = id(row) || `__row_${index}`
    map.set(key, row)
    index += 1
  }
  return [...map.values()]
}

async function loadExcelJS() {
  const mod = await import('exceljs')
  return (mod.default ?? mod) as typeof import('exceljs')
}

async function sheetsFromXlsx(buffer: ArrayBuffer): Promise<SheetAoa[]> {
  const ExcelJS = await loadExcelJS()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  return workbook.worksheets.map((worksheet) => {
    const rows: unknown[][] = []
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : []
      rows.push(values)
    })
    return { name: worksheet.name, rows }
  })
}

export async function parseFiles(files: File[]): Promise<ImportResult> {
  const merged: ImportResult = { errors: [] }
  for (const file of files) {
    if (file.size > MAX_IMPORT_BYTES) {
      merged.errors.push({
        kind: 'import',
        message: `${file.name} is larger than 8 MB and was skipped`,
      })
      continue
    }
    const name = file.name.toLowerCase()
    try {
      let sheets: SheetAoa[]
      if (name.endsWith('.csv') || file.type.includes('csv')) {
        sheets = [{ name: file.name, rows: parseCsvText(await file.text()) }]
      } else {
        sheets = await sheetsFromXlsx(await file.arrayBuffer())
      }
      const parsed = parseSheets(sheets)
      merged.errors.push(...parsed.errors)
      merged.connectors = mergeById(
        merged.connectors,
        parsed.connectors,
        (row) => row.connector_id,
      )
      merged.wires = mergeById(merged.wires, parsed.wires, (row) => row.wire_id)
    } catch (error) {
      merged.errors.push({
        kind: 'import',
        message: `Could not read ${file.name}: ${error instanceof Error ? error.message : 'unknown error'}`,
      })
    }
  }
  return merged
}

function wireRows(wires: Wire[]): unknown[][] {
  return [
    [...WIRE_HEADERS],
    ...wires.map((wire) => [
      wire.wire_id,
      wire.from_connector,
      wire.from_pin,
      wire.to_connector,
      wire.to_pin,
      wire.wire_color,
      wire.gauge,
      wire.signal_name ?? '',
      wire.twist_group ?? '',
      wire.shield_group ?? '',
      wire.overall_shield ?? '',
    ]),
  ]
}

async function writeXlsx(sheets: Array<{ name: string; rows: unknown[][] }>, filename: string) {
  const ExcelJS = await loadExcelJS()
  const workbook = new ExcelJS.Workbook()
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name)
    worksheet.addRows(sheet.rows)
  }
  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  )
}

export async function downloadTemplate() {
  await writeXlsx(
    [
      {
        name: 'Connectors',
        rows: [[...CONNECTOR_HEADERS], ['J1', 'Motor Controller', 8, 420, 70]],
      },
      {
        name: 'Wires',
        rows: [
          [...WIRE_HEADERS],
          ['W1', 'J1', '1', 'J2', '1', 'red', '22 AWG', '+24V', '', ''],
        ],
      },
    ],
    'wiring-diagram-template.xlsx',
  )
}

export async function exportWireListXlsx(wires: Wire[], filename = 'wire-list.xlsx') {
  await writeXlsx([{ name: 'Wire List', rows: wireRows(wires) }], filename)
}

export function exportWireListCsv(wires: Wire[], filename = 'wire-list.csv') {
  const csv = wireRows(wires)
    .map((row) =>
      row
        .map((value) => {
          const text = String(value ?? '')
          return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
        })
        .join(','),
    )
    .join('\n')
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename)
}

export function downloadSvg(svg: string, filename = 'wiring-diagram.svg') {
  downloadBlob(
    new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
    filename,
  )
}

export function downloadPdf(bytes: Uint8Array, filename = 'wiring-diagram.pdf') {
  const copy = new Uint8Array(bytes)
  downloadBlob(new Blob([copy], { type: 'application/pdf' }), filename)
}

export function downloadDxf(dxf: string, filename = 'wiring-diagram.dxf') {
  downloadBlob(new Blob([dxf], { type: 'application/dxf;charset=utf-8' }), filename)
}

export async function downloadPng(
  svg: string,
  width: number,
  height: number,
  filename = 'wiring-diagram.png',
) {
  const source = svg.includes('xmlns=')
    ? svg
    : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Failed to rasterize SVG'))
      image.src = url
    })
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not available')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error('PNG export failed')),
        'image/png',
      )
    })
    downloadBlob(png, filename)
  } finally {
    URL.revokeObjectURL(url)
  }
}
