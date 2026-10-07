import type { ExportDocument } from './exportDocument'
import type { Point } from './paths'
import type { Scene } from './scene'
import { titleBlockLayout } from './titleBlock'

function hexInt(hex: string): number {
  const raw = hex.replace('#', '')
  const value = raw.length === 3
    ? raw
        .split('')
        .map((c) => c + c)
        .join('')
    : raw.padEnd(6, '0').slice(0, 6)
  const n = Number.parseInt(value, 16)
  return Number.isFinite(n) ? n : 0x334155
}

function dxfText(text: string): string {
  return text.replaceAll(/[\r\n]/g, ' ').replaceAll(/[^\x20-\x7E]/g, '?')
}

function pair(code: number, value: string | number): string {
  return `${code}\n${value}\n`
}

export function sceneToDxf(scene: Scene, doc?: ExportDocument): string {
  const sx = (x: number) => x
  const sy = (y: number) => -y

  const ents: string[] = []

  function layer(name: string) {
    return pair(8, name)
  }
  function color(hex: string) {
    return pair(420, hexInt(hex))
  }
  function polyline(pts: Point[], lay: string, hex: string) {
    if (pts.length < 2) return
    let body = pair(0, 'LWPOLYLINE') + layer(lay) + color(hex) + pair(90, pts.length) + pair(70, 0)
    for (const p of pts) {
      body += pair(10, sx(p.x)) + pair(20, sy(p.y))
    }
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
        pair(40, r),
    )
  }
  function text(x: number, y: number, height: number, value: string, lay: string, hex: string) {
    ents.push(
      pair(0, 'TEXT') +
        layer(lay) +
        color(hex) +
        pair(10, sx(x)) +
        pair(20, sy(y)) +
        pair(40, height) +
        pair(1, dxfText(value)),
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
  let tables = pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, layers.length)
  for (const name of layers) {
    tables +=
      pair(0, 'LAYER') +
      pair(2, name) +
      pair(70, 0) +
      pair(62, 7) +
      pair(6, 'CONTINUOUS')
  }
  tables += pair(0, 'ENDTAB')

  return (
    pair(0, 'SECTION') +
    pair(2, 'HEADER') +
    pair(9, '$ACADVER') +
    pair(1, 'AC1014') +
    pair(9, '$INSUNITS') +
    pair(70, 4) +
    pair(0, 'ENDSEC') +
    pair(0, 'SECTION') +
    pair(2, 'TABLES') +
    tables +
    pair(0, 'ENDSEC') +
    pair(0, 'SECTION') +
    pair(2, 'ENTITIES') +
    ents.join('') +
    pair(0, 'ENDSEC') +
    pair(0, 'EOF')
  )
}
