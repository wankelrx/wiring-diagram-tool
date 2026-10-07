import type { Connector, Wire } from './types'
import { connectorHeight, HEADER_H, PIN_H, PIN_PAD } from './diagram/layout'
import { pinLabelsFor } from './validation'

const LAYER_GAP_X = 420
const START_X = 64
const START_Y = 72
const STACK_GAP_Y = 48

/**
 * Place connectors to keep wire runs short and parallel.
 * Highest-degree connector is the hub. Direct neighbors fan to opposite
 * sides (heaviest first) at mate-aligned Y so trunks do not stack behind
 * each other. Remaining nodes use BFS layers with collision column bumps.
 */
export function autoArrangeConnectors(
  connectors: Connector[],
  wires: Wire[],
): Connector[] {
  if (connectors.length === 0) return connectors
  const ids = connectors.map((c) => c.connector_id)
  const byId = new Map(connectors.map((c) => [c.connector_id, c]))

  const adj = new Map<string, Set<string>>()
  for (const id of ids) adj.set(id, new Set())
  for (const wire of wires) {
    if (!adj.has(wire.from_connector) || !adj.has(wire.to_connector)) continue
    if (wire.from_connector === wire.to_connector) continue
    adj.get(wire.from_connector)!.add(wire.to_connector)
    adj.get(wire.to_connector)!.add(wire.from_connector)
  }

  // Prefer the highest-degree connector as the layout hub.
  let seed = ids[0]!
  let bestDegree = -1
  for (const id of ids) {
    const degree = adj.get(id)?.size ?? 0
    if (degree > bestDegree) {
      bestDegree = degree
      seed = id
    }
  }

  // Connected components; layout each independently.
  const seen = new Set<string>()
  const components: string[][] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    const queue = [id]
    seen.add(id)
    const component: string[] = []
    while (queue.length) {
      const cur = queue.shift()!
      component.push(cur)
      for (const next of adj.get(cur) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    components.push(component)
  }
  components.sort((a, b) => {
    const aSeed = a.includes(seed) ? 0 : 1
    const bSeed = b.includes(seed) ? 0 : 1
    return aSeed - bSeed
  })

  const positions = new Map<string, { x: number; y: number }>()
  let componentOffsetY = START_Y

  for (const component of components) {
    const hub = component.includes(seed) ? seed : component[0]!
    const neighbors = [...(adj.get(hub) ?? [])].filter((id) =>
      component.includes(id),
    )
    neighbors.sort(
      (a, b) =>
        wireCountBetween(b, hub, wires) - wireCountBetween(a, hub, wires) ||
        matePinBias(a, wires) - matePinBias(b, wires) ||
        a.localeCompare(b),
    )

    const hubX =
      neighbors.length >= 2 ? START_X + LAYER_GAP_X : START_X
    positions.set(hub, { x: hubX, y: componentOffsetY })

    // Fan direct neighbors to opposite sides so trunks do not block each other.
    neighbors.forEach((id, index) => {
      const connector = byId.get(id)!
      const height = connectorHeight(
        pinLabelsFor(connector, wires).length || connector.pin_count || 1,
      )
      const alignedY = alignedYFor(id, positions, wires) ?? componentOffsetY
      const side = index % 2 === 0 ? 1 : -1
      const depth = Math.floor(index / 2) + 1
      const preferredX = hubX + side * depth * LAYER_GAP_X
      const x = freeColumnX(
        preferredX,
        alignedY,
        height,
        positions,
        byId,
        wires,
        side,
      )
      positions.set(id, { x, y: alignedY })
    })

    // Place any deeper nodes relative to already-placed parents.
    const remaining = component.filter((id) => !positions.has(id))
    if (remaining.length) {
      const layers = assignLayers(component, adj, hub)
      for (let layerIndex = 1; layerIndex < layers.length; layerIndex++) {
        for (const id of layers[layerIndex]!) {
          if (positions.has(id)) continue
          const connector = byId.get(id)!
          const height = connectorHeight(
            pinLabelsFor(connector, wires).length || connector.pin_count || 1,
          )
          const alignedY = alignedYFor(id, positions, wires) ?? componentOffsetY
          const parent = [...(adj.get(id) ?? [])].find((n) => positions.has(n))
          const parentX = parent ? positions.get(parent)!.x : hubX
          const preferredX = parentX + LAYER_GAP_X
          const x = freeColumnX(
            preferredX,
            alignedY,
            height,
            positions,
            byId,
            wires,
          )
          positions.set(id, { x, y: alignedY })
        }
      }
    }

    // Keep the diagram origin near START_X / componentOffsetY.
    let minX = Infinity
    let minY = Infinity
    let maxBottom = componentOffsetY
    for (const id of component) {
      const pos = positions.get(id)
      if (!pos) continue
      minX = Math.min(minX, pos.x)
      minY = Math.min(minY, pos.y)
    }
    const shiftX = Number.isFinite(minX) ? START_X - minX : 0
    const shiftY = Number.isFinite(minY) ? componentOffsetY - minY : 0
    for (const id of component) {
      const pos = positions.get(id)
      const connector = byId.get(id)!
      if (!pos) continue
      pos.x += shiftX
      pos.y += shiftY
      const height = connectorHeight(
        pinLabelsFor(connector, wires).length || connector.pin_count || 1,
      )
      maxBottom = Math.max(maxBottom, pos.y + height + STACK_GAP_Y)
    }
    componentOffsetY = maxBottom + STACK_GAP_Y
  }

  // Isolated connectors (no wires) — place in a trailing column.
  let orphanY = componentOffsetY
  const maxLayer =
    positions.size === 0
      ? 0
      : Math.max(...[...positions.values()].map((p) => Math.round(p.x / LAYER_GAP_X)))
  const orphanX = START_X + (maxLayer + 1) * LAYER_GAP_X
  for (const id of ids) {
    if (positions.has(id)) continue
    const connector = byId.get(id)!
    const height = connectorHeight(
      pinLabelsFor(connector, wires).length || connector.pin_count || 1,
    )
    positions.set(id, { x: orphanX, y: orphanY })
    orphanY += height + STACK_GAP_Y
  }

  return connectors.map((connector) => {
    const pos = positions.get(connector.connector_id)
    if (!pos) return connector
    return {
      ...connector,
      position_x: Math.round(pos.x),
      position_y: Math.round(pos.y),
    }
  })
}

function wireCountBetween(a: string, b: string, wires: Wire[]): number {
  let n = 0
  for (const wire of wires) {
    if (
      (wire.from_connector === a && wire.to_connector === b) ||
      (wire.from_connector === b && wire.to_connector === a)
    ) {
      n += 1
    }
  }
  return n
}

function pinCenterY(connectorY: number, pinIndex: number): number {
  return connectorY + HEADER_H + PIN_PAD + (pinIndex - 0.5) * PIN_H
}

function matePinBias(id: string, wires: Wire[]): number {
  const pins: number[] = []
  for (const wire of wires) {
    if (wire.to_connector === id && /^\d+$/.test(String(wire.from_pin))) {
      pins.push(Number(wire.from_pin))
    }
    if (wire.from_connector === id && /^\d+$/.test(String(wire.to_pin))) {
      pins.push(Number(wire.to_pin))
    }
  }
  if (!pins.length) return 0
  return pins.reduce((a, b) => a + b, 0) / pins.length
}

/** Connector Y that lines local pins up with already-placed mates. */
function alignedYFor(
  id: string,
  positions: Map<string, { x: number; y: number }>,
  wires: Wire[],
): number | null {
  const mateYs: number[] = []
  const localPins: number[] = []
  for (const wire of wires) {
    const ends: Array<[string, string, string, string]> = [
      [wire.from_connector, String(wire.from_pin), wire.to_connector, String(wire.to_pin)],
      [wire.to_connector, String(wire.to_pin), wire.from_connector, String(wire.from_pin)],
    ]
    for (const [here, herePin, there, therePin] of ends) {
      if (here !== id) continue
      const matePos = positions.get(there)
      if (!matePos || !/^\d+$/.test(therePin) || !/^\d+$/.test(herePin)) continue
      mateYs.push(pinCenterY(matePos.y, Number(therePin)))
      localPins.push(Number(herePin))
    }
  }
  if (!mateYs.length || !localPins.length) return null
  const mateY = mateYs.reduce((a, b) => a + b, 0) / mateYs.length
  const localPin = localPins.reduce((a, b) => a + b, 0) / localPins.length
  return mateY - HEADER_H - PIN_PAD - (localPin - 0.5) * PIN_H
}

/** Next free column near `baseX` that does not overlap existing boxes. */
function freeColumnX(
  baseX: number,
  y: number,
  height: number,
  positions: Map<string, { x: number; y: number }>,
  byId: Map<string, Connector>,
  wires: Wire[],
  direction = 1,
): number {
  let x = baseX
  const step = (direction >= 0 ? 1 : -1) * LAYER_GAP_X
  for (let attempt = 0; attempt < 8; attempt++) {
    let blocked = false
    for (const [otherId, otherPos] of positions) {
      if (Math.abs(otherPos.x - x) > 1) continue
      const other = byId.get(otherId)!
      const otherH = connectorHeight(
        pinLabelsFor(other, wires).length || other.pin_count || 1,
      )
      const gap = STACK_GAP_Y
      const overlaps =
        y < otherPos.y + otherH + gap && y + height + gap > otherPos.y
      if (overlaps) {
        blocked = true
        break
      }
    }
    if (!blocked) return x
    x += step
  }
  return x
}

function assignLayers(
  component: string[],
  adj: Map<string, Set<string>>,
  seed: string,
): string[][] {
  const layerOf = new Map<string, number>()
  const queue = [seed]
  layerOf.set(seed, 0)
  while (queue.length) {
    const cur = queue.shift()!
    const layer = layerOf.get(cur)!
    for (const next of adj.get(cur) ?? []) {
      if (!component.includes(next)) continue
      if (layerOf.has(next)) continue
      layerOf.set(next, layer + 1)
      queue.push(next)
    }
  }
  for (const id of component) {
    if (!layerOf.has(id)) layerOf.set(id, 0)
  }
  const maxLayer = Math.max(0, ...layerOf.values())
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
  for (const id of component) {
    layers[layerOf.get(id)!]!.push(id)
  }
  return layers
}
