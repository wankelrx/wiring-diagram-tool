import type { Connector, DrawingMeta, Wire } from '../types'
import type { Scene } from './scene'
import { pinoutRows } from '../validation'

export type ExportTable = {
  x: number
  y: number
  width: number
  height: number
  heading: string
  subheading: string
  columns: string[]
  rows: string[][]
}

export type ExportDocument = {
  minX: number
  minY: number
  width: number
  height: number
  tables: ExportTable[]
}

function asciiCell(value: string): string {
  return value
    .replaceAll('—', '-')
    .replaceAll('–', '-')
    .replaceAll('·', '-')
    .trim()
}

function placeTables(
  tables: ExportTable[],
  startY: number,
  sceneWidth: number,
  sceneMinX: number,
  cols: number,
  gap: number,
): number {
  const tableW = Math.max(280, (sceneWidth - gap * (cols + 1)) / cols)
  const rowHeights: number[] = []
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i]!
    table.width = tableW
    table.x = sceneMinX + gap + (i % cols) * (tableW + gap)
    const band = Math.floor(i / cols)
    rowHeights[band] = Math.max(rowHeights[band] ?? 0, table.height)
  }
  for (let i = 0; i < tables.length; i++) {
    const band = Math.floor(i / cols)
    let y = startY
    for (let b = 0; b < band; b++) y += (rowHeights[b] ?? 0) + gap
    tables[i]!.y = y
  }
  return tables.reduce(
    (max, table) => Math.max(max, table.y + table.height),
    startY,
  )
}

export function layoutExportDocument(
  scene: Scene,
  connectors: Connector[],
  wires: Wire[],
  meta?: DrawingMeta,
): ExportDocument {
  const gap = 20
  const rowH = 16
  const headH = 38
  const pinoutCols = Math.min(3, Math.max(1, connectors.length))

  const pinouts: ExportTable[] = connectors.map((connector) => {
    const rows = pinoutRows(connector, wires).map((row) => [
      asciiCell(row.pin),
      asciiCell(row.signal),
      asciiCell(row.color),
      asciiCell(row.gauge),
      asciiCell(row.mates),
    ])
    return {
      x: 0,
      y: 0,
      width: 280,
      height: headH + rowH * (rows.length + 1) + 10,
      heading: asciiCell(connector.connector_name || connector.connector_id),
      subheading: `PINOUT  ${asciiCell(connector.connector_id)}`,
      columns: ['Pin', 'Signal', 'Color', 'Gauge', 'Mates'],
      rows,
    }
  })

  const pinoutsBottom = placeTables(
    pinouts,
    scene.minY + scene.height + gap,
    scene.width,
    scene.minX,
    pinoutCols,
    gap,
  )

  const wireRows = wires.map((wire) => [
    asciiCell(wire.wire_id),
    asciiCell(`${wire.from_connector}:${wire.from_pin}`),
    asciiCell(`${wire.to_connector}:${wire.to_pin}`),
    asciiCell(wire.signal_name ?? '-'),
    asciiCell(wire.wire_color),
    asciiCell(wire.gauge),
    asciiCell(wire.twist_group ?? '-'),
    asciiCell(wire.shield_group ?? '-'),
    asciiCell(wire.overall_shield ?? '-'),
  ])
  const wireList: ExportTable = {
    x: scene.minX + gap,
    y: pinoutsBottom + gap,
    width: scene.width - gap * 2,
    height: headH + rowH * (wireRows.length + 1) + 10,
    heading: asciiCell(meta?.title || scene.frame.title),
    subheading: 'WIRE LIST',
    columns: [
      'ID',
      'From',
      'To',
      'Signal',
      'Color',
      'Gauge',
      'Twist',
      'Shield',
      'Overall',
    ],
    rows: wireRows,
  }

  const bottom = wireList.y + wireList.height

  return {
    minX: scene.minX,
    minY: scene.minY,
    width: scene.width,
    height: bottom - scene.minY + gap,
    tables: [...pinouts, wireList],
  }
}
