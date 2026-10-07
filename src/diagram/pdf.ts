import type { DiagramTheme } from '../types'
import type { ExportDocument } from './exportDocument'
import type { Point } from './paths'
import type { Scene } from './scene'
import { titleBlockLayout } from './titleBlock'

function hexRgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '')
  const value = raw.length === 3
    ? raw
        .split('')
        .map((c) => c + c)
        .join('')
    : raw.padEnd(6, '0').slice(0, 6)
  const n = Number.parseInt(value, 16)
  if (!Number.isFinite(n)) return [0.2, 0.2, 0.2]
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function pdfEscape(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
    .replaceAll(/[^\x20-\x7E]/g, '?')
}

function num(value: number): string {
  return value.toFixed(2)
}

export function sceneToPdf(
  scene: Scene,
  theme: DiagramTheme,
  doc?: ExportDocument,
): Uint8Array {
  const pageW = doc?.width ?? scene.width
  const pageH = doc?.height ?? scene.height
  const originX = doc?.minX ?? scene.minX
  const originY = doc?.minY ?? scene.minY
  const sx = (x: number) => x - originX
  const sy = (y: number) => pageH - (y - originY)

  const ops: string[] = []
  const stroke = (hex: string, width: number, dash?: number[]) => {
    const [r, g, b] = hexRgb(hex)
    ops.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`)
    ops.push(`${num(width)} w`)
    if (dash && dash.length) ops.push(`[${dash.join(' ')}] 0 d`)
    else ops.push('[] 0 d')
  }
  const fill = (hex: string) => {
    const [r, g, b] = hexRgb(hex)
    ops.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`)
  }
  const poly = (pts: Point[], close = false) => {
    if (!pts.length) return
    ops.push(`${num(sx(pts[0]!.x))} ${num(sy(pts[0]!.y))} m`)
    for (let i = 1; i < pts.length; i++) {
      ops.push(`${num(sx(pts[i]!.x))} ${num(sy(pts[i]!.y))} l`)
    }
    ops.push(close ? 's' : 'S')
  }
  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    mode: 'S' | 'f' | 'B',
  ) => {
    const x0 = sx(x)
    const y0 = sy(y + h)
    ops.push(`${num(x0)} ${num(y0)} ${num(w)} ${num(h)} re ${mode}`)
  }
  const circle = (cx: number, cy: number, r: number, mode: 'S' | 'B') => {
    const k = 0.5522847498 * r
    const x = sx(cx)
    const y = sy(cy)
    ops.push(`${num(x - r)} ${num(y)} m`)
    ops.push(
      `${num(x - r)} ${num(y + k)} ${num(x - k)} ${num(y + r)} ${num(x)} ${num(y + r)} c`,
    )
    ops.push(
      `${num(x + k)} ${num(y + r)} ${num(x + r)} ${num(y + k)} ${num(x + r)} ${num(y)} c`,
    )
    ops.push(
      `${num(x + r)} ${num(y - k)} ${num(x + k)} ${num(y - r)} ${num(x)} ${num(y - r)} c`,
    )
    ops.push(
      `${num(x - k)} ${num(y - r)} ${num(x - r)} ${num(y - k)} ${num(x - r)} ${num(y)} c`,
    )
    ops.push(mode === 'B' ? 'B' : 'S')
  }
  const textAt = (
    x: number,
    y: number,
    size: number,
    hex: string,
    text: string,
    align: 'left' | 'center' | 'right' = 'left',
  ) => {
    const [r, g, b] = hexRgb(hex)
    const approx = text.length * size * 0.5
    let tx = sx(x)
    if (align === 'center') tx -= approx / 2
    if (align === 'right') tx -= approx
    ops.push('BT')
    ops.push(`/F1 ${num(size)} Tf`)
    ops.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`)
    ops.push(`${num(tx)} ${num(sy(y))} Td`)
    ops.push(`(${pdfEscape(text)}) Tj`)
    ops.push('ET')
  }

  fill(theme.background)
  rect(originX, originY, pageW, pageH, 'f')

  stroke(theme.frameStroke, 1.25)
  rect(scene.frame.x, scene.frame.y, scene.frame.width, scene.frame.height, 'S')
  stroke(theme.frameStroke, 0.4)
  rect(
    scene.frame.x + 1.5,
    scene.frame.y + 1.5,
    scene.frame.width - 3,
    scene.frame.height - 3,
    'S',
  )
  const block = titleBlockLayout(scene.frame)
  fill(theme.headerFill)
  stroke(theme.frameStroke, 1)
  rect(block.x, block.y, block.width, block.height, 'B')
  stroke(theme.frameStroke, 0.75)
  rect(block.notes.x, block.notes.y, block.notes.width, block.notes.height, 'S')
  textAt(block.notes.x + 8, block.notes.y + 10, 7, theme.mutedText, block.notes.label)
  textAt(
    block.notes.x + 8,
    block.notes.y + 26,
    9,
    theme.text,
    scene.frame.notes || scene.frame.subtitle,
  )
  rect(block.title.x, block.title.y, block.title.width, block.title.height, 'S')
  textAt(block.title.x + 8, block.title.y + 10, 7, theme.mutedText, block.title.label)
  textAt(block.title.x + 8, block.title.y + 26, 13, theme.text, scene.frame.title)
  for (const field of block.fields) {
    rect(field.x, field.y, field.width, field.height, 'S')
    textAt(field.x + 6, field.y + 7, 6, theme.mutedText, field.label)
    textAt(field.x + 6, field.y + 16, 9, theme.text, field.value)
  }

  const alpha = (name: string) => ops.push(`/${name} gs`)

  alpha('GSf')
  for (const shield of scene.shields) {
    const overall = shield.kind === 'overall'
    stroke(
      overall ? theme.overallShieldStroke : theme.shieldStroke,
      overall ? 2.25 : 1.25,
      overall ? [14, 5, 3, 5] : [6, 4],
    )
    poly(shield.outline)
  }
  alpha('GSf')

  for (const wire of scene.wires) {
    if (wire.underStroke) {
      stroke(theme.connectorStroke, 4.2)
      poly(wire.points)
    }
    stroke(
      wire.error ? theme.error : wire.color,
      wire.error ? 3.1 : 2.15,
      wire.dashed ? [5, 4] : undefined,
    )
    poly(wire.points)
  }
  for (const wire of scene.wires) {
    if (wire.label) textAt(wire.labelX, wire.labelY, 9, theme.text, wire.label, 'center')
  }
  for (const bundle of scene.bundles) {
    fill(theme.labelBg)
    stroke(theme.bundleStroke, 0.75)
    rect(bundle.labelX - 64, bundle.labelY - 11, 128, 16, 'B')
    textAt(bundle.labelX, bundle.labelY + 2, 9, theme.bundleLabel, bundle.label, 'center')
  }

  for (const connector of scene.connectors) {
    fill(theme.connectorFill)
    stroke(theme.connectorStroke, 1.5)
    rect(connector.x, connector.y, connector.width, connector.height, 'B')
    fill(theme.headerFill)
    rect(connector.x, connector.y, connector.width, 42, 'B')
    textAt(
      connector.x + connector.width / 2,
      connector.y + 18,
      12,
      theme.text,
      connector.name || connector.id,
      'center',
    )
    textAt(
      connector.x + connector.width / 2,
      connector.y + 34,
      10,
      theme.mutedText,
      connector.id,
      'center',
    )
    for (const pin of connector.pins) {
      fill(pin.error ? theme.error : theme.pinFill)
      stroke(pin.error ? theme.error : theme.pinStroke, 1.35)
      circle(pin.x, pin.y, 4.5, 'B')
      textAt(pin.labelX, pin.labelY + 3, 10, pin.error ? theme.error : theme.text, pin.pin, 'center')
      if (pin.signal) {
        textAt(
          pin.signalX,
          pin.y + 3,
          9,
          theme.mutedText,
          pin.signal,
          pin.signalAnchor === 'end' ? 'right' : 'left',
        )
      }
    }
  }

  if (doc) {
    for (const table of doc.tables) {
      fill(theme.connectorFill)
      stroke(theme.frameStroke, 1)
      rect(table.x, table.y, table.width, table.height, 'B')
      fill(theme.headerFill)
      rect(table.x, table.y, table.width, 32, 'B')
      textAt(table.x + 8, table.y + 14, 10, theme.text, table.subheading)
      textAt(table.x + 8, table.y + 26, 9, theme.mutedText, table.heading)
      const y0 = table.y + 38
      const colW = (table.width - 16) / Math.max(table.columns.length, 1)
      table.columns.forEach((header, i) => {
        textAt(table.x + 8 + i * colW, y0, 8, theme.mutedText, header)
      })
      table.rows.forEach((row, index) => {
        const y = y0 + 16 * (index + 1)
        stroke(theme.headerFill, 0.6)
        poly([
          { x: table.x + 6, y: y - 11 },
          { x: table.x + table.width - 6, y: y - 11 },
        ])
        row.forEach((cell, i) => {
          textAt(table.x + 8 + i * colW, y, 8, theme.text, cell)
        })
      })
    }
  }

  const encoder = new TextEncoder()
  const enc = (text: string) => encoder.encode(text)
  const stream = encoder.encode(ops.join('\n'))
  const concat = (...parts: Uint8Array[]) => {
    const total = parts.reduce((sum, p) => sum + p.length, 0)
    const out = new Uint8Array(total)
    let at = 0
    for (const part of parts) {
      out.set(part, at)
      at += part.length
    }
    return out
  }

  // Object 5 is the content stream; objects 6-8 are transparency states used to
  // render shield/bundle bands translucently, matching the on-screen diagram.
  const objects: Uint8Array[] = [
    enc('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n'),
    enc('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n'),
    enc(
      `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageW)} ${num(pageH)}] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> /ExtGState << /GSf 6 0 R /GSb 7 0 R /GSs 8 0 R >> >> >> endobj\n`,
    ),
    enc('4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n'),
    concat(
      enc(`5 0 obj << /Length ${stream.length} >> stream\n`),
      stream,
      enc('\nendstream endobj\n'),
    ),
    enc('6 0 obj << /Type /ExtGState /ca 1 /CA 1 >> endobj\n'),
    enc('7 0 obj << /Type /ExtGState /ca 0.3 /CA 0.3 >> endobj\n'),
    enc('8 0 obj << /Type /ExtGState /ca 0.45 /CA 0.45 >> endobj\n'),
  ]
  const objectCount = objects.length
  const header = enc('%PDF-1.4\n')
  const offsets: number[] = []
  let pos = header.length
  for (const obj of objects) {
    offsets.push(pos)
    pos += obj.length
  }
  const bodyLen = pos
  const xrefStart = bodyLen
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`
  for (let i = 0; i < objectCount; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  xref += `trailer << /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  const xrefBytes = enc(xref)
  return concat(header, ...objects, xrefBytes)
}
