import type { Connector, Wire } from './types'

/** Suffix of the invisible connector that terminates a pigtail's free end. */
export const PIGTAIL_END_SUFFIX = '_PIGTAIL_END'
/** Label of the extra pin that shields terminate on (the connector body). */
export const SHIELD_PIN = 'SHLD'
export const DEFAULT_PIGTAIL_LENGTH = 100
export const MIN_PIGTAIL_LENGTH = 20

export function pigtailEndId(connectorId: string): string {
  return `${connectorId}${PIGTAIL_END_SUFFIX}`
}

export function isPigtailEndId(connectorId: string): boolean {
  return connectorId.endsWith(PIGTAIL_END_SUFFIX)
}

export function pigtailBaseId(connectorId: string): string {
  return isPigtailEndId(connectorId)
    ? connectorId.slice(0, -PIGTAIL_END_SUFFIX.length)
    : connectorId
}

export function pigtailLength(connector: Connector): number {
  const raw = Number(connector.pigtail_length)
  if (!Number.isFinite(raw) || connector.pigtail_length === undefined) {
    return DEFAULT_PIGTAIL_LENGTH
  }
  return Math.max(MIN_PIGTAIL_LENGTH, raw)
}

export function hasShieldPin(connector: Connector): boolean {
  return connector.pigtail === true && connector.pigtail_shield_to_body === true
}

export type OpenEnd = {
  /** The pigtail connector that carries the wire. */
  connectorId: string
  pin: string
  /** Which side of the wire row is left blank (the free end). */
  open: 'from' | 'to'
}

/**
 * A wire whose other end is blank and whose connected end is a pigtail
 * connector: the free end is implied, so it needs no connector or pin.
 */
export function openEndOf(
  wire: Wire,
  byId: Map<string, Connector>,
): OpenEnd | null {
  const from = wire.from_connector?.trim() ?? ''
  const to = wire.to_connector?.trim() ?? ''
  if (from && !to && byId.get(from)?.pigtail) {
    return { connectorId: from, pin: String(wire.from_pin ?? ''), open: 'to' }
  }
  if (to && !from && byId.get(to)?.pigtail) {
    return { connectorId: to, pin: String(wire.to_pin ?? ''), open: 'from' }
  }
  return null
}

/** Pin a shield group terminates on: an explicit per-wire pin, else SHLD. */
export function shieldPinFor(wires: Wire[]): string | undefined {
  for (const wire of wires) {
    const pin = wire.shield_pin?.trim()
    if (pin) return pin
  }
  return undefined
}
