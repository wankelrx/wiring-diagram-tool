import type { Connector, Wire } from '../types'
import { pinLabelsFor, pinSignalMap } from '../validation'

export const BOX_WIDTH = 176
export const BOX_MAX_WIDTH = 460
export const HEADER_H = 42
export const PIN_H = 20
export const PIN_PAD = 8
const NUM_INSET = 16
const SIG_INSET = 30
const EDGE_PAD = 14

export type PinSide = 'left' | 'right'
export type SignalAnchor = 'start' | 'end'

export type PinLayout = {
  pin: string
  signal: string
  x: number
  y: number
  labelX: number
  labelY: number
  signalX: number
  signalAnchor: SignalAnchor
  side: PinSide
  dir: number
}

/** Rough on-screen text width used to size boxes so labels never overlap. */
function approxTextWidth(text: string, size: number): number {
  return text.length * size * 0.62
}

function connectorWidth(
  connector: Connector,
  labels: string[],
  signals: Map<string, string>,
): number {
  let rowNeed = 0
  for (const pin of labels) {
    const signal = signals.get(pin) ?? ''
    const need =
      SIG_INSET + approxTextWidth(signal, 10) + EDGE_PAD
    rowNeed = Math.max(rowNeed, need)
  }
  const headerNeed =
    Math.max(
      approxTextWidth(connector.connector_name || connector.connector_id, 12),
      approxTextWidth(connector.connector_id, 10),
    ) + 24
  return Math.min(
    BOX_MAX_WIDTH,
    Math.max(BOX_WIDTH, Math.ceil(rowNeed), Math.ceil(headerNeed)),
  )
}

export type ConnectorLayout = {
  connector: Connector
  x: number
  y: number
  width: number
  height: number
  pinSide: PinSide
  pins: PinLayout[]
}

export type LayoutResult = {
  connectors: ConnectorLayout[]
  byId: Map<string, ConnectorLayout>
  minX: number
  minY: number
  width: number
  height: number
}

export function connectorHeight(pinCount: number): number {
  const count = Math.max(1, Math.floor(pinCount) || 0)
  return HEADER_H + PIN_PAD + count * PIN_H + PIN_PAD
}

function connectionOrder(connectors: Connector[], wires: Wire[]): Connector[] {
  const ids = connectors.map((c) => c.connector_id)
  const adj = new Map<string, string[]>()
  for (const id of ids) adj.set(id, [])
  for (const w of wires) {
    if (!adj.has(w.from_connector) || !adj.has(w.to_connector)) continue
    adj.get(w.from_connector)!.push(w.to_connector)
    adj.get(w.to_connector)!.push(w.from_connector)
  }
  const seen = new Set<string>()
  const order: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    const queue = [id]
    seen.add(id)
    while (queue.length) {
      const cur = queue.shift()!
      order.push(cur)
      for (const next of adj.get(cur) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
  }
  const byId = new Map(connectors.map((c) => [c.connector_id, c]))
  return order.map((id) => byId.get(id)!).filter(Boolean)
}

export const CONNECTOR_GAP = 90
export const CONNECTOR_MARGIN = 32

export function computeLayout(
  connectors: Connector[],
  wires: Wire[],
): LayoutResult {
  const ordered = connectionOrder(connectors, wires)
  const cols = Math.max(1, Math.min(ordered.length, 3))
  const colW = 480
  const startX = 64
  const startY = 80

  // Per-column cursors so auto-placed boxes of varying height never overlap.
  const colBottoms = new Array<number>(cols).fill(startY)

  const placed: ConnectorLayout[] = ordered.map((connector, index) => {
    const hasX = connector.position_x !== undefined && connector.position_x !== null
    const hasY = connector.position_y !== undefined && connector.position_y !== null
    const col = index % cols
    const labels = pinLabelsFor(connector, wires)
    const signals = pinSignalMap(connector, wires)
    const height = connectorHeight(labels.length)
    const width = connectorWidth(connector, labels, signals)
    const x = hasX ? Number(connector.position_x) : startX + col * colW
    let y: number
    if (hasY) {
      y = Number(connector.position_y)
    } else {
      y = colBottoms[col]!
      colBottoms[col] = y + height + CONNECTOR_GAP
    }
    return {
      connector,
      x,
      y,
      width,
      height,
      pinSide: 'right',
      pins: [],
    }
  })

  for (let pass = 0; pass < 3; pass++) {
    resolveConnectorCollisions(placed, CONNECTOR_MARGIN)
    if (!enforceWiredGaps(placed, wires)) break
  }

  const byId = new Map(placed.map((c) => [c.connector.connector_id, c]))
  const avgX =
    placed.reduce((sum, c) => sum + c.x + c.width / 2, 0) /
    Math.max(placed.length, 1)

  // Default face: toward the diagram center / neighbor cluster.
  for (const layout of placed) {
    const centerX = layout.x + layout.width / 2
    layout.pinSide = centerX <= avgX ? 'right' : 'left'
  }
  // Two-connector drawings always face each other.
  if (placed.length === 2) {
    const [a, b] = [...placed].sort((l, r) => l.x - r.x)
    if (a && b) {
      a.pinSide = 'right'
      b.pinSide = 'left'
    }
  }

  for (const layout of placed) {
    const labels = pinLabelsFor(layout.connector, wires)
    const signals = pinSignalMap(layout.connector, wires)
    layout.height = connectorHeight(labels.length)
    const selfCenter = layout.x + layout.width / 2

    layout.pins = labels.map((pin, index) => {
      const y = layout.y + HEADER_H + PIN_PAD + (index + 0.5) * PIN_H
      // Exit toward the mate connector so multi-face parts (e.g. J1↔J2 and
      // J1↔J3) don't all leave from the same side and sweep across the sheet.
      let pinSide = layout.pinSide
      const mates: number[] = []
      let sharedSide: 'left' | 'right' | null = null
      for (const wire of wires) {
        const fromHere =
          wire.from_connector === layout.connector.connector_id &&
          String(wire.from_pin) === pin
        const toHere =
          wire.to_connector === layout.connector.connector_id &&
          String(wire.to_pin) === pin
        if (!fromHere && !toHere) continue
        const mateId = fromHere ? wire.to_connector : wire.from_connector
        const mate = byId.get(mateId)
        if (!mate) continue
        const mateCenter = mate.x + mate.width / 2
        const overlapsInX =
          Math.min(layout.x + layout.width, mate.x + mate.width) >
          Math.max(layout.x, mate.x)
        if (overlapsInX && mate !== layout) {
          // Boxes stacked in the same columns have no gap between them to route
          // through, so both exit on the same side (symmetric for the pair).
          sharedSide = pickSharedSide(layout, mate, placed, avgX)
        } else {
          mates.push(mateCenter)
        }
      }
      if (sharedSide) {
        pinSide = sharedSide
      } else if (mates.length) {
        const mateAvg = mates.reduce((sum, x) => sum + x, 0) / mates.length
        pinSide = mateAvg < selfCenter ? 'left' : 'right'
      }
      const dir = pinSide === 'right' ? 1 : -1
      const pinX = pinSide === 'right' ? layout.x + layout.width : layout.x
      return {
        pin,
        signal: signals.get(pin) ?? '',
        x: pinX,
        y,
        labelX: pinX - dir * NUM_INSET,
        labelY: y,
        signalX: pinX - dir * SIG_INSET,
        signalAnchor: (pinSide === 'right' ? 'end' : 'start') as SignalAnchor,
        side: pinSide,
        dir,
      }
    })
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of placed) {
    minX = Math.min(minX, c.x)
    minY = Math.min(minY, c.y)
    maxX = Math.max(maxX, c.x + c.width)
    maxY = Math.max(maxY, c.y + c.height)
  }
  if (!placed.length) {
    minX = 0
    minY = 0
    maxX = 800
    maxY = 600
  }
  const pad = 80

  return {
    connectors: placed,
    byId,
    minX: minX - pad,
    minY: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  }
}

/**
 * Side for two X-overlapping, wired connectors to both exit on. Prefers the
 * side with more free space beside the pair (so nested loops never land on a
 * third connector); the diagram-center rule only breaks ties. Symmetric in
 * (a, b), so both ends agree.
 */
function pickSharedSide(
  a: ConnectorLayout,
  b: ConnectorLayout,
  all: ConnectorLayout[],
  avgX: number,
): 'left' | 'right' {
  const minX = Math.min(a.x, b.x)
  const maxX = Math.max(a.x + a.width, b.x + b.width)
  const yTop = Math.min(a.y, b.y)
  const yBottom = Math.max(a.y + a.height, b.y + b.height)
  let rightRoom = Infinity
  let leftRoom = Infinity
  for (const o of all) {
    if (o === a || o === b) continue
    if (o.y + o.height <= yTop || o.y >= yBottom) continue
    if (o.x >= maxX) rightRoom = Math.min(rightRoom, o.x - maxX)
    else if (o.x + o.width <= minX) leftRoom = Math.min(leftRoom, minX - (o.x + o.width))
  }
  if (rightRoom !== leftRoom) return rightRoom > leftRoom ? 'right' : 'left'
  return (a.x + a.width / 2 + b.x + b.width / 2) / 2 <= avgX ? 'right' : 'left'
}

/** Room for two pin stubs plus the first routing lane between wired boxes. */
const WIRED_GAP_BASE = 72
/** Extra channel width per additional conductor so lanes never stack. */
const WIRED_GAP_PER_WIRE = 10

/**
 * Keep side-by-side connectors that share wires far enough apart for the
 * routing channel between them to hold every lane — including diagonal
 * neighbours, whose wires still run vertically inside that channel. Pairs that
 * are already far enough apart (or overlap in X, so they route outward) are left
 * exactly where they are. Returns true when any box moved.
 */
function enforceWiredGaps(boxes: ConnectorLayout[], wires: Wire[]): boolean {
  const pairs = new Map<string, { a: string; b: string; count: number }>()
  for (const wire of wires) {
    const a = wire.from_connector
    const b = wire.to_connector
    if (a === b) continue
    const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
    const entry = pairs.get(key)
    if (entry) entry.count += 1
    else pairs.set(key, { a, b, count: 1 })
  }
  const byId = new Map(boxes.map((box) => [box.connector.connector_id, box]))
  let movedAny = false
  for (let iter = 0; iter < 20; iter++) {
    let moved = false
    for (const pair of pairs.values()) {
      const boxA = byId.get(pair.a)
      const boxB = byId.get(pair.b)
      if (!boxA || !boxB) continue
      const [left, right] = boxA.x <= boxB.x ? [boxA, boxB] : [boxB, boxA]
      const gap = right.x - (left.x + left.width)
      if (gap < 0) continue
      const need = WIRED_GAP_BASE + WIRED_GAP_PER_WIRE * (pair.count - 1)
      if (gap >= need) continue
      const push = (need - gap) / 2
      left.x -= push
      right.x += push
      moved = true
    }
    if (!moved) break
    movedAny = true
  }
  return movedAny
}

/**
 * Nudge overlapping connector boxes apart. Boxes that do not overlap are left
 * exactly where they were, so manual layouts stay stable; only true collisions
 * are separated along their axis of least penetration.
 */
function resolveConnectorCollisions(
  boxes: ConnectorLayout[],
  margin: number,
): void {
  if (boxes.length < 2) return
  const maxIterations = 60
  for (let iter = 0; iter < maxIterations; iter++) {
    let moved = false
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!
        const b = boxes[j]!
        const overlapX =
          Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) + margin
        const overlapY =
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) + margin
        if (overlapX <= 0 || overlapY <= 0) continue

        const aCenterX = a.x + a.width / 2
        const bCenterX = b.x + b.width / 2
        const aCenterY = a.y + a.height / 2
        const bCenterY = b.y + b.height / 2

        if (overlapX < overlapY) {
          const push = overlapX / 2
          if (aCenterX <= bCenterX) {
            a.x -= push
            b.x += push
          } else {
            a.x += push
            b.x -= push
          }
        } else {
          const push = overlapY / 2
          if (aCenterY <= bCenterY) {
            a.y -= push
            b.y += push
          } else {
            a.y += push
            b.y -= push
          }
        }
        moved = true
      }
    }
    if (!moved) break
  }
}

export function findPin(
  layout: ConnectorLayout | undefined,
  pin: string,
): PinLayout | undefined {
  return layout?.pins.find((p) => p.pin === String(pin))
}
