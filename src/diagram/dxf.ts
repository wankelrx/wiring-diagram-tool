import type { ExportDocument } from './exportDocument'
import type { Point } from './paths'
import type { Scene } from './scene'
import { titleBlockLayout } from './titleBlock'

/** AutoCAD Color Index 1-248 (index 0 is the position in this list + 1). */
const ACI_PALETTE = [
  'ff0000 ffff00 00ff00 00ffff 0000ff ff00ff ffffff 808080 c0c0c0 ff0000 ff7f7f a50000',
  'a55252 7f0000 7f3f3f 4c0000 4c2626 260000 261313 ff3f00 ff9f7f a52900 a56752 7f1f00',
  '7f4f3f 4c1300 4c2f26 260900 261713 ff7f00 ffbf7f a55200 a57c52 7f3f00 7f5f3f 4c2600',
  '4c3926 261300 261c13 ffbf00 ffdf7f a57c00 a59152 7f5f00 7f6f3f 4c3900 4c4226 261c00',
  '262113 ffff00 ffff7f a5a500 a5a552 7f7f00 7f7f3f 4c4c00 4c4c26 262600 262613 bfff00',
  'dfff7f 7ca500 91a552 5f7f00 6f7f3f 394c00 424c26 1c2600 212613 7fff00 bfff7f 52a500',
  '7ca552 3f7f00 5f7f3f 264c00 394c26 132600 1c2613 3fff00 9fff7f 29a500 67a552 1f7f00',
  '4f7f3f 134c00 2f4c26 092600 172613 00ff00 7fff7f 00a500 52a552 007f00 3f7f3f 004c00',
  '264c26 002600 132613 00ff3f 7fff9f 00a529 52a567 007f1f 3f7f4f 004c13 264c2f 002609',
  '135817 00ff7f 7fffbf 00a552 52a57c 007f3f 3f7f5f 004c26 264c39 002613 13581c 00ffbf',
  '7fffdf 00a57c 52a591 007f5f 3f7f6f 004c39 264c42 00261c 135858 00ffff 7fffff 00a5a5',
  '52a5a5 007f7f 3f7f7f 004c4c 264c4c 002626 135858 00bfff 7fdfff 007ca5 5291a5 005f7f',
  '3f6f7f 00394c 26427e 001c26 135858 007fff 7fbfff 0052a5 527ca5 003f7f 3f5f7f 00264c',
  '26397e 001326 131c58 003fff 7f9fff 0029a5 5267a5 001f7f 3f4f7f 00134c 262f7e 000926',
  '131758 0000ff 7f7fff 0000a5 5252a5 00007f 3f3f7f 00004c 26267e 000026 131358 3f00ff',
  '9f7fff 2900a5 6752a5 1f007f 4f3f7f 13004c 2f267e 090026 171358 7f00ff bf7fff 5200a5',
  '7c52a5 3f007f 5f3f7f 26004c 39267e 130026 1c1358 bf00ff df7fff 7c00a5 9152a5 5f007f',
  '6f3f7f 39004c 42264c 1c0026 581358 ff00ff ff7fff a500a5 a552a5 7f007f 7f3f7f 4c004c',
  '4c264c 260026 581358 ff00bf ff7fdf a5007c a55291 7f005f 7f3f6f 4c0039 4c2642 26001c',
  '581358 ff007f ff7fbf a50052 a5527c 7f003f 7f3f5f 4c0026 4c2639 260013 58131c ff003f',
  'ff7f9f a50029 a55267 7f001f 7f3f4f 4c0013 4c262f 260009',
]
  .join(' ')
  .split(' ')
  .map((hex) => Number.parseInt(hex, 16))

function hexRgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '')
  const value =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw.padEnd(6, '0').slice(0, 6)
  const n = Number.parseInt(value, 16)
  const safe = Number.isFinite(n) ? n : 0x334155
  return [(safe >> 16) & 255, (safe >> 8) & 255, safe & 255]
}

const aciCache = new Map<string, number>()

/** Nearest AutoCAD color index; dark colors map to 7 (black on white paper). */
function aciIndex(hex: string): number {
  const cached = aciCache.get(hex)
  if (cached !== undefined) return cached
  const [r, g, b] = hexRgb(hex)
  let best = 7
  if (r * 0.299 + g * 0.587 + b * 0.114 >= 48) {
    let bestDist = Infinity
    ACI_PALETTE.forEach((value, i) => {
      const index = i + 1
      if (index === 7) return
      const dr = ((value >> 16) & 255) - r
      const dg = ((value >> 8) & 255) - g
      const db = (value & 255) - b
      const dist = dr * dr + dg * dg + db * db
      if (dist < bestDist) {
        bestDist = dist
        best = index
      }
    })
  }
  aciCache.set(hex, best)
  return best
}

function dxfText(text: string): string {
  return text
    .replaceAll(/[\r\n]/g, ' ')
    .replaceAll(/[\u00b7\u2022]/g, '-')
    .replaceAll(/[\u2010-\u2015\u2212]/g, '-')
    .replaceAll(/[^\x20-\x7E]/g, '?')
}

function num(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : '0'
}

function pair(code: number, value: string | number): string {
  return `${code}\n${typeof value === 'number' ? num(value) : value}\n`
}

/**
 * Plain AutoCAD R12 (AC1009) ASCII DXF: POLYLINE/VERTEX, CIRCLE and TEXT only,
 * indexed colors. R12 needs no handles or subclass markers, so it opens in
 * AutoCAD, LibreCAD, QCAD, Inkscape and other CAD tools alike.
 */
export function sceneToDxf(scene: Scene, doc?: ExportDocument): string {
  const sx = (x: number) => x
  const sy = (y: number) => -y

  const ents: string[] = []

  function layer(name: string) {
    return pair(8, name)
  }
  function color(hex: string) {
    return pair(62, aciIndex(hex))
  }
  function polyline(pts: Point[], lay: string, hex: string) {
    if (pts.length < 2) return
    let body =
      pair(0, 'POLYLINE') +
      layer(lay) +
      color(hex) +
      pair(66, 1) +
      pair(10, 0) +
      pair(20, 0) +
      pair(30, 0) +
      pair(70, 0)
    for (const p of pts) {
      body +=
        pair(0, 'VERTEX') + layer(lay) + pair(10, sx(p.x)) + pair(20, sy(p.y)) + pair(30, 0)
    }
    body += pair(0, 'SEQEND') + layer(lay)
    ents.push(body)
  }
  function rect(x: number, y: number, w: number, h: number, lay: string, hex: string) {
    polyline(
      [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
        { x, y },
      ],
      lay,
      hex,
    )
  }
  function circle(cx: number, cy: number, r: number, lay: string, hex: string) {
    ents.push(
      pair(0, 'CIRCLE') +
        layer(lay) +
        color(hex) +
        pair(10, sx(cx)) +
        pair(20, sy(cy)) +
        pair(30, 0) +
        pair(40, r),
    )
  }
  function text(x: number, y: number, height: number, value: string, lay: string, hex: string) {
    const clean = dxfText(value)
    if (!clean.trim()) return
    ents.push(
      pair(0, 'TEXT') +
        layer(lay) +
        color(hex) +
        pair(10, sx(x)) +
        pair(20, sy(y)) +
        pair(30, 0) +
        pair(40, height) +
        pair(1, clean) +
        pair(7, 'STANDARD'),
    )
  }

  rect(scene.frame.x, scene.frame.y, scene.frame.width, scene.frame.height, 'FRAME', '#0f172a')
  const block = titleBlockLayout(scene.frame)
  rect(block.x, block.y, block.width, block.height, 'FRAME', '#0f172a')
  text(block.notes.x + 8, block.notes.y + 10, 6, block.notes.label, 'TEXT', '#475569')
  text(
    block.notes.x + 8,
    block.notes.y + 24,
    8,
    scene.frame.notes || scene.frame.subtitle,
    'TEXT',
    '#0f172a',
  )
  text(block.title.x + 8, block.title.y + 10, 6, 'TITLE', 'TEXT', '#475569')
  text(block.title.x + 8, block.title.y + 24, 12, scene.frame.title, 'TEXT', '#0f172a')
  for (const field of block.fields) {
    rect(field.x, field.y, field.width, field.height, 'FRAME', '#0f172a')
    text(field.x + 6, field.y + 6, 5, field.label, 'TEXT', '#475569')
    text(field.x + 6, field.y + 14, 8, field.value, 'TEXT', '#0f172a')
  }

  for (const bundle of scene.bundles) {
    text(bundle.labelX, bundle.labelY, 8, bundle.label, 'TEXT', '#0f172a')
  }
  for (const shield of scene.shields) {
    polyline(
      shield.outline,
      shield.kind === 'overall' ? 'OVERALL_SHIELD' : 'SHIELDS',
      shield.kind === 'overall' ? '#0f766e' : '#64748b',
    )
  }
  for (const link of scene.shieldLinks) {
    const overall = link.kind === 'overall'
    polyline(
      link.points,
      overall ? 'OVERALL_SHIELD' : 'SHIELDS',
      overall ? '#0f766e' : '#64748b',
    )
    circle(link.anchor.x, link.anchor.y, 2.6, 'PINS', overall ? '#0f766e' : '#64748b')
  }
  for (const wire of scene.wires) {
    polyline(wire.points, 'WIRES', wire.error ? '#dc2626' : wire.color)
    if (wire.label) text(wire.labelX, wire.labelY, 8, wire.label, 'TEXT', '#0f172a')
  }
  for (const connector of scene.connectors) {
    rect(connector.x, connector.y, connector.width, connector.height, 'CONNECTORS', '#334155')
    rect(connector.x, connector.y, connector.width, 42, 'CONNECTORS', '#334155')
    text(
      connector.x + 12,
      connector.y + 18,
      10,
      connector.name || connector.id,
      'TEXT',
      '#0f172a',
    )
    text(connector.x + 12, connector.y + 32, 8, connector.id, 'TEXT', '#475569')
    for (const pin of connector.pins) {
      circle(pin.x, pin.y, 4.5, 'PINS', pin.error ? '#dc2626' : '#334155')
      text(pin.labelX - 4, pin.labelY + 2, 8, pin.pin, 'TEXT', pin.error ? '#dc2626' : '#0f172a')
      if (pin.signal) {
        const width = pin.signal.length * 8 * 0.6
        const sx0 = pin.signalAnchor === 'end' ? pin.signalX - width : pin.signalX
        text(sx0, pin.y + 2, 8, pin.signal, 'TEXT', '#475569')
      }
    }
  }

  if (doc) {
    for (const table of doc.tables) {
      rect(table.x, table.y, table.width, table.height, 'PINOUT', '#334155')
      rect(table.x, table.y, table.width, 32, 'PINOUT', '#334155')
      text(table.x + 8, table.y + 12, 10, table.subheading, 'TEXT', '#0f172a')
      text(table.x + 8, table.y + 24, 8, table.heading, 'TEXT', '#475569')
      const y0 = table.y + 38
      const colW = (table.width - 16) / Math.max(table.columns.length, 1)
      table.columns.forEach((header, i) => {
        text(table.x + 8 + i * colW, y0, 8, header, 'TEXT', '#475569')
      })
      table.rows.forEach((row, index) => {
        const y = y0 + 16 * (index + 1)
        row.forEach((cell, i) => {
          text(table.x + 8 + i * colW, y, 8, cell, 'TEXT', '#0f172a')
        })
      })
    }
  }

  const layers = ['FRAME', 'CONNECTORS', 'WIRES', 'CABLES', 'SHIELDS', 'OVERALL_SHIELD', 'PINS', 'PINOUT', 'TEXT']
  const linetypes =
    pair(0, 'TABLE') +
    pair(2, 'LTYPE') +
    pair(70, 1) +
    pair(0, 'LTYPE') +
    pair(2, 'CONTINUOUS') +
    pair(70, 0) +
    pair(3, 'Solid line') +
    pair(72, 65) +
    pair(73, 0) +
    pair(40, 0) +
    pair(0, 'ENDTAB')
  let layerTable = pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, layers.length)
  for (const name of layers) {
    layerTable +=
      pair(0, 'LAYER') + pair(2, name) + pair(70, 0) + pair(62, 7) + pair(6, 'CONTINUOUS')
  }
  layerTable += pair(0, 'ENDTAB')
  const styles =
    pair(0, 'TABLE') +
    pair(2, 'STYLE') +
    pair(70, 1) +
    pair(0, 'STYLE') +
    pair(2, 'STANDARD') +
    pair(70, 0) +
    pair(40, 0) +
    pair(41, 1) +
    pair(50, 0) +
    pair(71, 0) +
    pair(42, 2.5) +
    pair(3, 'txt') +
    pair(4, '') +
    pair(0, 'ENDTAB')

  return (
    pair(0, 'SECTION') +
    pair(2, 'HEADER') +
    pair(9, '$ACADVER') +
    pair(1, 'AC1009') +
    pair(0, 'ENDSEC') +
    pair(0, 'SECTION') +
    pair(2, 'TABLES') +
    linetypes +
    layerTable +
    styles +
    pair(0, 'ENDSEC') +
    pair(0, 'SECTION') +
    pair(2, 'ENTITIES') +
    ents.join('') +
    pair(0, 'ENDSEC') +
    pair(0, 'EOF')
  )
}
