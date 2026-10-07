import { describe, expect, it } from 'vitest'
import { autoArrangeConnectors } from '../autoArrange'
import { computeLayout } from './layout'
import { bendCount } from './paths'
import { computeScene } from './scene'
import { sceneToDxf } from './dxf'
import { layoutExportDocument } from './exportDocument'
import { sceneToSvgString } from './svgString'
import { sceneToPdf } from './pdf'
import { LIGHT_THEME } from './theme'
import { SAMPLE_CONNECTORS, SAMPLE_WIRES } from '../sampleData'

const sceneOptions = {
  showLabels: true,
  showCableIds: true,
  duplicatePins: new Set<string>(),
  duplicateWireIds: new Set<string>(),
  errorWireIds: new Set<string>(),
}

describe('layout and scene', () => {
  it('uses manual positions when provided', () => {
    const layout = computeLayout(SAMPLE_CONNECTORS, SAMPLE_WIRES)
    const j1 = layout.byId.get('J1')
    expect(j1?.x).toBe(520)
    expect(j1?.y).toBe(60)
    expect(j1?.pins.length).toBe(10)
  })

  it('auto-places connectors without coordinates', () => {
    const layout = computeLayout(
      [
        { connector_id: 'A', connector_name: 'A', pin_count: 2 },
        { connector_id: 'B', connector_name: 'B', pin_count: 2 },
      ],
      [
        {
          wire_id: 'W1',
          from_connector: 'A',
          from_pin: '1',
          to_connector: 'B',
          to_pin: '1',
          wire_color: 'red',
          gauge: '22 AWG',
        },
      ],
    )
    expect(layout.connectors).toHaveLength(2)
    expect(layout.connectors[0]?.x).not.toEqual(layout.connectors[1]?.x)
  })

  it('keeps every routed wire continuously visible', () => {
    const scene = computeScene(SAMPLE_CONNECTORS, SAMPLE_WIRES, sceneOptions)
    expect(scene.wires.length).toBe(SAMPLE_WIRES.length)
    for (const wire of scene.wires) {
      expect(wire.points.length).toBeGreaterThanOrEqual(2)
      expect(wire.path.startsWith('M ')).toBe(true)
    }
    expect(scene.shields.length).toBeGreaterThan(0)
    expect(scene.frame.title).toBe('WIRING DIAGRAM')
  })

  it('draws twisted pairs along one shared braid', () => {
    const scene = computeScene(SAMPLE_CONNECTORS, SAMPLE_WIRES, sceneOptions)
    const canH = scene.wires.find((w) => w.id === 'W3')
    const canL = scene.wires.find((w) => w.id === 'W4')
    expect(canH && canL).toBeTruthy()
    let maxSep = 0
    const n = Math.min(canH!.points.length, canL!.points.length)
    const start = Math.floor(n * 0.25)
    const end = Math.floor(n * 0.75)
    for (let i = start; i < end; i++) {
      const a = canH!.points[i]!
      const b = canL!.points[i]!
      maxSep = Math.max(maxSep, Math.hypot(a.x - b.x, a.y - b.y))
    }
    expect(maxSep).toBeGreaterThan(4)
    expect(maxSep).toBeLessThan(24)
  })

  it('keeps plain (non-twist) wires strictly orthogonal', () => {
    const scene = computeScene(SAMPLE_CONNECTORS, SAMPLE_WIRES, sceneOptions)
    const twistIds = new Set(
      SAMPLE_WIRES.filter((w) => w.twist_group).map((w) => w.wire_id),
    )
    const plain = scene.wires.filter((w) => !twistIds.has(w.id))
    for (const wire of plain) {
      for (let i = 1; i < wire.points.length; i++) {
        const a = wire.points[i - 1]!
        const b = wire.points[i]!
        const dx = Math.abs(a.x - b.x)
        const dy = Math.abs(a.y - b.y)
        expect(dx < 0.5 || dy < 0.5).toBe(true)
      }
    }
  })

  it('faces each pin toward its mate connector', () => {
    const layout = computeLayout(SAMPLE_CONNECTORS, SAMPLE_WIRES)
    const j1 = layout.byId.get('J1')!
    const pin3 = j1.pins.find((p) => p.pin === '3') // to J2 (left)
    const pin5 = j1.pins.find((p) => p.pin === '5') // to J2 (left)
    const pin8 = j1.pins.find((p) => p.pin === '8') // to J3 (right)
    expect(pin3?.side).toBe('left')
    expect(pin5?.side).toBe('left')
    expect(pin8?.side).toBe('right')
  })

  it('routes ENABLE between J1 and J2 without sweeping past J1 to the right', () => {
    const scene = computeScene(SAMPLE_CONNECTORS, SAMPLE_WIRES, sceneOptions)
    const enable = scene.wires.find((w) => w.id === 'W7')!
    const j1 = scene.connectors.find((c) => c.id === 'J1')!
    const maxX = Math.max(...enable.points.map((p) => p.x))
    expect(maxX).toBeLessThan(j1.x + j1.width + 48)
  })

  it('keeps sample J1–J2 conductors in a compact corridor without under-loops', () => {
    const scene = computeScene(SAMPLE_CONNECTORS, SAMPLE_WIRES, sceneOptions)
    const cab = scene.wires.filter((w) =>
      ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'].includes(w.id),
    )
    const ys = cab.flatMap((w) => w.points.map((p) => p.y))
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(200)
    const overall = scene.shields.filter((s) => s.kind === 'overall')
    const pairs = scene.shields.filter((s) => s.kind === 'pair')
    expect(overall.length).toBe(1)
    expect(pairs.length).toBeGreaterThanOrEqual(3)
  })

  it('keeps parallel shielded sensor wires on distinct horizontal lanes', () => {
    const scene = computeScene(SAMPLE_CONNECTORS, SAMPLE_WIRES, sceneOptions)
    const sensors = ['W8', 'W9', 'W10']
      .map((id) => scene.wires.find((w) => w.id === id)!)
      .filter(Boolean)
    // Twisted SIG pair shares a braid; drain stays on its own pin lane.
    const drain = sensors.find((w) => w.id === 'W10')!
    const pair = sensors.filter((w) => w.id !== 'W10')
    const pairMid =
      pair.reduce((sum, w) => {
        const ys = w.points.map((p) => p.y)
        return sum + (Math.min(...ys) + Math.max(...ys)) / 2
      }, 0) / Math.max(pair.length, 1)
    const drainYs = drain.points.map((p) => p.y)
    const drainMid = (Math.min(...drainYs) + Math.max(...drainYs)) / 2
    expect(Math.abs(drainMid - pairMid)).toBeGreaterThan(8)
  })

  it('exports PDF and SVG with pinout tables', () => {
    const scene = computeScene(SAMPLE_CONNECTORS, SAMPLE_WIRES, sceneOptions)
    const doc = layoutExportDocument(scene, SAMPLE_CONNECTORS, SAMPLE_WIRES)
    expect(doc.tables).toHaveLength(SAMPLE_CONNECTORS.length + 1)
    const svg = sceneToSvgString(scene, LIGHT_THEME, doc)
    expect(svg).toContain('PINOUT')
    expect(svg).toContain('WIRE LIST')
    expect(svg).toContain('Motor Controller')
    expect(svg).toContain('DWG NO')
    const pdf = sceneToPdf(scene, LIGHT_THEME, doc)
    const decoded = new TextDecoder().decode(pdf)
    expect(decoded.startsWith('%PDF-')).toBe(true)
    expect(decoded).toContain('%%EOF')
    expect(decoded).toContain('PINOUT')
    expect(decoded).toContain('WIRE LIST')
    expect(decoded).toContain('startxref')
    const dxf = sceneToDxf(scene, doc)
    expect(dxf).toContain('SECTION')
    expect(dxf).toContain('LWPOLYLINE')
    expect(dxf).toContain('WIRING DIAGRAM')
    expect(dxf).toContain('$INSUNITS')
    expect(dxf).toContain('PINOUT')
    expect(dxf).toContain('WIRE LIST')
  })

  it('auto-places connectors without overlapping boxes', () => {
    const connectors = Array.from({ length: 6 }, (_, i) => ({
      connector_id: `C${i}`,
      connector_name: `C${i}`,
      pin_count: 6 + i,
    }))
    const wires = connectors.slice(1).map((c, i) => ({
      wire_id: `W${i}`,
      from_connector: connectors[i]!.connector_id,
      from_pin: '1',
      to_connector: c.connector_id,
      to_pin: '1',
      wire_color: 'red',
      gauge: '22 AWG',
    }))
    const layout = computeLayout(connectors, wires)
    const boxes = layout.connectors
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!
        const b = boxes[j]!
        const overlapX =
          Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
        const overlapY =
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
        expect(overlapX > 0 && overlapY > 0).toBe(false)
      }
    }
  })

  it('separates overlapping manual connector positions', () => {
    const connectors = [
      { connector_id: 'A', connector_name: 'A', pin_count: 4, position_x: 100, position_y: 100 },
      { connector_id: 'B', connector_name: 'B', pin_count: 4, position_x: 110, position_y: 110 },
    ]
    const layout = computeLayout(connectors, [])
    const a = layout.byId.get('A')!
    const b = layout.byId.get('B')!
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
    const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
    expect(overlapX > 0 && overlapY > 0).toBe(false)
  })

  it('draws shields as a closed dashed outline envelope', () => {
    const scene = computeScene(SAMPLE_CONNECTORS, SAMPLE_WIRES, sceneOptions)
    expect(scene.shields.length).toBeGreaterThan(0)
    for (const shield of scene.shields) {
      expect(shield.outline.length).toBeGreaterThan(3)
      const first = shield.outline[0]!
      const last = shield.outline[shield.outline.length - 1]!
      expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeLessThan(0.01)
    }
  })

  it('keeps overall outer shields free of braid waviness after hard nudges', () => {
    const arranged = autoArrangeConnectors(SAMPLE_CONNECTORS, SAMPLE_WIRES)
    const hard = arranged.map((c) => {
      const m: Record<string, [number, number]> = {
        J1: [80, 120],
        J2: [40, 220],
        J3: [-70, -90],
      }
      const n = m[c.connector_id]
      if (!n) return c
      return {
        ...c,
        position_x: (c.position_x ?? 0) + n[0],
        position_y: (c.position_y ?? 0) + n[1],
      }
    })
    const scene = computeScene(hard, SAMPLE_WIRES, sceneOptions)
    const overall = scene.shields.filter((s) => s.kind === 'overall')
    expect(overall.length).toBeGreaterThan(0)
    for (const shield of overall) {
      expect(shield.outline.length).toBeLessThan(24)
      let turns = 0
      let diagonal = 0
      for (let i = 1; i < shield.outline.length; i++) {
        const a = shield.outline[i - 1]!
        const b = shield.outline[i]!
        const dx = Math.abs(a.x - b.x)
        const dy = Math.abs(a.y - b.y)
        if (dx > 0.75 && dy > 0.75) diagonal += 1
      }
      for (let i = 2; i < shield.outline.length; i++) {
        const a = shield.outline[i - 2]!
        const b = shield.outline[i - 1]!
        const c = shield.outline[i]!
        const abH = Math.abs(a.y - b.y) < 1
        const bcH = Math.abs(b.y - c.y) < 1
        if (abH !== bcH) turns += 1
      }
      expect(diagonal).toBe(0)
      expect(turns).toBeLessThan(20)
    }

    // Pair jackets wrap every member but should not float far from the trunk.
    // Corners at bends sit sqrt(2) * half-width from the centerline.
    const pairs = scene.shields.filter((s) => s.kind === 'pair')
    for (const shield of pairs) {
      const tube = shield.points
      expect(tube.length).toBeGreaterThan(1)
      // Outline half-width proxy: median distance from tube to outline.
      let maxClear = 0
      for (const p of shield.outline) {
        let nearest = Infinity
        for (let i = 1; i < tube.length; i++) {
          const a = tube[i - 1]!
          const b = tube[i]!
          const dx = b.x - a.x
          const dy = b.y - a.y
          const len2 = dx * dx + dy * dy || 1
          let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
          t = Math.max(0, Math.min(1, t))
          nearest = Math.min(
            nearest,
            Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)),
          )
        }
        maxClear = Math.max(maxClear, nearest)
      }
      expect(maxClear).toBeLessThan(46)
    }
  })

  it('keeps plain wire bend counts low after hard connector moves', () => {
    const arranged = autoArrangeConnectors(SAMPLE_CONNECTORS, SAMPLE_WIRES)
    const hard = arranged.map((c) => {
      const m: Record<string, [number, number]> = {
        J1: [90, 140],
        J2: [60, 280],
        J3: [-50, -110],
      }
      const n = m[c.connector_id]
      if (!n) return c
      return {
        ...c,
        position_x: (c.position_x ?? 0) + n[0],
        position_y: (c.position_y ?? 0) + n[1],
      }
    })
    const scene = computeScene(hard, SAMPLE_WIRES, sceneOptions)
    const twistIds = new Set(
      SAMPLE_WIRES.filter((w) => w.twist_group).map((w) => w.wire_id),
    )
    for (const wire of scene.wires) {
      if (twistIds.has(wire.id)) continue
      expect(bendCount(wire.points)).toBeLessThanOrEqual(2)
    }
    // Shield outline should track the trunk — not explode with extra corners.
    for (const shield of scene.shields) {
      expect(bendCount(shield.outline)).toBeLessThanOrEqual(
        bendCount(shield.points) * 2 + 4,
      )
      expect(shield.outline.length).toBeLessThanOrEqual(16)
    }
  })

  it('writes a PDF whose xref offsets point at their objects', () => {
    const scene = computeScene(SAMPLE_CONNECTORS, SAMPLE_WIRES, sceneOptions)
    const doc = layoutExportDocument(scene, SAMPLE_CONNECTORS, SAMPLE_WIRES)
    const pdf = sceneToPdf(scene, LIGHT_THEME, doc)
    const text = new TextDecoder('latin1').decode(pdf)
    expect(text).toContain('/ExtGState')
    expect(text).toContain('/ca 0.45')
    const start = Number(/startxref\s+(\d+)/.exec(text)![1])
    const entries = text.slice(start).split('\n')
    let objNum = 0
    for (const line of entries) {
      const m = /^(\d{10}) \d{5} (n|f)/.exec(line)
      if (!m) continue
      if (m[2] === 'n') {
        const offset = Number(m[1])
        expect(text.slice(offset)).toContain(`${objNum} 0 obj`)
        expect(text.slice(offset, offset + 12).startsWith(`${objNum} 0 obj`)).toBe(true)
      }
      objNum++
    }
  })

  it('routes wires around a connector that blocks the direct path', () => {
    const connectors = [
      { connector_id: 'A', connector_name: 'A', pin_count: 2, position_x: 0, position_y: 100 },
      { connector_id: 'C', connector_name: 'C', pin_count: 8, position_x: 300, position_y: 60 },
      { connector_id: 'B', connector_name: 'B', pin_count: 2, position_x: 700, position_y: 100 },
    ]
    const wires = [
      {
        wire_id: 'W1',
        from_connector: 'A',
        from_pin: '1',
        to_connector: 'B',
        to_pin: '1',
        wire_color: 'red',
        gauge: '22 AWG',
      },
    ]
    const scene = computeScene(connectors, wires, sceneOptions)
    const blocker = scene.connectors.find((c) => c.id === 'C')!
    const box = {
      x: blocker.x,
      y: blocker.y,
      width: blocker.width,
      height: blocker.height,
    }
    const wire = scene.wires.find((w) => w.id === 'W1')!
    const hits = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const m = 2
      return (
        Math.max(a.x, b.x) > box.x - m &&
        Math.min(a.x, b.x) < box.x + box.width + m &&
        Math.max(a.y, b.y) > box.y - m &&
        Math.min(a.y, b.y) < box.y + box.height + m
      )
    }
    for (let i = 1; i < wire.points.length; i++) {
      expect(hits(wire.points[i - 1]!, wire.points[i]!)).toBe(false)
    }
  })

  it('lays out extra alphanumeric pins and draws unrouted wires as error stubs', () => {
    const connectors = [
      { connector_id: 'A', connector_name: 'A', pin_count: 1 },
      { connector_id: 'B', connector_name: 'B', pin_count: 1 },
    ]
    const wires = [
      {
        wire_id: 'WA',
        from_connector: 'A',
        from_pin: 'SH',
        to_connector: 'B',
        to_pin: '1',
        wire_color: 'drain',
        gauge: '22 AWG',
      },
      {
        wire_id: 'WB',
        from_connector: 'A',
        from_pin: '9',
        to_connector: 'MISSING',
        to_pin: '1',
        wire_color: 'red',
        gauge: '22 AWG',
      },
    ]
    const layout = computeLayout(connectors, wires)
    expect(layout.byId.get('A')?.pins.map((pin) => pin.pin)).toEqual(['1', 'SH'])
    const scene = computeScene(connectors, wires, {
      ...sceneOptions,
      errorWireIds: new Set(['WB']),
    })
    expect(scene.wires).toHaveLength(2)
    const stub = scene.wires.find((wire) => wire.id === 'WB')
    expect(stub?.dashed).toBe(true)
    expect(stub?.error).toBe(true)
    expect(stub?.label).toContain('ERROR')
  })
})
