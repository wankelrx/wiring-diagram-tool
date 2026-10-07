import { describe, expect, it } from 'vitest'
import { parseCsvText, parseSheets } from './importExport'
import { resolveWireColor } from './colors'

describe('import and colors', () => {
  it('parses Connectors and Wires sheets', () => {
    const parsed = parseSheets([
      {
        name: 'Connectors',
        rows: [
          ['connector_id', 'connector_name', 'pin_count'],
          ['J1', 'Box', 2],
        ],
      },
      {
        name: 'Wires',
        rows: [
          [
            'wire_id',
            'from_connector',
            'from_pin',
            'to_connector',
            'to_pin',
            'wire_color',
            'gauge',
          ],
          ['W1', 'J1', '1', 'J1', '2', 'red', '22 AWG'],
        ],
      },
    ])
    expect(parsed.connectors).toHaveLength(1)
    expect(parsed.wires).toHaveLength(1)
    expect(parsed.wires?.[0]?.wire_color).toBe('red')
  })

  it('parses CSV text into rows', () => {
    const rows = parseCsvText('wire_id,from_connector\n"W1,A",J1\n')
    expect(rows[0]).toEqual(['wire_id', 'from_connector'])
    expect(rows[1]).toEqual(['W1,A', 'J1'])
  })

  it('resolves named and hex wire colors', () => {
    expect(resolveWireColor('red')).toBe('#dc2626')
    expect(resolveWireColor('#FF0000')).toBe('#FF0000')
    expect(resolveWireColor('#f00')).toBe('#ff0000')
  })

  it('parses overall_shield on wires', () => {
    const parsed = parseSheets([
      {
        name: 'Wires',
        rows: [
          [
            'wire_id',
            'from_connector',
            'from_pin',
            'to_connector',
            'to_pin',
            'wire_color',
            'gauge',
            'overall_shield',
          ],
          ['W1', 'J1', '1', 'J2', '1', 'red', '22 AWG', 'CAB1'],
        ],
      },
    ])
    expect(parsed.wires?.[0]?.overall_shield).toBe('CAB1')
  })
})
