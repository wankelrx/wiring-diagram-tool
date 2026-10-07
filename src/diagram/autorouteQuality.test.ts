import { describe, expect, it } from 'vitest'
import { autoArrangeConnectors } from '../autoArrange'
import { SAMPLE_CONNECTORS, SAMPLE_WIRES } from '../sampleData'
import { bendCount, countPolylineCrossings, pickBundleCorridorX, routeAlongCorridor } from './paths'
import { computeScene } from './scene'
import type { Connector } from '../types'

const sceneOptions = {
  showLabels: true,
  showCableIds: true,
  duplicatePins: new Set<string>(),
  duplicateWireIds: new Set<string>(),
  errorWireIds: new Set<string>(),
}

function plainWires(scene: ReturnType<typeof computeScene>) {
  const twistIds = new Set(
    SAMPLE_WIRES.filter((w) => w.twist_group).map((w) => w.wire_id),
  )
  return scene.wires.filter((w) => !twistIds.has(w.id))
}

function quality(scene: ReturnType<typeof computeScene>) {
  const plain = plainWires(scene)
  let crossings = 0
  for (let i = 0; i < plain.length; i++) {
    for (let j = i + 1; j < plain.length; j++) {
      // Only score crossings inside the same cable — bundles that meet at a
      // hub are expected to fan out.
      if (plain[i]!.bundleId !== plain[j]!.bundleId) continue
      crossings += countPolylineCrossings(plain[i]!.points, plain[j]!.points)
    }
  }
  const bends = plain.reduce((sum, w) => sum + bendCount(w.points), 0)
  const cab = scene.wires.filter((w) =>
    ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'].includes(w.id),
  )
  const ys = cab.flatMap((w) => w.points.map((p) => p.y))
  const span = Math.max(...ys) - Math.min(...ys)
  const midXs = plain
    .filter((w) => w.bundleId.includes('J1') && w.bundleId.includes('J2'))
    .map((w) => {
      const xs = w.points.map((p) => p.x)
      return (Math.min(...xs) + Math.max(...xs)) / 2
    })
  const midSpread =
    midXs.length > 1 ? Math.max(...midXs) - Math.min(...midXs) : 0
  return { crossings, bends, span, midSpread }
}

describe('professional autoroute quality', () => {
  it('routes along a shared corridor for opposite-facing pins', () => {
    const pts = routeAlongCorridor(0, 20, 1, 200, 60, -1, 100)
    expect(pts[0]).toEqual({ x: 0, y: 20 })
    expect(pts[pts.length - 1]).toEqual({ x: 200, y: 60 })
    const vertical = pts.filter(
      (p, i, a) => i > 0 && Math.abs(p.x - a[i - 1]!.x) < 0.5,
    )
    expect(vertical.length).toBeGreaterThan(0)
    expect(pickBundleCorridorX([
      { from: { x: 0, y: 10, dir: 1 }, to: { x: 200, y: 10, dir: -1 } },
      { from: { x: 0, y: 30, dir: 1 }, to: { x: 200, y: 30, dir: -1 } },
    ])).toBeCloseTo(100, 0)
  })

  it('keeps sample J1–J2 routing compact with few plain crossings', () => {
    const scene = computeScene(SAMPLE_CONNECTORS, SAMPLE_WIRES, sceneOptions)
    const q = quality(scene)
    expect(q.span).toBeLessThan(160)
    expect(q.crossings).toBeLessThanOrEqual(2)
    expect(q.bends).toBeLessThan(18)
    expect(q.midSpread).toBeLessThan(80)
  })

  it('stays clean after Arrange and small connector moves', () => {
    const arranged = autoArrangeConnectors(SAMPLE_CONNECTORS, SAMPLE_WIRES)
    // Opposite-side arrange should keep sensor runs nearly flat.
    const arrangedScene = computeScene(arranged, SAMPLE_WIRES, sceneOptions)
    const sensor = arrangedScene.wires.filter((w) =>
      ['W8', 'W9', 'W10'].includes(w.id),
    )
    const sensorYs = sensor.flatMap((w) => w.points.map((p) => p.y))
    expect(Math.max(...sensorYs) - Math.min(...sensorYs)).toBeLessThan(80)

    const moves: Connector[][] = [
      arranged,
      arranged.map((c) =>
        c.connector_id === 'J1'
          ? { ...c, position_x: (c.position_x ?? 0) + 40, position_y: (c.position_y ?? 0) + 28 }
          : c,
      ),
      arranged.map((c) =>
        c.connector_id === 'J3'
          ? { ...c, position_x: (c.position_x ?? 0) - 60, position_y: (c.position_y ?? 0) - 40 }
          : c,
      ),
      arranged.map((c) =>
        c.connector_id === 'J2'
          ? { ...c, position_x: (c.position_x ?? 0) + 20, position_y: (c.position_y ?? 0) + 50 }
          : c,
      ),
      // Sequential nudge of each connector from arranged baseline.
      arranged.map((c) =>
        c.connector_id === 'J1'
          ? { ...c, position_x: (c.position_x ?? 0) - 32, position_y: (c.position_y ?? 0) + 48 }
          : c.connector_id === 'J2'
            ? { ...c, position_x: (c.position_x ?? 0) + 48, position_y: (c.position_y ?? 0) - 24 }
            : c.connector_id === 'J3'
              ? { ...c, position_x: (c.position_x ?? 0) - 48, position_y: (c.position_y ?? 0) + 32 }
              : c,
      ),
    ]
    for (const connectors of moves) {
      const scene = computeScene(connectors, SAMPLE_WIRES, sceneOptions)
      const q = quality(scene)
      expect(q.span).toBeLessThan(280)
      expect(q.crossings).toBeLessThanOrEqual(6)
      for (const wire of plainWires(scene)) {
        for (let i = 1; i < wire.points.length; i++) {
          const a = wire.points[i - 1]!
          const b = wire.points[i]!
          const dx = Math.abs(a.x - b.x)
          const dy = Math.abs(a.y - b.y)
          expect(dx < 0.5 || dy < 0.5).toBe(true)
        }
      }
    }
  })
})
