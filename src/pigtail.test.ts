import { describe, expect, it } from 'vitest'
import { sceneToDxf } from './diagram/dxf'
import { sceneToPdf } from './diagram/pdf'
import { computeScene } from './diagram/scene'
import { sceneToSvgString } from './diagram/svgString'
import { LIGHT_THEME } from './diagram/theme'
import { parseSheets } from './importExport'
import { pinoutRows, validateDataset } from './validation'
import type { Connector, Wire } from './types'

const OPTIONS = {
  showLabels: true,
  showCableIds: true,
  duplicatePins: new Set<string>(),
  duplicateWireIds: new Set<string>(),
  errorWireIds: new Set<string>(),
}

const pigtail = (extra: Partial<Connector> = {}): Connector => ({
  connector_id: 'P1',
  connector_name: 'Sensor pigtail',
  pin_count: 6,
  position_x: 100,
  position_y: 100,
  pigtail: true,
  pigtail_length: 220,
  pigtail_shield_to_body: true,
  ...extra,
})

const wire = (id: string, pin: string, extra: Partial<Wire> = {}): Wire => ({
  wire_id: id,
  from_connector: 'P1',
  from_pin: pin,
  to_connector: '',
  to_pin: '',
  wire_color: 'red',
  gauge: '22 AWG',
  ...extra,
})

const shielded = [
  wire('W1', '1', { shield_group: 'A', twist_group: 'A' }),
  wire('W2', '2', { shield_group: 'A', twist_group: 'A' }),
]

function isRightAngle(points: Array<{ x: number; y: number }>): boolean {
  return points.slice(1).every((p, i) => {
    const prev = points[i]!
    return Math.abs(p.x - prev.x) < 0.01 || Math.abs(p.y - prev.y) < 0.01
  })
}

describe('pigtail connectors', () => {
  it('draws wires out of a lone pigtail with no hidden connector shown', () => {
    const scene = computeScene([pigtail()], shielded, OPTIONS)
    expect(scene.connectors.map((c) => c.id)).toEqual(['P1'])
    expect(scene.wires).toHaveLength(2)
  })

  it('adds a SHLD pin in the header and routes a right-angle shield link to it', () => {
    const scene = computeScene([pigtail()], shielded, OPTIONS)
    const connector = scene.connectors[0]!
    const shld = connector.pins.find((p) => p.pin === 'SHLD')
    expect(shld?.shield).toBe(true)
    expect(shld!.y).toBeLessThan(connector.y + 42)
    expect(scene.shieldLinks).toHaveLength(1)
    const link = scene.shieldLinks[0]!
    expect(link.pin).toEqual({ x: shld!.x, y: shld!.y })
    expect(isRightAngle(link.points)).toBe(true)
  })

  it('omits the SHLD pin and link when shield-to-body is off', () => {
    const scene = computeScene(
      [pigtail({ pigtail_shield_to_body: false })],
      shielded,
      OPTIONS,
    )
    expect(scene.connectors[0]!.pins.some((p) => p.pin === 'SHLD')).toBe(false)
    expect(scene.shieldLinks).toHaveLength(0)
  })

  it('terminates a shield on the chosen pin instead of SHLD', () => {
    const wires = [
      wire('W1', '1', { shield_group: 'A', shield_pin: '6' }),
      wire('W2', '2', { shield_group: 'A' }),
    ]
    const scene = computeScene(
      [pigtail({ pigtail_shield_to_body: false })],
      wires,
      OPTIONS,
    )
    const pin6 = scene.connectors[0]!.pins.find((p) => p.pin === '6')!
    expect(scene.shieldLinks).toHaveLength(1)
    expect(scene.shieldLinks[0]!.pin).toEqual({ x: pin6.x, y: pin6.y })
    expect(isRightAngle(scene.shieldLinks[0]!.points)).toBe(true)
  })

  it('draws the shield link in every export format', () => {
    const scene = computeScene([pigtail()], shielded, OPTIONS)
    const link = scene.shieldLinks[0]!
    expect(sceneToSvgString(scene, LIGHT_THEME)).toContain(`d="${link.path}"`)
    expect(sceneToDxf(scene)).toContain('SHIELDS')
    expect(sceneToPdf(scene, LIGHT_THEME).length).toBeGreaterThan(0)
  })

  it('does not flag blank TO ends or duplicate pins', () => {
    const result = validateDataset([pigtail()], [wire('W1', '1'), wire('W2', '2')])
    expect(result.refErrors).toEqual([])
    expect(result.duplicateErrors).toEqual([])
  })

  it('supports a blank FROM end on a pigtail', () => {
    const flipped: Wire = {
      ...wire('W1', '1'),
      from_connector: '',
      from_pin: '',
      to_connector: 'P1',
      to_pin: '1',
    }
    const result = validateDataset([pigtail()], [flipped])
    expect(result.refErrors).toEqual([])
    expect(computeScene([pigtail()], [flipped], OPTIONS).wires).toHaveLength(1)
  })

  it('warns when a shield pin is not on the pigtail', () => {
    const result = validateDataset(
      [pigtail()],
      [wire('W1', '1', { shield_group: 'A', shield_pin: '99' })],
    )
    expect(result.warnings.some((w) => w.message.includes('shield pin'))).toBe(true)
  })

  it('labels blank mates as open end and lists a SHLD pinout row', () => {
    const rows = pinoutRows(pigtail(), shielded)
    expect(rows.find((r) => r.pin === '1')?.mates).toBe('open end')
    expect(rows.find((r) => r.pin === 'SHLD')?.wireIds).toEqual(['W1', 'W2'])
  })

  it('imports pigtail and shield pin columns', () => {
    const parsed = parseSheets([
      {
        name: 'Connectors',
        rows: [
          [
            'connector_id',
            'connector_name',
            'pin_count',
            'pigtail',
            'pigtail_length',
            'pigtail_shield_to_body',
          ],
          ['P1', 'Pigtail', 4, 'yes', 150, 'true'],
        ],
      },
      {
        name: 'Wires',
        rows: [
          ['wire_id', 'from_connector', 'from_pin', 'shield_group', 'shield_pin'],
          ['W1', 'P1', '1', 'A', '4'],
        ],
      },
    ])
    expect(parsed.connectors?.[0]).toMatchObject({
      pigtail: true,
      pigtail_length: 150,
      pigtail_shield_to_body: true,
    })
    expect(parsed.wires?.[0]?.shield_pin).toBe('4')
  })
})

describe('DXF export', () => {
  it('writes a well-formed R12 file without entities R12 cannot read', () => {
    const scene = computeScene([pigtail()], shielded, OPTIONS)
    const dxf = sceneToDxf(scene)
    const lines = dxf.split('\n')
    expect(lines.pop()).toBe('')
    expect(lines.length % 2).toBe(0)
    for (let i = 0; i < lines.length; i += 2) {
      expect(lines[i]).toMatch(/^\d+$/)
    }
    expect(dxf).toContain('AC1009')
    expect(dxf.endsWith('0\nEOF\n')).toBe(true)
    expect(dxf).not.toContain('LWPOLYLINE')
    expect(dxf).not.toMatch(/\d[eE][-+]?\d/)
    expect(dxf).not.toMatch(/NaN|Infinity|undefined/)
    expect(dxf).toContain('SEQEND')
    expect(dxf).toContain('LTYPE')
  })
})
