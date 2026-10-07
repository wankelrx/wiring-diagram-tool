import { describe, expect, it } from 'vitest'
import { computeLayout, displayPinOrder } from './diagram/layout'
import type { Connector, Wire } from './types'

const connectors: Connector[] = [
  { connector_id: 'J1', connector_name: 'J1', pin_count: 14 },
  { connector_id: 'J2', connector_name: 'J2', pin_count: 14 },
]

const wire = (id: string, from: string, to: string, extra: Partial<Wire> = {}): Wire => ({
  wire_id: id,
  from_connector: 'J1',
  from_pin: from,
  to_connector: 'J2',
  to_pin: to,
  wire_color: 'red',
  gauge: '22 AWG',
  ...extra,
})

describe('pin display order', () => {
  const wires = [
    wire('W12', '12', '12', { twist_group: 'A' }),
    wire('W13', '13', '13'),
    wire('W14', '14', '14', { twist_group: 'A' }),
  ]

  it('moves twisted pins together and keeps the untwisted pin outside', () => {
    const labels = Array.from({ length: 14 }, (_, i) => String(i + 1))
    const order = displayPinOrder(connectors[0]!, wires, labels)
    const a = order.indexOf('12')
    const b = order.indexOf('14')
    expect(Math.abs(a - b)).toBe(1)
    expect(order.indexOf('13')).not.toBe(Math.min(a, b) + 1)
    expect(order).toHaveLength(14)
    expect(new Set(order).size).toBe(14)
  })

  it('applies the order to laid out pin rows', () => {
    const layout = computeLayout(connectors, wires)
    const pins = layout.byId.get('J1')!.pins
    const y = (pin: string) => pins.find((p) => p.pin === pin)!.y
    expect(Math.abs(y('12') - y('14'))).toBeLessThan(25)
    expect(y('13')).toBeGreaterThan(Math.max(y('12'), y('14')))
  })

  it('leaves numeric order alone without twists', () => {
    const labels = ['1', '2', '3']
    expect(displayPinOrder(connectors[0]!, [wire('W1', '1', '1')], labels)).toEqual(labels)
  })
})
