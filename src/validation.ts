import { isKnownWireColor } from './colors'
import type { Connector, PinoutRow, ValidationError, Wire } from './types'

export function pinKey(connectorId: string, pin: string): string {
  return `${connectorId}\u001f${pin}`
}

export function isNumericPin(pin: string): boolean {
  return /^\d+$/.test(pin.trim())
}

export function pinLabelsFor(connector: Connector, wires: Wire[]): string[] {
  const count = Math.max(0, Math.floor(Number(connector.pin_count)) || 0)
  const labels: string[] = []
  for (let i = 1; i <= count; i++) labels.push(String(i))
  const extras: string[] = []
  for (const wire of wires) {
    const ends: Array<[string, string]> = [
      [wire.from_connector, String(wire.from_pin ?? '')],
      [wire.to_connector, String(wire.to_pin ?? '')],
    ]
    for (const [cid, pin] of ends) {
      const trimmed = pin.trim()
      if (cid !== connector.connector_id || !trimmed || isNumericPin(trimmed)) {
        continue
      }
      if (!labels.includes(trimmed) && !extras.includes(trimmed)) extras.push(trimmed)
    }
  }
  extras.sort((a, b) => a.localeCompare(b))
  return [...labels, ...extras]
}

export function validPinsFor(connector: Connector, wires: Wire[] = []): Set<string> {
  return new Set(pinLabelsFor(connector, wires))
}

/** First non-empty signal name seen on each pin of a connector. */
export function pinSignalMap(
  connector: Connector,
  wires: Wire[],
): Map<string, string> {
  const map = new Map<string, string>()
  const add = (pin: string, signal?: string) => {
    const key = pin.trim()
    const value = signal?.trim()
    if (!key || !value || map.get(key)) return
    map.set(key, value)
  }
  for (const wire of wires) {
    if (wire.from_connector === connector.connector_id) {
      add(String(wire.from_pin ?? ''), wire.signal_name)
    }
    if (wire.to_connector === connector.connector_id) {
      add(String(wire.to_pin ?? ''), wire.signal_name)
    }
  }
  return map
}

export type ValidationResult = {
  refErrors: ValidationError[]
  duplicateErrors: ValidationError[]
  warnings: ValidationError[]
  duplicatePins: Set<string>
  duplicateWireIds: Set<string>
  errorWireIds: Set<string>
}

export function validateDataset(
  connectors: Connector[],
  wires: Wire[],
): ValidationResult {
  const refErrors: ValidationError[] = []
  const duplicateErrors: ValidationError[] = []
  const warnings: ValidationError[] = []
  const errorWireIds = new Set<string>()

  const connectorCounts = new Map<string, number>()
  for (const connector of connectors) {
    const id = connector.connector_id.trim()
    if (!id) {
      refErrors.push({
        kind: 'missing_ref',
        message: `A connector is missing connector_id`,
        connector_id: connector.connector_id,
      })
      continue
    }
    connectorCounts.set(id, (connectorCounts.get(id) ?? 0) + 1)
    if (!Number.isFinite(connector.pin_count) || connector.pin_count < 0) {
      refErrors.push({
        kind: 'missing_ref',
        message: `Connector ${id} has an invalid pin_count`,
        connector_id: id,
      })
    }
  }
  for (const [id, count] of connectorCounts) {
    if (count < 2) continue
    duplicateErrors.push({
      kind: 'duplicate_id',
      message: `Connector ID "${id}" is used ${count} times`,
      connector_id: id,
    })
  }

  const wireCounts = new Map<string, number>()
  for (const wire of wires) {
    const id = wire.wire_id.trim()
    if (!id) {
      refErrors.push({
        kind: 'missing_ref',
        message: `A wire is missing wire_id`,
        wire_id: wire.wire_id,
      })
      continue
    }
    wireCounts.set(id, (wireCounts.get(id) ?? 0) + 1)
  }
  for (const [id, count] of wireCounts) {
    if (count < 2) continue
    duplicateErrors.push({
      kind: 'duplicate_id',
      message: `Wire ID "${id}" is used ${count} times`,
      wire_id: id,
    })
    errorWireIds.add(id)
  }

  const byId = new Map(connectors.map((c) => [c.connector_id, c]))
  const pinSets = new Map(
    connectors.map((c) => [c.connector_id, validPinsFor(c, wires)]),
  )

  for (const wire of wires) {
    if (
      wire.from_connector &&
      wire.to_connector &&
      wire.from_connector === wire.to_connector &&
      String(wire.from_pin) === String(wire.to_pin)
    ) {
      refErrors.push({
        kind: 'missing_ref',
        message: `Wire ${wire.wire_id || '(unnamed)'} connects a pin to itself`,
        wire_id: wire.wire_id,
      })
      errorWireIds.add(wire.wire_id)
    }
    const ends: Array<{ connectorId: string; pin: string; label: string }> = [
      {
        connectorId: wire.from_connector,
        pin: String(wire.from_pin ?? ''),
        label: 'from',
      },
      {
        connectorId: wire.to_connector,
        pin: String(wire.to_pin ?? ''),
        label: 'to',
      },
    ]
    for (const end of ends) {
      // Skip validation for pigtail end connectors as they're virtual
      const isPigtailEnd = end.connectorId?.endsWith('_PIGTAIL_END')
      if (isPigtailEnd) continue
      
      // Check if the FROM connector is a pigtail
      const fromConnector = byId.get(wire.from_connector)
      const isPigtailWire = fromConnector?.pigtail === true
      
      // For pigtail wires, the TO connector and pin are optional
      if (isPigtailWire && end.label === 'to') {
        // Skip validation for TO fields on pigtail wires
        if (!end.connectorId || !end.pin.trim()) {
          continue
        }
      }
      
      if (!end.connectorId) {
        refErrors.push({
          kind: 'missing_ref',
          message: `Wire ${wire.wire_id || '(unnamed)'} has an empty ${end.label} connector`,
          wire_id: wire.wire_id,
        })
        errorWireIds.add(wire.wire_id)
        continue
      }
      const connector = byId.get(end.connectorId)
      if (!connector) {
        refErrors.push({
          kind: 'missing_ref',
          message: `Wire ${wire.wire_id || '(unnamed)'} ${end.label} connector "${end.connectorId}" does not exist`,
          wire_id: wire.wire_id,
          connector_id: end.connectorId,
        })
        errorWireIds.add(wire.wire_id)
        continue
      }
      const pins = pinSets.get(end.connectorId)
      const pin = end.pin.trim()
      if (!pin) {
        refErrors.push({
          kind: 'missing_ref',
          message: `Wire ${wire.wire_id || '(unnamed)'} has an empty ${end.label} pin`,
          wire_id: wire.wire_id,
          connector_id: end.connectorId,
        })
        errorWireIds.add(wire.wire_id)
        continue
      }
      if (isNumericPin(pin) && pins && !pins.has(pin)) {
        refErrors.push({
          kind: 'missing_ref',
          message: `Wire ${wire.wire_id || '(unnamed)'} ${end.label} pin ${pin} is not on ${end.connectorId} (1–${connector.pin_count})`,
          wire_id: wire.wire_id,
          connector_id: end.connectorId,
          pin,
        })
        errorWireIds.add(wire.wire_id)
      }
    }
  }

  const usage = new Map<string, string[]>()
  for (const wire of wires) {
    const keys = [
      pinKey(wire.from_connector, String(wire.from_pin)),
      pinKey(wire.to_connector, String(wire.to_pin)),
    ]
    for (const key of keys) {
      const list = usage.get(key) ?? []
      list.push(wire.wire_id)
      usage.set(key, list)
    }
  }

  const duplicatePins = new Set<string>()
  const duplicateWireIds = new Set<string>()

  for (const [key, ids] of usage) {
    const unique = [...new Set(ids)]
    if (unique.length < 2) continue
    const sep = key.indexOf('\u001f')
    const connector_id = key.slice(0, sep)
    const pin = key.slice(sep + 1)
    duplicatePins.add(`${connector_id}:${pin}`)
    for (const id of unique) duplicateWireIds.add(id)
    duplicateErrors.push({
      kind: 'duplicate_pin',
      message: `Pin ${connector_id}:${pin} is used by wires ${unique.join(', ')}`,
      connector_id,
      pin,
    })
  }

  for (const wire of wires) {
    if (wire.wire_color.trim() && !isKnownWireColor(wire.wire_color)) {
      warnings.push({
        kind: 'warning',
        message: `Wire ${wire.wire_id || '(unnamed)'} color "${wire.wire_color}" is unrecognized — drawn gray`,
        wire_id: wire.wire_id,
      })
    }
  }

  return {
    refErrors,
    duplicateErrors,
    warnings,
    duplicatePins,
    duplicateWireIds,
    errorWireIds,
  }
}

export function firstFreePin(
  connector: Connector | undefined,
  wires: Wire[],
): string {
  return firstFreePins(connector, wires, 1)[0] ?? '1'
}

export function firstFreePins(
  connector: Connector | undefined,
  wires: Wire[],
  count: number,
): string[] {
  if (!connector || count < 1) return Array.from({ length: Math.max(count, 1) }, () => '1')
  const used = new Set<string>()
  for (const wire of wires) {
    if (wire.from_connector === connector.connector_id) {
      used.add(String(wire.from_pin))
    }
    if (wire.to_connector === connector.connector_id) {
      used.add(String(wire.to_pin))
    }
  }
  const pinCount = Math.max(1, Math.floor(connector.pin_count) || 1)
  const out: string[] = []
  for (let i = 1; i <= pinCount && out.length < count; i++) {
    if (!used.has(String(i))) out.push(String(i))
  }
  while (out.length < count) out.push(String(pinCount))
  return out
}

export function pinoutRows(connector: Connector, wires: Wire[]): PinoutRow[] {
  const rows: PinoutRow[] = []
  for (const pin of pinLabelsFor(connector, wires)) {
    const related = wires.filter(
      (w) =>
        (w.from_connector === connector.connector_id &&
          String(w.from_pin) === pin) ||
        (w.to_connector === connector.connector_id && String(w.to_pin) === pin),
    )
    const mates = related.map((w) => {
      if (
        w.from_connector === connector.connector_id &&
        String(w.from_pin) === pin
      ) {
        return `${w.to_connector}:${w.to_pin}`
      }
      return `${w.from_connector}:${w.from_pin}`
    })
    rows.push({
      pin,
      signal: related.map((w) => w.signal_name).filter(Boolean).join(', ') || '-',
      color: related.map((w) => w.wire_color).filter(Boolean).join(', ') || '-',
      gauge: related.map((w) => w.gauge).filter(Boolean).join(', ') || '-',
      mates: mates.join(', ') || '-',
      wireIds: related.map((w) => w.wire_id),
    })
  }
  return rows
}
