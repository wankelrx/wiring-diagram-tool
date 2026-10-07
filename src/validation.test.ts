import { describe, expect, it } from 'vitest'
import { firstFreePin, pinoutRows, validateDataset } from './validation'
import type { Connector, Wire } from './types'

const connectors: Connector[] = [
  { connector_id: 'J1', connector_name: 'A', pin_count: 2 },
  { connector_id: 'J2', connector_name: 'B', pin_count: 2 },
]

describe('validateDataset', () => {
  it('flags wires that reference missing connectors and pins', () => {
    const wires: Wire[] = [
      {
        wire_id: 'W1',
        from_connector: 'J9',
        from_pin: '1',
        to_connector: 'J2',
        to_pin: '9',
        wire_color: 'red',
        gauge: '22 AWG',
      },
    ]
    const result = validateDataset(connectors, wires)
    expect(result.refErrors.length).toBeGreaterThanOrEqual(2)
    expect(result.errorWireIds.has('W1')).toBe(true)
  })

  it('flags duplicate pin usage across wires', () => {
    const wires: Wire[] = [
      {
        wire_id: 'W1',
        from_connector: 'J1',
        from_pin: '1',
        to_connector: 'J2',
        to_pin: '1',
        wire_color: 'red',
        gauge: '22 AWG',
      },
      {
        wire_id: 'W2',
        from_connector: 'J1',
        from_pin: '1',
        to_connector: 'J2',
        to_pin: '2',
        wire_color: 'black',
        gauge: '22 AWG',
      },
    ]
    const result = validateDataset(connectors, wires)
    expect(result.duplicatePins.has('J1:1')).toBe(true)
    expect(result.duplicateWireIds.has('W1')).toBe(true)
    expect(result.duplicateWireIds.has('W2')).toBe(true)
    expect(result.duplicateErrors[0]?.kind).toBe('duplicate_pin')
  })

  it('flags duplicate and blank IDs and empty pins', () => {
    const result = validateDataset(
      [
        { connector_id: 'J1', connector_name: 'A', pin_count: 2 },
        { connector_id: 'J1', connector_name: 'B', pin_count: 2 },
        { connector_id: '', connector_name: 'C', pin_count: 2 },
      ],
      [
        {
          wire_id: '',
          from_connector: 'J1',
          from_pin: '',
          to_connector: 'J2',
          to_pin: '1',
          wire_color: 'red',
          gauge: '22 AWG',
        },
        {
          wire_id: 'W9',
          from_connector: 'J1',
          from_pin: '1',
          to_connector: 'J1',
          to_pin: '1',
          wire_color: 'black',
          gauge: '22 AWG',
        },
      ],
    )
    expect(result.duplicateErrors.some((error) => error.kind === 'duplicate_id')).toBe(true)
    expect(result.refErrors.some((error) => error.message.includes('empty from pin'))).toBe(true)
    expect(result.refErrors.some((error) => error.message.includes('missing wire_id'))).toBe(true)
    expect(result.refErrors.some((error) => error.message.includes('itself'))).toBe(true)
  })

  it('allows alphanumeric extra pins beyond pin_count', () => {
    const extra: Wire[] = [
      {
        wire_id: 'WA',
        from_connector: 'J1',
        from_pin: 'A',
        to_connector: 'J2',
        to_pin: '1',
        wire_color: 'blue',
        gauge: '22 AWG',
      },
    ]
    const result = validateDataset(connectors, extra)
    expect(result.errorWireIds.has('WA')).toBe(false)
    const rows = pinoutRows(connectors[0]!, extra)
    expect(rows.map((row) => row.pin)).toEqual(['1', '2', 'A'])
  })

  it('picks the first unused pin on a connector', () => {
    const wires: Wire[] = [
      {
        wire_id: 'W1',
        from_connector: 'J1',
        from_pin: '1',
        to_connector: 'J2',
        to_pin: '1',
        wire_color: 'red',
        gauge: '22 AWG',
      },
    ]
    expect(firstFreePin(connectors[0], wires)).toBe('2')
  })

  it('builds a live pinout table', () => {
    const wires: Wire[] = [
      {
        wire_id: 'W1',
        from_connector: 'J1',
        from_pin: '1',
        to_connector: 'J2',
        to_pin: '2',
        wire_color: 'red',
        gauge: '16 AWG',
        signal_name: '+24V',
      },
    ]
    const rows = pinoutRows(connectors[0]!, wires)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.signal).toBe('+24V')
    expect(rows[0]?.mates).toBe('J2:2')
    expect(rows[1]?.mates).toBe('-')
  })
})
