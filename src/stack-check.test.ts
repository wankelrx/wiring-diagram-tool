import { describe, expect, it } from 'vitest'
import { autoArrangeConnectors } from './autoArrange'
import { SAMPLE_CONNECTORS, SAMPLE_WIRES } from './sampleData'
import { computeScene } from './diagram/scene'
import type { Point } from './diagram/paths'
import type { Connector } from './types'

const opts = {
  showLabels: true,
  showCableIds: true,
  duplicatePins: new Set<string>(),
  duplicateWireIds: new Set<string>(),
  errorWireIds: new Set<string>(),
}

function horizSegments(points: Point[]) {
  const segs: Array<{ y: number; x0: number; x1: number; len: number }> = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    if (Math.abs(a.y - b.y) > 0.75) continue
    const len = Math.abs(b.x - a.x)
    // Ignore short stubs at the connector face — mid-run stacking is the bug.
    if (len < 60) continue
    segs.push({
      y: (a.y + b.y) / 2,
      x0: Math.min(a.x, b.x),
      x1: Math.max(a.x, b.x),
      len,
    })
  }
  return segs
}

function findStacks(connectors: Connector[], minGap = 12) {
  const scene = computeScene(connectors, SAMPLE_WIRES, opts)
  const stacks: string[] = []
  for (let i = 0; i < scene.wires.length; i++) {
    for (let j = i + 1; j < scene.wires.length; j++) {
      const a = scene.wires[i]!
      const b = scene.wires[j]!
      if (a.bundleId !== b.bundleId) continue
      for (const sa of horizSegments(a.points)) {
        for (const sb of horizSegments(b.points)) {
          const overlap =
            Math.min(sa.x1, sb.x1) - Math.max(sa.x0, sb.x0)
          if (overlap < 30) continue
          const gap = Math.abs(sa.y - sb.y)
          if (gap < minGap) {
            stacks.push(
              `${a.id}/${b.id} gap=${gap.toFixed(1)} y=${sa.y.toFixed(0)}/${sb.y.toFixed(0)} overlap=${overlap.toFixed(0)}`,
            )
          }
        }
      }
      // Long vertical corridor overlap — include face jogs (≥36) so stacked
      // stub channels are caught, not only deep mid-run drops.
      for (let ai = 1; ai < a.points.length; ai++) {
        const p0 = a.points[ai - 1]!
        const p1 = a.points[ai]!
        if (Math.abs(p0.x - p1.x) > 0.75 || Math.abs(p1.y - p0.y) < 36) continue
        for (let bi = 1; bi < b.points.length; bi++) {
          const q0 = b.points[bi - 1]!
          const q1 = b.points[bi]!
          if (Math.abs(q0.x - q1.x) > 0.75 || Math.abs(q1.y - q0.y) < 36) continue
          if (Math.abs(p0.x - q0.x) >= 12) continue
          const yOverlap =
            Math.min(Math.max(p0.y, p1.y), Math.max(q0.y, q1.y)) -
            Math.max(Math.min(p0.y, p1.y), Math.min(q0.y, q1.y))
          if (yOverlap > 24) {
            stacks.push(
              `${a.id}/${b.id} vertical-x=${p0.x.toFixed(0)} yOverlap=${yOverlap.toFixed(0)}`,
            )
          }
        }
      }
    }
  }
  return stacks
}

function nudge(
  base: Connector[],
  moves: Record<string, [number, number]>,
): Connector[] {
  return base.map((c) => {
    const m = moves[c.connector_id]
    if (!m) return c
    return {
      ...c,
      position_x: (c.position_x ?? 0) + m[0],
      position_y: (c.position_y ?? 0) + m[1],
    }
  })
}

describe('horizontal Y spacing under hard nudges', () => {
  const arranged = autoArrangeConnectors(SAMPLE_CONNECTORS, SAMPLE_WIRES)

  it('arranged baseline keeps spaced mid-runs', () => {
    const stacks = findStacks(arranged)
    expect(stacks).toEqual([])
  })

  it('large vertical offset keeps spaced mid-runs', () => {
    const hard = nudge(arranged, {
      J1: [90, 140],
      J2: [60, 280],
      J3: [-50, -110],
    })
    const stacks = findStacks(hard)
    if (stacks.length) console.log('STACKS', stacks)
    expect(stacks).toEqual([])
  })

  it('overlapping columns keep spaced mid-runs', () => {
    const hard = nudge(arranged, {
      J1: [0, 40],
      J2: [-180, 260],
      J3: [220, -120],
    })
    const stacks = findStacks(hard)
    if (stacks.length) console.log('STACKS', stacks)
    expect(stacks).toEqual([])
  })
})
