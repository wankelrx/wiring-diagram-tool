import { describe, expect, it } from 'vitest'
import {
  braidAlongCenterline,
  countPolylineCrossings,
  orthogonalRoute,
  parallelManhattanOutline,
  polylinePath,
  rectUnionOutline,
  routeScore,
  sharedTrunk,
} from './paths'

describe('paths', () => {
  it('serializes polylines', () => {
    expect(polylinePath([])).toBe('')
    expect(polylinePath([{ x: 1, y: 2 }])).toBe('M 1.00 2.00')
  })

  it('braids twisted conductors around a shared centerline', () => {
    const center = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    const [a, b] = braidAlongCenterline(center, 2, 8)
    expect(a?.length).toBeGreaterThan(10)
    expect(b?.length).toBe(a?.length)
    let maxSep = 0
    for (let i = 0; i < (a?.length ?? 0); i++) {
      const pa = a![i]!
      const pb = b![i]!
      maxSep = Math.max(maxSep, Math.abs(pa.y - pb.y))
      expect((pa.y + pb.y) / 2).toBeCloseTo(0, 5)
    }
    expect(maxSep).toBeGreaterThan(8)
  })

  it('routes orthogonal wires from pin to pin', () => {
    const pts = orthogonalRoute(0, 10, 1, 200, 40, -1, 0)
    expect(pts[0]).toEqual({ x: 0, y: 10 })
    expect(pts[pts.length - 1]).toEqual({ x: 200, y: 40 })
  })

  it('keeps signed lane offsets for same-direction exits', () => {
    const left = orthogonalRoute(0, 10, 1, 0, 40, 1, -1)
    const right = orthogonalRoute(0, 10, 1, 0, 40, 1, 1)
    const leftX = left[2]?.x ?? 0
    const rightX = right[2]?.x ?? 0
    expect(rightX).toBeGreaterThan(leftX)
  })

  it('counts proper H×V crossings between polylines', () => {
    const a = [
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ]
    const b = [
      { x: 50, y: 0 },
      { x: 50, y: 100 },
    ]
    expect(countPolylineCrossings(a, b)).toBe(1)
    expect(countPolylineCrossings(a, a)).toBe(0)
  })

  it('prefers a clear mid channel over one that hits a box', () => {
    const obstacles = [{ x: 80, y: 0, width: 40, height: 120 }]
    const clear = orthogonalRoute(0, 20, 1, 200, 100, -1, 0, 20, obstacles)
    const blockedScore = routeScore(
      [
        { x: 0, y: 20 },
        { x: 32, y: 20 },
        { x: 100, y: 20 },
        { x: 100, y: 100 },
        { x: 168, y: 100 },
        { x: 200, y: 100 },
      ],
      obstacles,
      [],
    )
    const clearScore = routeScore(clear, obstacles, [])
    expect(clearScore).toBeLessThan(blockedScore)
  })

  it('sharedTrunk detours when the mid channel is blocked', () => {
    const obstacles = [{ x: 90, y: 0, width: 40, height: 200 }]
    const trunk = sharedTrunk(
      [{ x: 40, y: 40 }],
      [{ x: 200, y: 160 }],
      0,
      20,
      obstacles,
    )
    const hits = obstacles.some((box) =>
      trunk.some((p, i) => {
        if (i === 0) return false
        const a = trunk[i - 1]!
        const b = p
        const xOverlap =
          Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width
        const yOverlap =
          Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
        return xOverlap && yOverlap
      }),
    )
    expect(hits).toBe(false)
  })

  it('parallelManhattanOutline stays axis-aligned around an L trunk', () => {
    const outline = parallelManhattanOutline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 80 },
        { x: 200, y: 80 },
      ],
      12,
    )
    expect(outline.length).toBeGreaterThan(4)
    for (let i = 1; i < outline.length; i++) {
      const a = outline[i - 1]!
      const b = outline[i]!
      const ortho = Math.abs(a.x - b.x) < 0.75 || Math.abs(a.y - b.y) < 0.75
      expect(ortho).toBe(true)
    }
    // Ribbon follows the trunk — roughly 2× corners, not a dense hull.
    expect(outline.length).toBeLessThanOrEqual(12)
  })

  it('rectUnionOutline wraps a Z trunk even when legs are shorter than the half-width', () => {
    const trunk = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 90 },
      { x: 120, y: 90 },
    ]
    const outline = rectUnionOutline(trunk, 40)
    expect(outline.length).toBeGreaterThan(4)
    expect(outline[0]).toEqual(outline[outline.length - 1])
    for (let i = 1; i < outline.length; i++) {
      const a = outline[i - 1]!
      const b = outline[i]!
      expect(Math.abs(a.x - b.x) < 0.75 || Math.abs(a.y - b.y) < 0.75).toBe(true)
    }
    const xs = outline.map((p) => p.x)
    const ys = outline.map((p) => p.y)
    expect(Math.min(...xs)).toBeCloseTo(-40)
    expect(Math.max(...xs)).toBeCloseTo(160)
    expect(Math.min(...ys)).toBeCloseTo(-40)
    expect(Math.max(...ys)).toBeCloseTo(130)
    // Nothing on the trunk sits closer than the half-width to an outline edge.
    for (const p of trunk) {
      let nearest = Infinity
      for (let i = 1; i < outline.length; i++) {
        const a = outline[i - 1]!
        const b = outline[i]!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const t = Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
        )
        nearest = Math.min(
          nearest,
          Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)),
        )
      }
      expect(nearest).toBeGreaterThanOrEqual(39.9)
    }
  })
})
