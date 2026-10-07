import { describe, expect, it } from 'vitest'
import { autoArrangeConnectors } from './autoArrange'
import { computeScene } from './diagram/scene'
import { SAMPLE_CONNECTORS, SAMPLE_WIRES } from './sampleData'
import type { Connector, Wire } from './types'

const sceneOptions = {
  showLabels: true,
  showCableIds: true,
  duplicatePins: new Set<string>(),
  duplicateWireIds: new Set<string>(),
  errorWireIds: new Set<string>(),
}

describe('autoArrangeConnectors', () => {
  it('places connectors with the hub between opposite-side leaves', () => {
    const connectors: Connector[] = [
      { connector_id: 'A', connector_name: 'A', pin_count: 2, position_x: 900, position_y: 10 },
      { connector_id: 'B', connector_name: 'B', pin_count: 4, position_x: 10, position_y: 10 },
      { connector_id: 'C', connector_name: 'C', pin_count: 2, position_x: 500, position_y: 400 },
    ]
    const wires: Wire[] = [
      {
        wire_id: 'W1',
        from_connector: 'B',
        from_pin: '1',
        to_connector: 'A',
        to_pin: '1',
        wire_color: 'red',
        gauge: '22',
      },
      {
        wire_id: 'W2',
        from_connector: 'B',
        from_pin: '2',
        to_connector: 'C',
        to_pin: '1',
        wire_color: 'blue',
        gauge: '22',
      },
      {
        wire_id: 'W3',
        from_connector: 'B',
        from_pin: '3',
        to_connector: 'A',
        to_pin: '2',
        wire_color: 'green',
        gauge: '22',
      },
    ]
    const arranged = autoArrangeConnectors(connectors, wires)
    const byId = new Map(arranged.map((c) => [c.connector_id, c]))
    const bx = byId.get('B')!.position_x!
    const ax = byId.get('A')!.position_x!
    const cx = byId.get('C')!.position_x!
    // Hub B sits between A (heavier) and C on opposite sides.
    expect((ax - bx) * (cx - bx)).toBeLessThan(0)
  })

  it('arranges the sample harness without errors', () => {
    const arranged = autoArrangeConnectors(SAMPLE_CONNECTORS, SAMPLE_WIRES)
    expect(arranged.every((c) => Number.isFinite(c.position_x))).toBe(true)
    expect(arranged.every((c) => Number.isFinite(c.position_y))).toBe(true)
  })

  it('aligns J3 near J1 sensor pins instead of stacking far below J2', () => {
    const arranged = autoArrangeConnectors(SAMPLE_CONNECTORS, SAMPLE_WIRES)
    const byId = new Map(arranged.map((c) => [c.connector_id, c]))
    const j1 = byId.get('J1')!
    const j2 = byId.get('J2')!
    const j3 = byId.get('J3')!
    // Heaviest mate (J2) and lighter mate (J3) sit on opposite sides of the hub.
    expect((j2.position_x! - j1.position_x!) * (j3.position_x! - j1.position_x!)).toBeLessThan(
      0,
    )
    expect(Math.abs((j3.position_y ?? 0) - (j1.position_y ?? 0) - 140)).toBeLessThan(80)
  })
})

describe('overall shield', () => {
  it('emits pair and overall shield envelopes with distinct kinds', () => {
    const scene = computeScene(SAMPLE_CONNECTORS, SAMPLE_WIRES, sceneOptions)
    const kinds = new Set(scene.shields.map((s) => s.kind))
    expect(kinds.has('pair')).toBe(true)
    expect(kinds.has('overall')).toBe(true)
    const overall = scene.shields.filter((s) => s.kind === 'overall')
    expect(overall.some((s) => s.id.includes('CAB1'))).toBe(true)
  })
})
