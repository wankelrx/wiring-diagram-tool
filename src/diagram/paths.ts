export type Point = { x: number; y: number }
export type Box = { x: number; y: number; width: number; height: number }

export type RouteChannels = {
  vertical: number[]
  horizontal: number[]
}

export function normalize(p: Point): Point {
  const len = Math.hypot(p.x, p.y) || 1
  return { x: p.x / len, y: p.y / len }
}

export function normalOf(tangent: Point): Point {
  const n = normalize(tangent)
  return { x: -n.y, y: n.x }
}

export function polylinePath(pts: Point[]): string {
  if (pts.length === 0) return ''
  return pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ')
}

export function bundleKey(a: string, b: string): string {
  return a < b ? `${a}--${b}` : `${b}--${a}`
}

export function dedupePoints(pts: Point[]): Point[] {
  const out: Point[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.05) continue
    out.push(p)
  }
  return out
}

export function polylineLength(pts: Point[]): number {
  let length = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    length += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return length
}

export function bendCount(pts: Point[]): number {
  if (pts.length < 3) return 0
  let bends = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    const c = pts[i + 1]!
    const dx1 = b.x - a.x
    const dy1 = b.y - a.y
    const dx2 = c.x - b.x
    const dy2 = c.y - b.y
    if (Math.abs(dx1 * dy2 - dy1 * dx2) > 1e-6) bends += 1
  }
  return bends
}

/** Axis-aligned (horizontal or vertical) segment vs. box overlap test. */
export function segmentHitsBox(
  a: Point,
  b: Point,
  box: Box,
  margin: number,
): boolean {
  const bx0 = box.x - margin
  const bx1 = box.x + box.width + margin
  const by0 = box.y - margin
  const by1 = box.y + box.height + margin
  const segMinX = Math.min(a.x, b.x)
  const segMaxX = Math.max(a.x, b.x)
  const segMinY = Math.min(a.y, b.y)
  const segMaxY = Math.max(a.y, b.y)
  return segMaxX > bx0 && segMinX < bx1 && segMaxY > by0 && segMinY < by1
}

/** True if any segment of the polyline passes through an obstacle box. */
export function routeClear(
  pts: Point[],
  obstacles: Box[],
  margin = 6,
): boolean {
  for (let i = 1; i < pts.length; i++) {
    for (const box of obstacles) {
      if (segmentHitsBox(pts[i - 1]!, pts[i]!, box, margin)) return false
    }
  }
  return true
}

export function countBoxHits(
  pts: Point[],
  obstacles: Box[],
  margin = 6,
): number {
  let hits = 0
  for (let i = 1; i < pts.length; i++) {
    for (const box of obstacles) {
      if (segmentHitsBox(pts[i - 1]!, pts[i]!, box, margin)) hits += 1
    }
  }
  return hits
}

/**
 * Count proper crossings between two polylines (any orientation).
 * Shared endpoints / near-touching T-junctions are ignored.
 */
export function countPolylineCrossings(a: Point[], b: Point[]): number {
  let count = 0
  for (let i = 1; i < a.length; i++) {
    const a0 = a[i - 1]!
    const a1 = a[i]!
    for (let j = 1; j < b.length; j++) {
      if (segmentsCross(a0, a1, b[j - 1]!, b[j]!)) count += 1
    }
  }
  return count
}

function segmentsCross(
  a0: Point,
  a1: Point,
  b0: Point,
  b1: Point,
): boolean {
  const ax = a1.x - a0.x
  const ay = a1.y - a0.y
  const bx = b1.x - b0.x
  const by = b1.y - b0.y
  const den = ax * by - ay * bx
  if (Math.abs(den) < 1e-9) return false
  const dx = b0.x - a0.x
  const dy = b0.y - a0.y
  const t = (dx * by - dy * bx) / den
  const u = (dx * ay - dy * ax) / den
  // Strict interior intersection — ignore endpoint touches.
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98
}

export function countCrossingsAgainst(
  pts: Point[],
  others: Point[][],
): number {
  let total = 0
  for (const other of others) total += countPolylineCrossings(pts, other)
  return total
}

/** Route quality: lower is better. */
export function routeScore(
  pts: Point[],
  obstacles: Box[],
  priorRoutes: Point[][],
  reserved?: RouteChannels,
  preferredMidX?: number,
): number {
  const length = polylineLength(pts)
  const boxHits = countBoxHits(pts, obstacles)
  const crossings = countCrossingsAgainst(pts, priorRoutes)
  const bends = bendCount(pts)
  let channelPenalty = 0
  if (reserved) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!
      const b = pts[i]!
      if (Math.abs(a.x - b.x) < 0.5) {
        const x = Math.round(a.x)
        if (reserved.vertical.some((v) => Math.abs(v - x) < 8)) {
          channelPenalty += 120
        }
      } else if (Math.abs(a.y - b.y) < 0.5) {
        const y = Math.round(a.y)
        if (reserved.horizontal.some((h) => Math.abs(h - y) < 8)) {
          channelPenalty += 120
        }
      }
    }
  }
  let lanePenalty = 0
  if (preferredMidX !== undefined) {
    // Prefer the vertical channel nearest the assigned lane so parallel
    // conductors in a bundle don't all collapse onto one mid-X.
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!
      const b = pts[i]!
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 16) {
        lanePenalty += Math.abs(a.x - preferredMidX) * 3
      }
    }
  }
  return (
    length +
    200 * boxHits +
    160 * crossings +
    10 * bends +
    channelPenalty +
    lanePenalty
  )
}

const CHANNEL_BAND_STEP = 8

export function reserveRouteChannels(
  pts: Point[],
  channels: RouteChannels,
  band = 0,
): void {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 16) {
      const x = Math.round(a.x)
      channels.vertical.push(x)
      for (let d = CHANNEL_BAND_STEP; d <= band; d += CHANNEL_BAND_STEP) {
        channels.vertical.push(x - d, x + d)
      }
    } else if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 16) {
      const y = Math.round(a.y)
      channels.horizontal.push(y)
      for (let d = CHANNEL_BAND_STEP; d <= band; d += CHANNEL_BAND_STEP) {
        channels.horizontal.push(y - d, y + d)
      }
    }
  }
}

/** True if a vertical line at `x` spanning [yTop,yBottom] hits any box. */
function verticalBlocked(
  x: number,
  yTop: number,
  yBottom: number,
  obstacles: Box[],
  margin = 10,
): boolean {
  return obstacles.some(
    (b) =>
      x > b.x - margin &&
      x < b.x + b.width + margin &&
      yBottom > b.y - margin &&
      yTop < b.y + b.height + margin,
  )
}

/** Nearest y to `preferred` where a horizontal run [xLo,xHi] clears obstacles. */
function clearHorizontalY(
  preferred: number,
  xLo: number,
  xHi: number,
  obstacles: Box[],
): number {
  const blocked = (y: number) =>
    obstacles.some(
      (b) =>
        y > b.y - 12 &&
        y < b.y + b.height + 12 &&
        xHi > b.x - 6 &&
        xLo < b.x + b.width + 6,
    )
  if (!blocked(preferred)) return preferred
  for (let step = 12; step <= 4000; step += 12) {
    if (!blocked(preferred - step)) return preferred - step
    if (!blocked(preferred + step)) return preferred + step
  }
  return preferred
}

/** Nearest x to `preferred` within [lo,hi] whose vertical run clears obstacles. */
export function clearChannelX(
  preferred: number,
  lo: number,
  hi: number,
  yTop: number,
  yBottom: number,
  obstacles: Box[],
): number {
  const clamp = (v: number) => Math.min(hi, Math.max(lo, v))
  const start = clamp(preferred)
  if (lo > hi) return preferred
  if (!verticalBlocked(start, yTop, yBottom, obstacles)) return start
  const range = Math.max(hi - lo, 0)
  for (let step = 6; step <= Math.max(range, 240); step += 6) {
    const left = start - step
    const right = start + step
    if (left >= lo && !verticalBlocked(left, yTop, yBottom, obstacles)) {
      return left
    }
    if (right <= hi && !verticalBlocked(right, yTop, yBottom, obstacles)) {
      return right
    }
  }
  return start
}

function pickBestRoute(
  candidates: Point[][],
  obstacles: Box[],
  priorRoutes: Point[][],
  reserved?: RouteChannels,
  preferredMidX?: number,
): Point[] {
  const usable = candidates.filter((c) => c.length >= 2)
  if (!usable.length) return []
  const clear = usable.filter((c) => routeClear(c, obstacles))
  const pool = clear.length ? clear : usable
  let best = pool[0]!
  let bestScore = Infinity
  for (const candidate of pool) {
    const score = routeScore(
      candidate,
      obstacles,
      priorRoutes,
      reserved,
      preferredMidX,
    )
    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

function manhattanViaMidX(
  x1: number,
  y1: number,
  s1x: number,
  x2: number,
  y2: number,
  s2x: number,
  midX: number,
): Point[] {
  return dedupePoints([
    { x: x1, y: y1 },
    { x: s1x, y: y1 },
    { x: midX, y: y1 },
    { x: midX, y: y2 },
    { x: s2x, y: y2 },
    { x: x2, y: y2 },
  ])
}

function manhattanViaDetourY(
  x1: number,
  y1: number,
  s1x: number,
  x2: number,
  y2: number,
  s2x: number,
  detourY: number,
): Point[] {
  return dedupePoints([
    { x: x1, y: y1 },
    { x: s1x, y: y1 },
    { x: s1x, y: detourY },
    { x: s2x, y: detourY },
    { x: s2x, y: y2 },
    { x: x2, y: y2 },
  ])
}

function manhattanSameDir(
  x1: number,
  y1: number,
  s1x: number,
  x2: number,
  y2: number,
  s2x: number,
  outward: number,
): Point[] {
  return dedupePoints([
    { x: x1, y: y1 },
    { x: s1x, y: y1 },
    { x: outward, y: y1 },
    { x: outward, y: y2 },
    { x: s2x, y: y2 },
    { x: x2, y: y2 },
  ])
}

export function orthogonalRoute(
  x1: number,
  y1: number,
  dir1: number,
  x2: number,
  y2: number,
  dir2: number,
  lane = 0,
  lanePitch = 20,
  obstacles: Box[] = [],
  exclude: Box[] = [],
  priorRoutes: Point[][] = [],
  reserved?: RouteChannels,
): Point[] {
  const stub = 32
  const s1x = x1 + dir1 * stub
  const s2x = x2 + dir2 * stub
  const laneShift = lane * lanePitch
  const yTop = Math.min(y1, y2)
  const yBottom = Math.max(y1, y2)
  const blockers = obstacles.filter((b) => !exclude.includes(b))
  const candidates: Point[][] = []

  if (dir1 === dir2) {
    const baseOutward =
      dir1 >= 0
        ? Math.max(s1x, s2x) + 36 + laneShift
        : Math.min(s1x, s2x) - 36 - laneShift
    const outwardCandidates = [baseOutward]
    for (let k = 1; k <= 4; k++) {
      outwardCandidates.push(
        baseOutward + (dir1 >= 0 ? 1 : -1) * k * lanePitch,
      )
    }
    if (blockers.length) {
      const cleared = clearChannelX(
        baseOutward,
        dir1 >= 0 ? Math.max(s1x, s2x) + 20 : -1e9,
        dir1 >= 0 ? 1e9 : Math.min(s1x, s2x) - 20,
        yTop,
        yBottom,
        blockers,
      )
      outwardCandidates.push(cleared)
    }
    for (const outward of outwardCandidates) {
      const route = manhattanSameDir(x1, y1, s1x, x2, y2, s2x, outward)
      candidates.push(route)
    }
    // Horizontal detour if vertical channel stays blocked
    const detourBelow = clearHorizontalY(
      yBottom + 40 + Math.abs(laneShift),
      Math.min(s1x, s2x, baseOutward),
      Math.max(s1x, s2x, baseOutward),
      blockers,
    )
    const detourAbove = clearHorizontalY(
      yTop - 40 - Math.abs(laneShift),
      Math.min(s1x, s2x, baseOutward),
      Math.max(s1x, s2x, baseOutward),
      blockers,
    )
    candidates.push(
      manhattanViaDetourY(x1, y1, s1x, x2, y2, s2x, detourBelow),
      manhattanViaDetourY(x1, y1, s1x, x2, y2, s2x, detourAbove),
    )
    return pickBestRoute(
      candidates,
      blockers,
      priorRoutes,
      reserved,
      baseOutward,
    )
  }

  const minX = Math.min(s1x, s2x)
  const maxX = Math.max(s1x, s2x)
  const preferred = (s1x + s2x) / 2 + laneShift
  const midCandidates: number[] = []
  if (maxX - minX > 24) {
    const lo = minX + 10
    const hi = maxX - 10
    const clamped = Math.min(hi, Math.max(lo, preferred))
    midCandidates.push(clamped)
    for (let k = 1; k <= 5; k++) {
      midCandidates.push(clamped - k * lanePitch, clamped + k * lanePitch)
    }
    if (blockers.length) {
      midCandidates.push(clearChannelX(clamped, lo, hi, yTop, yBottom, blockers))
    }
  } else {
    midCandidates.push(preferred)
  }

  for (const midX of midCandidates) {
    candidates.push(manhattanViaMidX(x1, y1, s1x, x2, y2, s2x, midX))
  }

  const detourBelow = clearHorizontalY(
    yBottom + 40 + Math.abs(laneShift),
    Math.min(s1x, s2x),
    Math.max(s1x, s2x),
    blockers,
  )
  const detourAbove = clearHorizontalY(
    yTop - 40 - Math.abs(laneShift),
    Math.min(s1x, s2x),
    Math.max(s1x, s2x),
    blockers,
  )
  candidates.push(
    manhattanViaDetourY(x1, y1, s1x, x2, y2, s2x, detourBelow),
    manhattanViaDetourY(x1, y1, s1x, x2, y2, s2x, detourAbove),
  )

  return pickBestRoute(candidates, blockers, priorRoutes, reserved, preferred)
}

/**
 * Choose one vertical corridor X for an entire connector-pair bundle so all
 * conductors stay parallel instead of each picking its own mid-X.
 */
export function pickBundleCorridorX(
  members: Array<{
    from: { x: number; y: number; dir: number }
    to: { x: number; y: number; dir: number }
  }>,
  obstacles: Box[] = [],
  reserved?: RouteChannels,
  laneShift = 0,
): number {
  if (!members.length) return 0
  const stub = 28
  let sum = 0
  let minStub = Infinity
  let maxStub = -Infinity
  let yTop = Infinity
  let yBottom = -Infinity
  for (const m of members) {
    const s1 = m.from.x + m.from.dir * stub
    const s2 = m.to.x + m.to.dir * stub
    sum += (s1 + s2) / 2
    minStub = Math.min(minStub, s1, s2)
    maxStub = Math.max(maxStub, s1, s2)
    yTop = Math.min(yTop, m.from.y, m.to.y)
    yBottom = Math.max(yBottom, m.from.y, m.to.y)
  }
  const preferred = sum / members.length + laneShift
  if (maxStub - minStub < 24) return preferred
  const lo = minStub + 12
  const hi = maxStub - 12
  let best = Math.min(hi, Math.max(lo, preferred))
  if (obstacles.length) {
    best = clearChannelX(best, lo, hi, yTop, yBottom, obstacles)
  }
  if (reserved?.vertical.length) {
    let nudged = best
    for (let attempt = 0; attempt < 8; attempt++) {
      const hit = reserved.vertical.some((v) => Math.abs(v - nudged) < 10)
      if (!hit) {
        best = nudged
        break
      }
      nudged += attempt % 2 === 0 ? 14 : -14
      nudged = Math.min(hi, Math.max(lo, nudged))
    }
  }
  return best
}

/**
 * Pin-to-pin Manhattan path that uses a vertical corridor X. When pins share
 * a Y, collapses to a clean horizontal run. Pass per-lane corridor X values
 * so long vertical jogs stay spaced instead of stacking.
 */
export function routeAlongCorridor(
  x1: number,
  y1: number,
  dir1: number,
  x2: number,
  y2: number,
  dir2: number,
  corridorX: number,
  stub = 28,
): Point[] {
  const s1x = x1 + dir1 * stub
  const s2x = x2 + dir2 * stub

  if (dir1 === dir2) {
    const outward =
      dir1 >= 0
        ? Math.max(s1x, s2x, corridorX)
        : Math.min(s1x, s2x, corridorX)
    return manhattanSameDir(x1, y1, s1x, x2, y2, s2x, outward)
  }

  // Keep the vertical inside the channel so it never doubles back over a stub.
  const lo = Math.min(s1x, s2x)
  const hi = Math.max(s1x, s2x)
  const cx = Math.min(hi, Math.max(lo, corridorX))

  if (Math.abs(y1 - y2) < 0.75) {
    return dedupePoints([
      { x: x1, y: y1 },
      { x: s1x, y: y1 },
      { x: s2x, y: y2 },
      { x: x2, y: y2 },
    ])
  }

  // Path: pin → stub → corridor → stub → pin. If corridor equals a stub,
  // dedupe collapses the extra corner (still 2 bends max).
  return dedupePoints([
    { x: x1, y: y1 },
    { x: s1x, y: y1 },
    { x: cx, y: y1 },
    { x: cx, y: y2 },
    { x: s2x, y: y2 },
    { x: x2, y: y2 },
  ])
}

export function sharedTrunk(
  starts: Point[],
  ends: Point[],
  lane = 0,
  lanePitch = 20,
  obstacles: Box[] = [],
  priorRoutes: Point[][] = [],
  reserved?: RouteChannels,
  forcedMidX?: number,
): Point[] {
  const s = {
    x: starts.reduce((sum, p) => sum + p.x, 0) / Math.max(starts.length, 1),
    y: starts.reduce((sum, p) => sum + p.y, 0) / Math.max(starts.length, 1),
  }
  const e = {
    x: ends.reduce((sum, p) => sum + p.x, 0) / Math.max(ends.length, 1),
    y: ends.reduce((sum, p) => sum + p.y, 0) / Math.max(ends.length, 1),
  }
  const preferred =
    forcedMidX ?? (s.x + e.x) / 2 + lane * lanePitch
  const yTop = Math.min(s.y, e.y)
  const yBottom = Math.max(s.y, e.y)
  const lo = Math.min(s.x, e.x) + 10
  const hi = Math.max(s.x, e.x) - 10

  // Forced lanes must stick — otherwise pickBestRoute collapses parallel
  // twisted pairs onto the same mid-X. The caller owns lane placement (inside
  // the facing channel, or outward for same-side loops).
  if (forcedMidX != null) {
    return dedupePoints([
      s,
      { x: forcedMidX, y: s.y },
      { x: forcedMidX, y: e.y },
      e,
    ])
  }

  const candidates: Point[][] = []

  const midCandidates: number[] = [preferred]
  if (hi > lo) {
    const clamped = Math.min(hi, Math.max(lo, preferred))
    midCandidates.length = 0
    midCandidates.push(clamped)
    for (let k = 1; k <= 5; k++) {
      midCandidates.push(clamped - k * lanePitch, clamped + k * lanePitch)
    }
    if (obstacles.length) {
      midCandidates.push(
        clearChannelX(clamped, lo, hi, yTop, yBottom, obstacles),
      )
    }
  }

  for (const midX of midCandidates) {
    candidates.push(
      dedupePoints([
        s,
        { x: midX, y: s.y },
        { x: midX, y: e.y },
        e,
      ]),
    )
  }

  const detourBelow = clearHorizontalY(
    yBottom + 40 + lane * lanePitch,
    Math.min(s.x, e.x),
    Math.max(s.x, e.x),
    obstacles,
  )
  const detourAbove = clearHorizontalY(
    yTop - 40 - lane * lanePitch,
    Math.min(s.x, e.x),
    Math.max(s.x, e.x),
    obstacles,
  )
  candidates.push(
    dedupePoints([
      s,
      { x: s.x, y: detourBelow },
      { x: e.x, y: detourBelow },
      e,
    ]),
    dedupePoints([
      s,
      { x: s.x, y: detourAbove },
      { x: e.x, y: detourAbove },
      e,
    ]),
  )
  // Extra spaced horizontal tracks so parallel conductors don't collapse onto
  // the same detour Y when the direct mid channel is blocked.
  for (let k = 1; k <= 4; k++) {
    const below = clearHorizontalY(
      yBottom + 40 + (Math.abs(lane) + k) * lanePitch,
      Math.min(s.x, e.x),
      Math.max(s.x, e.x),
      obstacles,
    )
    const above = clearHorizontalY(
      yTop - 40 - (Math.abs(lane) + k) * lanePitch,
      Math.min(s.x, e.x),
      Math.max(s.x, e.x),
      obstacles,
    )
    candidates.push(
      dedupePoints([
        s,
        { x: s.x, y: below },
        { x: e.x, y: below },
        e,
      ]),
      dedupePoints([
        s,
        { x: s.x, y: above },
        { x: e.x, y: above },
        e,
      ]),
    )
  }

  return pickBestRoute(candidates, obstacles, priorRoutes, reserved, preferred)
}

function pointAndNormalAt(
  pts: Point[],
  dist: number,
): { p: Point; n: Point } {
  let remaining = Math.max(0, dist)
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (seg < 1e-6) continue
    if (remaining <= seg || i === pts.length - 1) {
      const t = Math.min(1, remaining / seg)
      const tangent = normalize({ x: b.x - a.x, y: b.y - a.y })
      return {
        p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        n: normalOf(tangent),
      }
    }
    remaining -= seg
  }
  const last = pts[pts.length - 1] ?? { x: 0, y: 0 }
  return { p: last, n: { x: 0, y: -1 } }
}

export function braidAlongCenterline(
  center: Point[],
  count: number,
  amplitude = 7.5,
): Point[][] {
  const length = polylineLength(center)
  if (length < 1 || count < 1) return []
  // Constant spatial frequency along the full trunk (screen units).
  const twists = Math.max(3, length / 55)
  const steps = Math.max(48, Math.round(length / 3))
  const braids: Point[][] = []
  for (let i = 0; i < count; i++) {
    const phase = (i * 2 * Math.PI) / count
    const out: Point[] = []
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const { p, n } = pointAndNormalAt(center, t * length)
      // Constant amplitude along the whole run (horizontal and vertical).
      const off = amplitude * Math.sin(2 * Math.PI * twists * t + phase)
      out.push({ x: p.x + n.x * off, y: p.y + n.y * off })
    }
    braids.push(out)
  }
  return braids
}

export function dist2(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Drop short orthogonal jogs so shield trunks stay coarse and straight. */
export function coarseOrthogonalTrunk(pts: Point[], minRun = 22): Point[] {
  if (pts.length < 3) return pts.map((p) => ({ ...p }))
  const simplified = dedupePoints(pts)
  const out: Point[] = [simplified[0]!]
  for (let i = 1; i < simplified.length - 1; i++) {
    const prev = out[out.length - 1]!
    const cur = simplified[i]!
    const next = simplified[i + 1]!
    const run = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    const prevH = Math.abs(prev.y - cur.y) < 0.75
    const nextH = Math.abs(cur.y - next.y) < 0.75
    // Only drop points on a straight run; dropping a short-legged corner would
    // join its neighbours with a diagonal.
    if (run < minRun && prevH === nextH) continue
    out.push(cur)
  }
  out.push(simplified[simplified.length - 1]!)
  return squareOffDiagonals(dedupePoints(out))
}

/** Replace any diagonal step with an L (horizontal first, then vertical). */
function squareOffDiagonals(pts: Point[]): Point[] {
  const out: Point[] = []
  for (const p of pts) {
    const prev = out[out.length - 1]
    if (prev && Math.abs(prev.x - p.x) > 0.75 && Math.abs(prev.y - p.y) > 0.75) {
      out.push({ x: p.x, y: prev.y })
    }
    out.push(p)
  }
  return dedupePoints(out)
}

/**
 * Parallel ±halfWidth ribbon around a Manhattan centerline.
 * Left/right sides keep the same bend count as the trunk; end caps are short
 * orthogonal joins — not a rect-union hull with extra corners.
 */
export function parallelManhattanOutline(
  center: Point[],
  halfWidth: number,
): Point[] {
  if (center.length < 2 || halfWidth <= 0) return []
  const tube = coarseOrthogonalTrunk(dedupePoints(center), 14)
  if (tube.length < 2) return []
  const left = offsetManhattanPolyline(tube, halfWidth)
  const right = offsetManhattanPolyline(tube, -halfWidth)
  if (left.length < 2 || right.length < 2) return []
  return dedupePoints([...left, ...right.reverse(), left[0]!])
}

/**
 * Closed orthogonal outline of everything within `halfWidth` (square metric) of
 * a Manhattan centerline: the exterior of the union of each segment's inflated
 * rectangle. Unlike an offset ribbon this stays valid when `halfWidth` exceeds
 * the length of a leg, so it can wrap a bundle of wider inner shields.
 */
export function rectUnionOutline(center: Point[], halfWidth: number): Point[] {
  const pts = dedupePoints(center)
  if (pts.length < 2 || halfWidth <= 0) return []
  const rects: Array<{ x0: number; x1: number; y0: number; y1: number }> = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    rects.push({
      x0: Math.min(a.x, b.x) - halfWidth,
      x1: Math.max(a.x, b.x) + halfWidth,
      y0: Math.min(a.y, b.y) - halfWidth,
      y1: Math.max(a.y, b.y) + halfWidth,
    })
  }
  const uniq = (values: number[]) =>
    [...new Set(values.map((v) => Math.round(v * 100) / 100))].sort(
      (m, n) => m - n,
    )
  const xs = uniq(rects.flatMap((r) => [r.x0, r.x1]))
  const ys = uniq(rects.flatMap((r) => [r.y0, r.y1]))
  const filled = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= ys.length - 1) return false
    const cx = (xs[i]! + xs[i + 1]!) / 2
    const cy = (ys[j]! + ys[j + 1]!) / 2
    return rects.some((r) => cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1)
  }

  const key = (p: Point) => `${p.x},${p.y}`
  const edges = new Map<string, Point[]>()
  const addEdge = (from: Point, to: Point) => {
    const list = edges.get(key(from)) ?? []
    list.push(to)
    edges.set(key(from), list)
  }
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      if (!filled(i, j)) continue
      const tl = { x: xs[i]!, y: ys[j]! }
      const tr = { x: xs[i + 1]!, y: ys[j]! }
      const br = { x: xs[i + 1]!, y: ys[j + 1]! }
      const bl = { x: xs[i]!, y: ys[j + 1]! }
      if (!filled(i, j - 1)) addEdge(tl, tr)
      if (!filled(i + 1, j)) addEdge(tr, br)
      if (!filled(i, j + 1)) addEdge(br, bl)
      if (!filled(i - 1, j)) addEdge(bl, tl)
    }
  }

  let best: Point[] = []
  const used = new Set<string>()
  for (const [startKey, targets] of edges) {
    if (!targets.length || used.has(startKey)) continue
    const [sx, sy] = startKey.split(',').map(Number)
    const loop: Point[] = [{ x: sx!, y: sy! }]
    let current = loop[0]!
    for (let guard = 0; guard < 10000; guard++) {
      const outgoing = edges.get(key(current))
      const next = outgoing?.shift()
      if (!next) break
      used.add(key(current))
      loop.push(next)
      current = next
      if (key(current) === startKey) break
    }
    if (loop.length > best.length) best = loop
  }

  // Merge collinear runs so each side is one straight stroke.
  const out: Point[] = []
  for (let i = 0; i < best.length - 1; i++) {
    const prev = out[out.length - 1] ?? best[best.length - 2]!
    const cur = best[i]!
    const next = best[i + 1]!
    const straight =
      (Math.abs(prev.x - cur.x) < 0.01 && Math.abs(cur.x - next.x) < 0.01) ||
      (Math.abs(prev.y - cur.y) < 0.01 && Math.abs(cur.y - next.y) < 0.01)
    if (!straight) out.push(cur)
  }
  if (out.length) out.push({ ...out[0]! })
  return out
}

function leftNormal(dx: number, dy: number): Point {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: 0, y: dx >= 0 ? -1 : 1 }
  }
  return { x: dy >= 0 ? 1 : -1, y: 0 }
}

/** Offset a Manhattan polyline to one side with square joins (no diagonals). */
function offsetManhattanPolyline(pts: Point[], dist: number): Point[] {
  if (pts.length < 2) return pts.map((p) => ({ ...p }))
  const out: Point[] = []
  for (let i = 0; i < pts.length; i++) {
    const curr = pts[i]!
    const prev = pts[i - 1]
    const next = pts[i + 1]
    if (!prev && next) {
      const n = leftNormal(next.x - curr.x, next.y - curr.y)
      out.push({ x: curr.x + n.x * dist, y: curr.y + n.y * dist })
      continue
    }
    if (prev && !next) {
      const n = leftNormal(curr.x - prev.x, curr.y - prev.y)
      out.push({ x: curr.x + n.x * dist, y: curr.y + n.y * dist })
      continue
    }
    if (prev && next) {
      const nIn = leftNormal(curr.x - prev.x, curr.y - prev.y)
      const nOut = leftNormal(next.x - curr.x, next.y - curr.y)
      // Square miter: combine axis normals from both segments.
      out.push({
        x: curr.x + (nIn.x + nOut.x) * dist,
        y: curr.y + (nIn.y + nOut.y) * dist,
      })
    }
  }
  return dedupePoints(out)
}

export function longestSegmentLabel(pts: Point[]): {
  x: number
  y: number
} {
  if (pts.length < 2) return { x: pts[0]?.x ?? 0, y: (pts[0]?.y ?? 0) - 12 }
  let bestLen = -1
  let ax = 0
  let ay = 0
  let bx = 0
  let by = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len > bestLen) {
      bestLen = len
      ax = a.x
      ay = a.y
      bx = b.x
      by = b.y
    }
  }
  const tangent = normalize({ x: bx - ax, y: by - ay })
  let nx = -tangent.y
  let ny = tangent.x
  if (ny > 0) {
    nx = -nx
    ny = -ny
  }
  return {
    x: (ax + bx) / 2 + nx * 11,
    y: (ay + by) / 2 + ny * 11,
  }
}
