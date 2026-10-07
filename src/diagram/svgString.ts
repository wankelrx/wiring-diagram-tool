import type { DiagramTheme } from '../types'
import type { ExportDocument, ExportTable } from './exportDocument'
import type { Scene } from './scene'
import { titleBlockLayout } from './titleBlock'

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function tableSvg(table: ExportTable, theme: DiagramTheme): string {
  const parts: string[] = []
  parts.push(
    `<rect x="${table.x}" y="${table.y}" width="${table.width}" height="${table.height}" fill="${theme.connectorFill}" stroke="${theme.frameStroke}" stroke-width="1"/>`,
  )
  parts.push(
    `<rect x="${table.x}" y="${table.y}" width="${table.width}" height="32" fill="${theme.headerFill}" stroke="${theme.frameStroke}" stroke-width="1"/>`,
  )
  parts.push(
    `<text x="${table.x + 8}" y="${table.y + 14}" font-size="10" font-weight="700" fill="${theme.text}">${esc(table.subheading)}</text>`,
  )
  parts.push(
    `<text x="${table.x + 8}" y="${table.y + 26}" font-size="9" fill="${theme.mutedText}">${esc(table.heading)}</text>`,
  )
  const y0 = table.y + 38
  const colW = (table.width - 16) / Math.max(table.columns.length, 1)
  table.columns.forEach((header, i) => {
    parts.push(
      `<text x="${table.x + 8 + i * colW}" y="${y0}" font-size="8" font-weight="700" fill="${theme.mutedText}">${esc(header)}</text>`,
    )
  })
  table.rows.forEach((row, index) => {
    const y = y0 + 16 * (index + 1)
    parts.push(
      `<line x1="${table.x + 6}" y1="${y - 11}" x2="${table.x + table.width - 6}" y2="${y - 11}" stroke="${theme.headerFill}" stroke-width="0.6"/>`,
    )
    row.forEach((cell, i) => {
      parts.push(
        `<text x="${table.x + 8 + i * colW}" y="${y}" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="${theme.text}">${esc(cell)}</text>`,
      )
    })
  })
  return parts.join('')
}

export function sceneToSvgString(
  scene: Scene,
  theme: DiagramTheme,
  doc?: ExportDocument,
): string {
  const { frame } = scene
  const block = titleBlockLayout(frame)
  const minX = doc?.minX ?? scene.minX
  const minY = doc?.minY ?? scene.minY
  const width = doc?.width ?? scene.width
  const height = doc?.height ?? scene.height
  const parts: string[] = []
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`)
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}" font-family="ui-sans-serif, system-ui, sans-serif">`,
  )
  parts.push(
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${theme.background}"/>`,
  )
  parts.push(
    `<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" fill="none" stroke="${theme.frameStroke}" stroke-width="1.25"/>`,
  )
  parts.push(
    `<rect x="${frame.x + 1.5}" y="${frame.y + 1.5}" width="${frame.width - 3}" height="${frame.height - 3}" fill="none" stroke="${theme.frameStroke}" stroke-width="0.4"/>`,
  )
  parts.push(
    `<rect x="${block.x}" y="${block.y}" width="${block.width}" height="${block.height}" fill="${theme.headerFill}" stroke="${theme.frameStroke}" stroke-width="1"/>`,
  )
  parts.push(
    `<rect x="${block.notes.x}" y="${block.notes.y}" width="${block.notes.width}" height="${block.notes.height}" fill="none" stroke="${theme.frameStroke}" stroke-width="0.75"/>`,
  )
  parts.push(
    `<text x="${block.notes.x + 8}" y="${block.notes.y + 12}" font-size="7" fill="${theme.mutedText}">${esc(block.notes.label)}</text>`,
  )
  parts.push(
    `<text x="${block.notes.x + 8}" y="${block.notes.y + 28}" font-size="9" fill="${theme.text}">${esc(frame.notes || frame.subtitle)}</text>`,
  )
  parts.push(
    `<rect x="${block.title.x}" y="${block.title.y}" width="${block.title.width}" height="${block.title.height}" fill="none" stroke="${theme.frameStroke}" stroke-width="0.75"/>`,
  )
  parts.push(
    `<text x="${block.title.x + 8}" y="${block.title.y + 12}" font-size="7" fill="${theme.mutedText}">${esc(block.title.label)}</text>`,
  )
  parts.push(
    `<text x="${block.title.x + 8}" y="${block.title.y + 28}" font-size="13" font-weight="700" fill="${theme.text}">${esc(frame.title)}</text>`,
  )
  for (const field of block.fields) {
    parts.push(
      `<rect x="${field.x}" y="${field.y}" width="${field.width}" height="${field.height}" fill="none" stroke="${theme.frameStroke}" stroke-width="0.75"/>`,
    )
    parts.push(
      `<text x="${field.x + 6}" y="${field.y + 8}" font-size="6" fill="${theme.mutedText}">${esc(field.label)}</text>`,
    )
    parts.push(
      `<text x="${field.x + 6}" y="${field.y + 18}" font-size="9" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="${theme.text}">${esc(field.value)}</text>`,
    )
  }

  for (const shield of scene.shields) {
    const overall = shield.kind === 'overall'
    parts.push(
      `<path d="${shield.outlinePath}" fill="none" stroke="${overall ? theme.overallShieldStroke : theme.shieldStroke}" stroke-width="${overall ? 2.25 : 1.25}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${overall ? '14 5 3 5' : '6 4'}"/>`,
    )
  }

  for (const wire of scene.wires) {
    if (wire.underStroke) {
      parts.push(
        `<path d="${wire.path}" fill="none" stroke="${theme.connectorStroke}" stroke-width="4.2" stroke-linecap="butt" stroke-linejoin="miter"/>`,
      )
    }
    parts.push(
      `<path d="${wire.path}" fill="none" stroke="${wire.error ? theme.error : wire.color}" stroke-width="${wire.error ? 3.1 : 2.15}" stroke-linecap="butt" stroke-linejoin="miter"${wire.dashed ? ' stroke-dasharray="5 4"' : ''}/>`,
    )
  }

  for (const wire of scene.wires) {
    if (!wire.label) continue
    parts.push(
      `<text x="${wire.labelX}" y="${wire.labelY}" text-anchor="middle" font-size="9" fill="${theme.text}" stroke="${theme.background}" stroke-width="3" paint-order="stroke">${esc(wire.label)}</text>`,
    )
  }

  for (const bundle of scene.bundles) {
    parts.push(
      `<rect x="${bundle.labelX - 64}" y="${bundle.labelY - 11}" width="128" height="16" rx="2" fill="${theme.labelBg}" stroke="${theme.bundleStroke}" stroke-width="0.75"/>`,
    )
    parts.push(
      `<text x="${bundle.labelX}" y="${bundle.labelY + 2}" text-anchor="middle" font-size="9" fill="${theme.bundleLabel}">${esc(bundle.label)}</text>`,
    )
  }

  for (const connector of scene.connectors) {
    const stroke = theme.connectorStroke
    parts.push(
      `<rect x="${connector.x}" y="${connector.y}" width="${connector.width}" height="${connector.height}" rx="2" fill="${theme.connectorFill}" stroke="${stroke}" stroke-width="1.5"/>`,
    )
    parts.push(
      `<rect x="${connector.x}" y="${connector.y}" width="${connector.width}" height="42" fill="${theme.headerFill}" stroke="${stroke}" stroke-width="1.5"/>`,
    )
    parts.push(
      `<text x="${connector.x + connector.width / 2}" y="${connector.y + 18}" text-anchor="middle" font-size="12" font-weight="600" fill="${theme.text}">${esc(connector.name || connector.id)}</text>`,
    )
    parts.push(
      `<text x="${connector.x + connector.width / 2}" y="${connector.y + 34}" text-anchor="middle" font-size="10" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="${theme.mutedText}">${esc(connector.id)}</text>`,
    )
    for (const pin of connector.pins) {
      const fill = pin.error ? theme.error : theme.pinFill
      const pinStroke = pin.error ? theme.error : theme.pinStroke
      parts.push(
        `<circle cx="${pin.x}" cy="${pin.y}" r="4.5" fill="${fill}" stroke="${pinStroke}" stroke-width="1.35"/>`,
      )
      parts.push(
        `<text x="${pin.labelX}" y="${pin.labelY + 3}" text-anchor="middle" font-size="10" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="${pin.error ? theme.error : theme.text}">${esc(pin.pin)}</text>`,
      )
      if (pin.signal) {
        parts.push(
          `<text x="${pin.signalX}" y="${pin.y + 3}" text-anchor="${pin.signalAnchor}" font-size="9" fill="${theme.mutedText}">${esc(pin.signal)}</text>`,
        )
      }
    }
  }

  if (doc) {
    for (const table of doc.tables) parts.push(tableSvg(table, theme))
  }

  parts.push('</svg>')
  return parts.join('')
}
