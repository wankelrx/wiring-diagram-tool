import { describe, expect, it } from 'vitest'
import { autoArrangeConnectors } from '../autoArrange'
import { SAMPLE_CONNECTORS, SAMPLE_WIRES } from '../sampleData'
import { computeLayout } from './layout'
import { bendCount, type Point } from './paths'
import { computeScene } from './scene'

const OPTIONS = {
  showLabels: true,
  showCableIds: true,
  duplicatePins: new Set<string>(),
  duplicateWireIds: new Set<string>(),
  errorWireIds: new Set<string>(),
}

/** Deterministic LCG so failures are reproducible. */
function rng(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

type Seg = { a: Point; b: Point }

function segments(points: Point[]): Seg[] {
  const out: Seg[] = []
  for (let i = 1; i < points.length; i++) {
    out.push({ a: points[i - 1]!, b: points[i]! })
  }
  return out
}

const isVertical = (s: Seg) => Math.abs(s.a.x - s.b.x) < 0.75
const isHorizontal = (s: Seg) => Math.abs(s.a.y - s.b.y) < 0.75

function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return (
    Math.min(Math.max(a0, a1), Math.max(b0, b1)) -
    Math.max(Math.min(a0, a1), Math.min(b0, b1))
  )
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** True when `p` is inside the closed polygon and at least `margin` from its edge. */
function insideWithMargin(poly: Point[], p: Point, margin: number): boolean {
  let inside = false
  let nearest = Infinity
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!
    const b = poly[i]!
    nearest = Math.min(nearest, distToSegment(p, a, b))
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside && nearest >= margin
}

describe('routing under random connector moves', () => {
  it('never stacks wires, bends excessively, or draws diagonal shields', () => {
    const arranged = autoArrangeConnectors(SAMPLE_CONNECTORS, SAMPLE_WIRES)
    const twisted = new Set(
      SAMPLE_WIRES.filter((w) => w.twist_group).map((w) => w.wire_id),
    )
    const wireById = new Map(SAMPLE_WIRES.map((w) => [w.wire_id, w]))
    const rand = rng(12345)
    const problems: string[] = []

    for (let trial = 0; trial < 200; trial++) {
      const moved = arranged.map((c) => ({
        ...c,
        position_x: (c.position_x ?? 0) + (rand() - 0.5) * 500,
        position_y: (c.position_y ?? 0) + (rand() - 0.5) * 500,
      }))
      const layout = computeLayout(moved, SAMPLE_WIRES)
      const scene = computeScene(moved, SAMPLE_WIRES, OPTIONS)
      const plain = scene.wires.filter((w) => !twisted.has(w.id))

      for (const wire of plain) {
        if (bendCount(wire.points) > 2) {
          problems.push(`#${trial} ${wire.id} has ${bendCount(wire.points)} bends`)
        }
      }

      for (let i = 0; i < plain.length; i++) {
        for (let j = i + 1; j < plain.length; j++) {
          const a = plain[i]!
          const b = plain[j]!
          if (a.bundleId !== b.bundleId) continue
          for (const sa of segments(a.points)) {
            for (const sb of segments(b.points)) {
              if (
                isVertical(sa) &&
                isVertical(sb) &&
                Math.abs(sa.a.x - sb.a.x) < 3 &&
                overlap1d(sa.a.y, sa.b.y, sb.a.y, sb.b.y) > 12
              ) {
                problems.push(`#${trial} ${a.id}/${b.id} share a vertical`)
              }
              if (
                isHorizontal(sa) &&
                isHorizontal(sb) &&
                Math.abs(sa.a.y - sb.a.y) < 3 &&
                overlap1d(sa.a.x, sa.b.x, sb.a.x, sb.b.x) > 30
              ) {
                problems.push(`#${trial} ${a.id}/${b.id} share a horizontal`)
              }
            }
          }
        }
      }

      for (const shield of scene.shields) {
        for (const s of segments(shield.outline)) {
          if (!isVertical(s) && !isHorizontal(s)) {
            problems.push(`#${trial} shield ${shield.id} has a diagonal`)
          }
        }
      }

      for (const pair of scene.shields.filter((s) => s.kind === 'pair')) {
        const [bundleId, shieldName] = pair.id.split('::')
        const memberIds = new Set(
          SAMPLE_WIRES.filter((w) => w.shield_group?.trim() === shieldName).map(
            (w) => w.wire_id,
          ),
        )
        const [t0, t1] = [pair.points[0]!, pair.points[pair.points.length - 1]!]
        const along = (p: Point) =>
          Math.abs(t1.x - t0.x) >= Math.abs(t1.y - t0.y) ? p.x : p.y
        const lo = Math.min(along(t0), along(t1))
        const hi = Math.max(along(t0), along(t1))
        for (const wire of scene.wires.filter(
          (w) => memberIds.has(w.id) && w.bundleId === bundleId,
        )) {
          for (const p of wire.points) {
            if (along(p) < lo + 1 || along(p) > hi - 1) continue
            if (pair.points.length > 2) continue
            if (!insideWithMargin(pair.outline, p, 1)) {
              problems.push(`#${trial} ${wire.id} escapes pair shield ${pair.id}`)
              break
            }
          }
        }
      }

      for (const overall of scene.shields.filter((s) => s.kind === 'overall')) {
        const [bundleId, , overallName] = overall.id.split('::')
        const pairKeys = new Set(
          SAMPLE_WIRES.filter(
            (w) => w.overall_shield?.trim() === overallName && w.shield_group,
          ).map((w) => `${bundleId}::${w.shield_group!.trim()}`),
        )
        const memberIds = new Set(
          SAMPLE_WIRES.filter(
            (w) => w.overall_shield?.trim() === overallName,
          ).map((w) => w.wire_id),
        )
        for (const wire of scene.wires.filter(
          (w) => memberIds.has(w.id) && w.bundleId === bundleId,
        )) {
          const first = wire.points[0]!
          const last = wire.points[wire.points.length - 1]!
          for (const p of wire.points) {
            const nearPin =
              Math.hypot(p.x - first.x, p.y - first.y) < 18 ||
              Math.hypot(p.x - last.x, p.y - last.y) < 18
            if (nearPin) continue
            if (!insideWithMargin(overall.outline, p, 1)) {
              problems.push(`#${trial} ${wire.id} escapes overall shield ${overall.id}`)
              break
            }
          }
        }
        for (const pair of scene.shields.filter((s) => pairKeys.has(s.id))) {
          for (const p of pair.outline) {
            if (!insideWithMargin(overall.outline, p, 2)) {
              problems.push(
                `#${trial} ${pair.id} escapes overall shield ${overall.id}`,
              )
              break
            }
          }
        }
      }

      for (const wire of scene.wires) {
        const def = wireById.get(wire.id)!
        for (const [id, box] of layout.byId) {
          if (id === def.from_connector || id === def.to_connector) continue
          const hit = segments(wire.points).some((s) => {
            const x0 = Math.min(s.a.x, s.b.x)
            const x1 = Math.max(s.a.x, s.b.x)
            const y0 = Math.min(s.a.y, s.b.y)
            const y1 = Math.max(s.a.y, s.b.y)
            return (
              x1 > box.x &&
              x0 < box.x + box.width &&
              y1 > box.y &&
              y0 < box.y + box.height
            )
          })
          if (hit) problems.push(`#${trial} ${wire.id} crosses connector ${id}`)
        }
      }
    }

    expect(problems.slice(0, 10)).toEqual([])
  })
})
