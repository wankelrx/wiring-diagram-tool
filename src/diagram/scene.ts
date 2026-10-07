import { isLightColor, resolveWireColor } from '../colors'
import { DEFAULT_DRAWING_META } from '../documentMeta'
import {
  hasShieldPin,
  isPigtailEndId,
  openEndOf,
  pigtailBaseId,
  pigtailEndId,
  shieldPinFor,
  SHIELD_PIN,
} from '../pigtail'
import type { Connector, DrawingMeta, Wire } from '../types'
import { TITLE_BLOCK_H } from './titleBlock'
import { computeLayout, findPin, type LayoutResult } from './layout'
import {
  braidAlongCenterline,
  bundleKey,
  coarseOrthogonalTrunk,
  dedupePoints,
  dist2,
  longestSegmentLabel,
  parallelManhattanOutline,
  rectUnionOutline,
  orthogonalRoute,
  pickBundleCorridorX,
  polylineLength,
  polylinePath,
  reserveRouteChannels,
  routeAlongCorridor,
  routeClear,
  sharedTrunk,
  type Box,
  type Point,
  type RouteChannels,
} from './paths'

export type SceneConnector = {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  pins: Array<{
    pin: string
    signal: string
    x: number
    y: number
    labelX: number
    labelY: number
    signalX: number
    signalAnchor: 'start' | 'end'
    error: boolean
    /** The SHLD drain pin added to pigtail connectors. */
    shield: boolean
  }>
}

export type SceneWire = {
  id: string
  points: Point[]
  path: string
  color: string
  underStroke: boolean
  error: boolean
  dashed: boolean
  bundleId: string
  label: string
  labelX: number
  labelY: number
}

export type SceneBundle = {
  id: string
  points: Point[]
  path: string
  label: string
  labelX: number
  labelY: number
  strokeWidth: number
  wireCount: number
}

export type SceneShield = {
  id: string
  points: Point[]
  path: string
  outline: Point[]
  outlinePath: string
  /** Inner pair/foil shield vs outer cable jacket shield. */
  kind: 'pair' | 'overall'
}

/** Right-angle drain line from a shield outline to the pin it terminates on. */
export type SceneShieldLink = {
  id: string
  kind: 'pair' | 'overall'
  /** Ordered from the connector pin out to the shield outline. */
  points: Point[]
  path: string
  pin: Point
  anchor: Point
}

export type SceneFrame = {
  x: number
  y: number
  width: number
  height: number
  title: string
  drawingNumber: string
  revision: string
  date: string
  author: string
  notes: string
  subtitle: string
}

export type Scene = {
  layout: LayoutResult
  connectors: SceneConnector[]
  wires: SceneWire[]
  bundles: SceneBundle[]
  shields: SceneShield[]
  shieldLinks: SceneShieldLink[]
  frame: SceneFrame
  minX: number
  minY: number
  width: number
  height: number
}

export type SceneOptions = {
  showLabels: boolean
  showCableIds: boolean
  duplicatePins: Set<string>
  duplicateWireIds: Set<string>
  errorWireIds: Set<string>
  meta?: DrawingMeta
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    if (!key) continue
    const list = map.get(key) ?? []
    list.push(item)
    map.set(key, list)
  }
  return map
}

function wireLabel(wire: Wire): string {
  return [wire.wire_color, wire.gauge]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' · ')
}

/**
 * Gap kept between an overall jacket and the members it wraps. Wide enough to
 * clear the pin circles on the outermost wires.
 */
const OVERALL_MARGIN = 10
/** How far a conductor reaches from its lane: braid amplitude or stroke. */
function conductorReach(wire: Wire): number {
  return wire.twist_group?.trim() ? 7 : 3
}

/** Gap between a pair shield and the outermost conductor it wraps. */
const PAIR_MARGIN = 4
/** Gap between an overall jacket's end cap and the inner pair shield it wraps. */
const OVERALL_END_MARGIN = 6
/** How far past a connector pin the overall jacket's end cap sits. */
const OVERALL_END_INSET = 14

/**
 * `memberClearance` is how far each member's own envelope (a pair shield, or
 * the bare conductor) reaches from its centerline; an overall jacket must wrap
 * all of it, not just the centerlines. `memberTubes` are the pair shield
 * centerlines the jacket must stay clear of at its end caps.
 */
function buildShieldEnvelope(
  groupRoutes: Point[][],
  pad: number,
  kind: 'pair' | 'overall' = 'pair',
  memberClearance = 0,
  memberTubes: Point[][] = [],
  pinPoints: Point[] = [],
  reaches: number[] = [],
): { tube: Point[]; outline: Point[]; halfWidth: number } | null {
  if (!groupRoutes.length) return null
  const entries = groupRoutes
    .map((route, i) => ({
      route: simplifyOrthogonal(route),
      reach: reaches[i] ?? 0,
    }))
    .filter((entry) => entry.route.length >= 2)
  const trunks = entries.map((entry) => entry.route)
  if (!trunks.length) return null

  // Follow the real wire trunk — same bends — only drop tiny face doglegs.
  let tube = coarseOrthogonalTrunk(
    trunks.reduce(
      (best, r) => (polylineLength(r) > polylineLength(best) ? r : best),
      trunks[0]!,
    ),
    16,
  )
  if (trunks.length >= 2) {
    const zForms = trunks.map(toZForm)
    const aligned = zForms.every((z): z is Point[] => z !== null)
      ? midlineOfExtremes(zForms as Point[][])
      : averageAlignedTrunks(trunks.map((t) => coarseOrthogonalTrunk(t, 16)))
    if (aligned) {
      tube = simplifyOrthogonal(aligned)
    } else if (kind === 'overall') {
      const trackYs = trunks
        .map((t) => longestHorizontalY(t))
        .filter((y): y is number => y != null)
      if (trackYs.length >= 2) {
        const meanY =
          trackYs.reduce((sum, y) => sum + y, 0) / trackYs.length
        const templateY = longestHorizontalY(tube)
        if (templateY != null) {
          tube = simplifyOrthogonal(
            tube.map((p) =>
              Math.abs(p.y - templateY) < 1 ? { x: p.x, y: meanY } : p,
            ),
          )
        }
      }
    }
  }
  tube = simplifyOrthogonal(tube)

  // Trunks of different lengths end at different points along the tube; only
  // the sideways spread matters, so measure against the tube extended past its
  // ends rather than letting an overhanging end inflate the jacket.
  const measureTube = extendEnds(tube, 1e4)
  let siblingSpread = 0
  let envelopeReach = 0
  for (const { route, reach } of entries) {
    let routeSpread = 0
    for (const p of route) {
      let nearest = Infinity
      for (let i = 1; i < measureTube.length; i++) {
        nearest = Math.min(
          nearest,
          distPointToSegment(p, measureTube[i - 1]!, measureTube[i]!),
        )
      }
      routeSpread = Math.max(routeSpread, nearest)
    }
    siblingSpread = Math.max(siblingSpread, routeSpread)
    envelopeReach = Math.max(envelopeReach, routeSpread + reach)
  }
  // A pair jacket wraps every member's own envelope (its lane plus the braid
  // amplitude); the overall jacket wraps each pair jacket.
  const halfWidth =
    kind === 'overall'
      ? Math.max(pad, siblingSpread + memberClearance + OVERALL_MARGIN)
      : Math.max(pad, envelopeReach + PAIR_MARGIN)

  if (kind === 'overall') {
    tube = insetEnds(
      tube,
      overallEndShift(tube, pinPoints, memberTubes, halfWidth, 'start'),
      overallEndShift(tube, pinPoints, memberTubes, halfWidth, 'end'),
    )
  } else {
    tube = insetEnds(
      tube,
      commonRunShift(tube, trunks, 'start'),
      commonRunShift(tube, trunks, 'end'),
    )
  }

  const outline =
    kind === 'overall'
      ? rectUnionOutline(tube, halfWidth)
      : simplifyOrthogonal(parallelManhattanOutline(tube, halfWidth))

  return { tube, outline, halfWidth }
}

/**
 * How far to slide one end of an overall jacket's centerline inward (negative
 * = outward) so its end cap, which `rectUnionOutline` places `halfWidth` past
 * the centerline end, lands just beyond the connector pin: visible, with the
 * pin circles inside the jacket. The cap stays before the first wire bend and
 * at least `OVERALL_END_MARGIN` outside the inner pair shields.
 */
function overallEndShift(
  tube: Point[],
  pinPoints: Point[],
  memberTubes: Point[][],
  halfWidth: number,
  which: 'start' | 'end',
): number {
  const end = which === 'start' ? tube[0]! : tube[tube.length - 1]!
  const next = which === 'start' ? tube[1]! : tube[tube.length - 2]!
  const other = which === 'start' ? tube[tube.length - 1]! : tube[0]!
  const len = Math.hypot(next.x - end.x, next.y - end.y)
  if (len < 1e-9) return 0
  const ux = (next.x - end.x) / len
  const uy = (next.y - end.y) / len

  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
  const pins = pinPoints.filter((p) => dist(p, end) <= dist(p, other))
  if (!pins.length) return 0
  const pin = {
    x: pins.reduce((sum, p) => sum + p.x, 0) / pins.length,
    y: pins.reduce((sum, p) => sum + p.y, 0) / pins.length,
  }
  const alongFromPin = (p: Point) => (p.x - pin.x) * ux + (p.y - pin.y) * uy

  // The cap stays before the point where the wires leave the pins and start
  // their shared run, so every conductor is wrapped from just past its pin.
  let capDistance = Math.min(
    OVERALL_END_INSET,
    alongFromPin(end) - OVERALL_END_MARGIN,
  )

  for (const mt of memberTubes) {
    if (mt.length < 2) continue
    const first = mt[0]!
    const last = mt[mt.length - 1]!
    const nearest =
      Math.hypot(first.x - end.x, first.y - end.y) <=
      Math.hypot(last.x - end.x, last.y - end.y)
        ? first
        : last
    capDistance = Math.min(capDistance, alongFromPin(nearest) - OVERALL_END_MARGIN)
  }

  const currentCap = -halfWidth + alongFromPin(end)
  return Math.min(capDistance - currentCap, len * 0.45)
}

/**
 * How far to pull one end of a pair shield inward so it starts where every
 * member is on its shared run. Averaged trunks can begin earlier than a
 * twisted member does, which would leave that member's fan-out from its pin
 * grazing the jacket edge.
 */
function commonRunShift(
  tube: Point[],
  trunks: Point[][],
  which: 'start' | 'end',
): number {
  const end = which === 'start' ? tube[0]! : tube[tube.length - 1]!
  const next = which === 'start' ? tube[1]! : tube[tube.length - 2]!
  const other = which === 'start' ? tube[tube.length - 1]! : tube[0]!
  const len = Math.hypot(next.x - end.x, next.y - end.y)
  if (len < 1e-9) return 0
  const ux = (next.x - end.x) / len
  const uy = (next.y - end.y) / len
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

  let shift = 0
  for (const t of trunks) {
    const first = t[0]!
    const last = t[t.length - 1]!
    const near =
      dist(first, end) + dist(last, other) <= dist(last, end) + dist(first, other)
        ? first
        : last
    shift = Math.max(shift, (near.x - end.x) * ux + (near.y - end.y) * uy)
  }
  return Math.min(shift, len * 0.45)
}

/** Move both ends of a polyline inward (or outward when negative). */
function insetEnds(pts: Point[], startInset: number, endInset: number): Point[] {
  if (pts.length < 2) return pts
  const out = pts.map((p) => ({ ...p }))
  const move = (end: Point, toward: Point, amount: number) => {
    const dx = toward.x - end.x
    const dy = toward.y - end.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) return
    end.x += (dx / len) * amount
    end.y += (dy / len) * amount
  }
  move(out[0]!, pts[1]!, startInset)
  move(out[out.length - 1]!, pts[pts.length - 2]!, endInset)
  return out
}

/**
 * Express a horizontal–vertical–horizontal trunk (including L shapes and flat
 * runs, whose vertical sits on an end) as four points: start, two corners, end.
 * Trunks of different bend counts then share one topology and can be averaged.
 * Returns null for anything with more than one vertical run.
 */
function toZForm(trunk: Point[]): Point[] | null {
  if (trunk.length < 2) return null
  const start = trunk[0]!
  const end = trunk[trunk.length - 1]!
  let midX: number | null = null
  for (let i = 1; i < trunk.length; i++) {
    const a = trunk[i - 1]!
    const b = trunk[i]!
    const vertical = Math.abs(a.x - b.x) < 0.75 && Math.abs(a.y - b.y) >= 0.75
    const horizontal = Math.abs(a.y - b.y) < 0.75
    if (!vertical && !horizontal) return null
    if (vertical) {
      if (midX !== null && Math.abs(midX - a.x) >= 0.75) return null
      midX = a.x
    }
  }
  const x = midX ?? (start.x + end.x) / 2
  return [
    { x: start.x, y: start.y },
    { x, y: start.y },
    { x, y: end.y },
    { x: end.x, y: end.y },
  ]
}

function longestHorizontalY(pts: Point[]): number | null {
  let best = 0
  let y: number | null = null
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    if (Math.abs(a.y - b.y) > 0.75) continue
    const len = Math.abs(b.x - a.x)
    if (len > best) {
      best = len
      y = a.y
    }
  }
  return best >= 24 ? y : null
}

/** Lengthen both ends of a polyline along their end segments by `amount`. */
function extendEnds(pts: Point[], amount: number): Point[] {
  if (pts.length < 2) return pts
  const out = pts.map((p) => ({ ...p }))
  const push = (end: Point, toward: Point) => {
    const dx = end.x - toward.x
    const dy = end.y - toward.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) return
    end.x += (dx / len) * amount
    end.y += (dy / len) * amount
  }
  push(out[0]!, out[1]!)
  push(out[out.length - 1]!, out[out.length - 2]!)
  return out
}

/**
 * Midline between the two most distant of several same-topology trunks. Unlike
 * the mean, it centers the jacket on the outermost conductors, so a lone wire
 * off to one side does not leave the jacket lopsided.
 */
function midlineOfExtremes(trunks: Point[][]): Point[] | null {
  if (trunks.length < 2) return trunks[0] ?? null
  const len = trunks[0]!.length
  if (!trunks.every((t) => t.length === len)) return null
  let best: [number, number] = [0, 0]
  let bestDist = -1
  for (let i = 0; i < trunks.length; i++) {
    for (let j = i + 1; j < trunks.length; j++) {
      let d = 0
      for (let k = 0; k < len; k++) {
        d = Math.max(
          d,
          Math.hypot(
            trunks[i]![k]!.x - trunks[j]![k]!.x,
            trunks[i]![k]!.y - trunks[j]![k]!.y,
          ),
        )
      }
      if (d > bestDist) {
        bestDist = d
        best = [i, j]
      }
    }
  }
  const a = trunks[best[0]]!
  const b = trunks[best[1]]!
  return a.map((p, k) => ({ x: (p.x + b[k]!.x) / 2, y: (p.y + b[k]!.y) / 2 }))
}

/** Average trunks that share the same corner count (same bend topology). */
function averageAlignedTrunks(trunks: Point[][]): Point[] | null {
  if (trunks.length < 2) return trunks[0] ?? null
  const len = trunks[0]!.length
  if (!trunks.every((t) => t.length === len)) return null
  const out: Point[] = []
  for (let i = 0; i < len; i++) {
    let x = 0
    let y = 0
    for (const t of trunks) {
      x += t[i]!.x
      y += t[i]!.y
    }
    out.push({ x: x / trunks.length, y: y / trunks.length })
  }
  return out
}

function distPointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Drop near-colinear samples so shield edges stay straight Manhattan strokes. */
function simplifyOrthogonal(pts: Point[]): Point[] {
  if (pts.length < 3) return pts
  const out: Point[] = [pts[0]!]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]!
    const b = pts[i]!
    const c = pts[i + 1]!
    const abH = Math.abs(a.y - b.y) < 0.75
    const bcH = Math.abs(b.y - c.y) < 0.75
    const abV = Math.abs(a.x - b.x) < 0.75
    const bcV = Math.abs(b.x - c.x) < 0.75
    if ((abH && bcH) || (abV && bcV)) continue
    // Keep corners; also keep if the run bends between H and V.
    out.push(b)
  }
  out.push(pts[pts.length - 1]!)
  return dedupePoints(out)
}

function averageRoute(routes: Point[][]): Point[] {
  if (!routes.length) return []
  const maxLen = Math.max(...routes.map((r) => r.length))
  const out: Point[] = []
  for (let i = 0; i < maxLen; i++) {
    let x = 0
    let y = 0
    let n = 0
    for (const route of routes) {
      const p = route[Math.min(i, route.length - 1)]
      if (!p) continue
      x += p.x
      y += p.y
      n += 1
    }
    if (n) out.push({ x: x / n, y: y / n })
  }
  return out
}

const LABEL_H = 13
const LABEL_HALF_W = 48

function deoverlapLabels(wires: SceneWire[]): void {
  const labeled = wires.filter((wire) => wire.label)
  // Prefer keeping each label near its own wire's vertical lane: sort by
  // natural Y, then nudge only when boxes collide.
  labeled.sort((a, b) => a.labelY - b.labelY || a.labelX - b.labelX)
  const placed: SceneWire[] = []
  for (const wire of labeled) {
    let guard = 0
    let collides = true
    while (collides && guard < 36) {
      collides = false
      for (const other of placed) {
        const dx = Math.abs(wire.labelX - other.labelX)
        const dy = Math.abs(wire.labelY - other.labelY)
        if (dx < LABEL_HALF_W * 2 && dy < LABEL_H) {
          // Alternate horizontal nudge then vertical stack to fan labels out.
          if (guard % 2 === 0) {
            wire.labelX += guard % 4 === 0 ? 56 : -56
          } else {
            wire.labelY = other.labelY + LABEL_H
          }
          collides = true
          break
        }
      }
      guard += 1
    }
    placed.push(wire)
  }
}

function expandBox(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  x: number,
  y: number,
  pad = 0,
) {
  box.minX = Math.min(box.minX, x - pad)
  box.minY = Math.min(box.minY, y - pad)
  box.maxX = Math.max(box.maxX, x + pad)
  box.maxY = Math.max(box.maxY, y + pad)
}

/**
 * Right-angle drain line from a connector pin out to a shield outline. A pin
 * level with the shield runs straight in to its end cap; a pin above or below
 * runs along its own row, then turns once onto the nearest outline corner.
 * Points run pin first, shield last.
 */
function shieldLinkRoute(
  outline: Point[],
  pin: { x: number; y: number; dir: number },
): Point[] | null {
  if (outline.length < 2) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of outline) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  const start = { x: pin.x, y: pin.y }
  const facingX = pin.dir > 0 ? minX : maxX
  const level = pin.y > minY + 1 && pin.y < maxY - 1
  const gap = (facingX - pin.x) * pin.dir
  if (level) {
    return gap < 4 ? null : [start, { x: facingX, y: pin.y }]
  }
  const edgeY = pin.y <= minY + 1 ? minY : maxY
  if (gap < 0) return null
  if (gap < 14) {
    // Shield starts right at the connector face: step out, then run along the
    // shield's top or bottom edge.
    const stubX = pin.x + pin.dir * 12
    if (stubX < minX || stubX > maxX) return null
    return dedupePoints([start, { x: stubX, y: pin.y }, { x: stubX, y: edgeY }])
  }
  let corner = outline[0]!
  let best = Infinity
  for (const p of outline) {
    const d = Math.abs(p.x - facingX) + Math.abs(p.y - edgeY)
    if (d < best) {
      best = d
      corner = p
    }
  }
  return dedupePoints([start, { x: corner.x, y: pin.y }, { ...corner }])
}

export function computeScene(
  connectors: Connector[],
  wires: Wire[],
  options: SceneOptions,
): Scene {
  // A wire with one blank end on a pigtail runs out to that pigtail's hidden
  // free end, straight across at the pigtail length.
  const connectorById = new Map(connectors.map((c) => [c.connector_id, c]))
  const allWires: Wire[] = wires.map((wire) => {
    const open = openEndOf(wire, connectorById)
    if (!open) return wire
    return {
      ...wire,
      from_connector: open.connectorId,
      from_pin: open.pin,
      to_connector: pigtailEndId(open.connectorId),
      to_pin: open.pin,
    }
  })
  const layout = computeLayout(connectors, allWires)
  type Routed = {
    wire: Wire
    from: NonNullable<ReturnType<typeof findPin>>
    to: NonNullable<ReturnType<typeof findPin>>
  }
  const routed: Routed[] = []
  const unrouted: Wire[] = []
  for (const wire of allWires) {
    const fromLayout = layout.byId.get(wire.from_connector)
    const toLayout = layout.byId.get(wire.to_connector)
    const from = findPin(fromLayout, wire.from_pin)
    const to = findPin(toLayout, wire.to_pin)
    if (!from || !to) {
      unrouted.push(wire)
      continue
    }
    routed.push({ wire, from, to })
  }

  const wireIsError = (id: string) =>
    options.duplicateWireIds.has(id) || options.errorWireIds.has(id)

  const obstacleById = new Map<string, Box>()
  const obstacles: Box[] = layout.connectors.map((c) => {
    const box = { x: c.x, y: c.y, width: c.width, height: c.height }
    obstacleById.set(c.connector.connector_id, box)
    return box
  })

  const bundles = groupBy(routed, ({ wire }) =>
    bundleKey(wire.from_connector, wire.to_connector),
  )

  // Spread bundles that share the same vertical corridor so their trunks and
  // routing channels do not stack on top of one another.
  const bundleBaseLane = new Map<string, number>()
  {
    type Corridor = { id: string; midX: number; minY: number; maxY: number }
    const corridors: Corridor[] = []
    for (const [id, members] of bundles) {
      let sx = 0
      let ex = 0
      let minY = Infinity
      let maxY = -Infinity
      for (const { from, to } of members) {
        sx += from.x
        ex += to.x
        minY = Math.min(minY, from.y, to.y)
        maxY = Math.max(maxY, from.y, to.y)
      }
      const n = Math.max(members.length, 1)
      corridors.push({ id, midX: (sx + ex) / (2 * n), minY, maxY })
    }
    const buckets = new Map<number, Corridor[]>()
    for (const corridor of corridors) {
      const key = Math.round(corridor.midX / 80)
      const list = buckets.get(key) ?? []
      list.push(corridor)
      buckets.set(key, list)
    }
    for (const list of buckets.values()) {
      const overlapping = list.filter((corridor) =>
        list.some(
          (other) =>
            other !== corridor &&
            other.minY <= corridor.maxY &&
            other.maxY >= corridor.minY,
        ),
      )
      if (overlapping.length < 2) continue
      overlapping.sort((a, b) => a.minY - b.minY || a.id.localeCompare(b.id))
      overlapping.forEach((corridor, index) => {
        bundleBaseLane.set(corridor.id, index - (overlapping.length - 1) / 2)
      })
    }
  }

  const sceneWires: SceneWire[] = []
  const sceneBundles: SceneBundle[] = []
  const sceneShields: SceneShield[] = []
  const priorRoutes: Point[][] = []
  const reserved: RouteChannels = { vertical: [], horizontal: [] }

  const shieldLinks: SceneShieldLink[] = []
  // Each end of a shield terminates on that connector's SHLD pin, or on the
  // pin a wire names; a connector with neither is left unlinked.
  const linkShield = (
    id: string,
    kind: 'pair' | 'overall',
    outline: Point[],
    group: Routed[],
    ends: Array<string | undefined>,
  ) => {
    const seen = new Set<string>()
    for (const end of ends) {
      if (!end || isPigtailEndId(end) || seen.has(end)) continue
      seen.add(end)
      const connector = connectorById.get(end)
      const endLayout = layout.byId.get(end)
      if (!connector || !endLayout) continue
      const chosen = shieldPinFor(
        group.map((row) => row.wire),
        end,
      )
      const pin =
        (chosen ? findPin(endLayout, chosen) : undefined) ??
        (hasShieldPin(connector) ? findPin(endLayout, SHIELD_PIN) : undefined)
      if (!pin) continue
      const points = shieldLinkRoute(outline, pin)
      if (!points) continue
      shieldLinks.push({
        id: `${id}:${end}`,
        kind,
        points,
        path: polylinePath(points),
        pin: points[0]!,
        anchor: points[points.length - 1]!,
      })
    }
  }

  for (const [id, members] of bundles) {
    const [endA, endB] = id.split('--')
    const bundlePigtail = [endA, endB]
      .map((end) => connectorById.get(pigtailBaseId(end ?? '')))
      .find((c) => c?.pigtail)
    const bundleExclude = [
      endA ? obstacleById.get(endA) : undefined,
      endB ? obstacleById.get(endB) : undefined,
    ].filter((b): b is Box => Boolean(b))
    const bundleBlockers = obstacles.filter((o) => !bundleExclude.includes(o))
    const twistGroups = groupBy(
      members,
      ({ wire }) => wire.twist_group?.trim() ?? '',
    )
    type Slot = Routed[]
    const slots: Slot[] = []
    const twisted = new Set<string>()
    for (const [, group] of twistGroups) {
      if (group.length < 2) continue
      slots.push(group)
      for (const row of group) twisted.add(row.wire.wire_id)
    }
    for (const row of members) {
      if (!twisted.has(row.wire.wire_id)) slots.push([row])
    }

    const shieldKeyOf = (slot: Slot) => slot[0]?.wire.shield_group?.trim() ?? ''
    const meanY = (slot: Slot, end: 'from' | 'to') =>
      slot.reduce((sum, row) => sum + row[end].y, 0) / Math.max(slot.length, 1)
    // Y on the left-hand connector — stable across from/to wire direction.
    const leftY = (slot: Slot) => {
      let sum = 0
      for (const row of slot) {
        sum += row.from.x <= row.to.x ? row.from.y : row.to.y
      }
      return sum / Math.max(slot.length, 1)
    }

    const rightY = (slot: Slot) => {
      let sum = 0
      for (const row of slot) {
        sum += row.from.x <= row.to.x ? row.to.y : row.from.y
      }
      return sum / Math.max(slot.length, 1)
    }

    // Order by left-side pin Y so river mid-X lanes stay non-crossing even
    // when individual wires list ends in opposite directions.
    const orderedSlots = [...slots].sort((a, b) => {
      const dy = leftY(a) - leftY(b)
      if (Math.abs(dy) > 1) return dy
      const sa = shieldKeyOf(a)
      const sb = shieldKeyOf(b)
      if (sa !== sb) return sa.localeCompare(sb)
      return meanY(a, 'to') - meanY(b, 'to')
    })

    // If one wire's right-hand run sits at the same Y as the next wire's
    // left-hand run, the left lane must go to the wire whose right run is the
    // collision — otherwise the two horizontals overlap into one line.
    const sameRow = 8
    for (let pass = 0; pass < orderedSlots.length; pass++) {
      let moved = false
      for (let i = 0; i < orderedSlots.length && !moved; i++) {
        for (let j = i + 1; j < orderedSlots.length; j++) {
          const a = orderedSlots[i]!
          const b = orderedSlots[j]!
          const clash = Math.abs(rightY(a) - leftY(b)) < sameRow
          const reverseClash = Math.abs(rightY(b) - leftY(a)) < sameRow
          if (clash && !reverseClash) {
            orderedSlots.splice(j, 1)
            orderedSlots.splice(i, 0, b)
            moved = true
            break
          }
        }
      }
      if (!moved) break
    }

    // Equal lane pitch for every conductor; only add extra gap when the
    // shield group changes so up/down runs stay evenly spaced.
    const laneCenters: number[] = []
    for (let i = 0; i < orderedSlots.length; i++) {
      if (i === 0) {
        laneCenters.push(0)
        continue
      }
      const prev = shieldKeyOf(orderedSlots[i - 1]!)
      const cur = shieldKeyOf(orderedSlots[i]!)
      const gap = prev !== cur ? 3.2 : 1.35
      laneCenters.push(laneCenters[i - 1]! + gap)
    }
    const laneMean =
      laneCenters.reduce((sum, v) => sum + v, 0) /
      Math.max(laneCenters.length, 1)
    const laneSpan = laneCenters[laneCenters.length - 1] ?? 0
    const slotRoutes: Point[][] = []
    const trunkByWireId = new Map<string, Point[]>()
    const baseLane = (bundleBaseLane.get(id) ?? 0) * (laneSpan + 2)
    const lanePitch = 26
    const corridorLaneSep = 26
    const corridorX = pickBundleCorridorX(
      members,
      bundleBlockers,
      reserved,
      baseLane * lanePitch,
    )
    let dySum = 0
    for (const row of members) {
      dySum += Math.abs(row.from.y - row.to.y)
    }
    const avgDy = dySum / Math.max(members.length, 1)
    // River mid-X lanes (2 bends) whenever connectors are vertically offset.
    const useRiverLanes = avgDy >= 8

    // When the facing gap between connectors is small, shrink the pin stubs and
    // the lane pitch so every lane stays distinct and inside the channel
    // instead of collapsing onto one X (or doubling back over its own stub).
    let faceGap = Infinity
    let faceLeftX = 0
    for (const row of members) {
      const l = row.from.x <= row.to.x ? row.from : row.to
      const r = l === row.from ? row.to : row.from
      if (l.dir > 0 && r.dir < 0 && r.x - l.x < faceGap) {
        faceGap = r.x - l.x
        faceLeftX = l.x
      }
    }
    const hasFacing = Number.isFinite(faceGap)
    const stubLen = hasFacing ? Math.min(28, Math.max(6, faceGap / 4)) : 28
    const joinOffset = stubLen + 8
    const laneInset = twisted.size > 0 ? joinOffset : stubLen
    let laneSep = corridorLaneSep
    let laneCenterX = corridorX
    if (hasFacing) {
      const loX = faceLeftX + laneInset
      const hiX = faceLeftX + faceGap - laneInset
      const gaps = Math.max(orderedSlots.length - 1, 1)
      laneSep = Math.min(corridorLaneSep, Math.max(hiX - loX, 0) / gaps)
      const half = (laneSep * (orderedSlots.length - 1)) / 2
      laneCenterX =
        hiX - half < loX + half
          ? (loX + hiX) / 2
          : Math.min(hiX - half, Math.max(loX + half, corridorX))
    }

    // Both ends exit the same side (boxes stacked in the same columns): each
    // conductor loops out to its own vertical, nested by span so wider loops
    // wrap narrower ones instead of sharing a line.
    const sameDir =
      members.length > 0 && members.every((m) => m.from.dir === m.to.dir)
    const sameDirLaneX = new Map<Slot, number>()
    if (sameDir) {
      const dir = members[0]!.from.dir
      let faceOut = dir > 0 ? -Infinity : Infinity
      for (const m of members) {
        faceOut =
          dir > 0
            ? Math.max(faceOut, m.from.x, m.to.x)
            : Math.min(faceOut, m.from.x, m.to.x)
      }
      const spanOf = (slot: Slot) =>
        Math.abs(meanY(slot, 'from') - meanY(slot, 'to'))
      const bySpan = [...orderedSlots].sort((a, b) => spanOf(a) - spanOf(b))
      bySpan.forEach((slot, rank) => {
        sameDirLaneX.set(slot, faceOut + dir * (joinOffset + 14 + rank * 20))
      })
    }

    orderedSlots.forEach((slot, slotIndex) => {
      const lane = laneCenters[slotIndex]! - laneMean + baseLane
      // Integer-ish face index for corridor stagger — avoids clamping
      // fractional laneCenters into one shared mid-X.
      const faceLane = slotIndex - (orderedSlots.length - 1) / 2
      const corridorLaneX = sameDir
        ? sameDirLaneX.get(slot)!
        : useRiverLanes
          ? laneCenterX + faceLane * laneSep
          : corridorX

      if (slot.length >= 2) {
        // Each twisted group gets its own orthogonal trunk + braid so pairs
        // stay separated and the twist runs the full cable length.
        const joinFrom = slot.map((row) => ({
          x: row.from.x + row.from.dir * joinOffset,
          y: row.from.y,
        }))
        const joinTo = slot.map((row) => ({
          x: row.to.x + row.to.dir * joinOffset,
          y: row.to.y,
        }))
        const trunk = sharedTrunk(
          joinFrom,
          joinTo,
          faceLane,
          lanePitch,
          bundleBlockers,
          priorRoutes,
          reserved,
          corridorLaneX,
        )
        const braids = braidAlongCenterline(trunk, slot.length, 6)
        slotRoutes.push(trunk)
        // Reserve a band around the twist so later wires (e.g. ENABLE) detour
        // instead of sweeping through the braid.
        reserveRouteChannels(trunk, reserved, 18)
        priorRoutes.push(trunk)
        slot.forEach((row, i) => {
          trunkByWireId.set(row.wire.wire_id, trunk)
          let braid = braids[i] ?? []
          const fromPt = { x: row.from.x, y: row.from.y }
          const toPt = { x: row.to.x, y: row.to.y }
          const start = braid[0]
          const end = braid[braid.length - 1]
          if (
            start &&
            end &&
            dist2(fromPt, end) + dist2(toPt, start) <
              dist2(fromPt, start) + dist2(toPt, end)
          ) {
            braid = [...braid].reverse()
          }
          // Short stub, then a short angled lead into the braid at each end.
          const braidStart = braid[0] ?? {
            x: fromPt.x + row.from.dir * joinOffset,
            y: fromPt.y,
          }
          const braidEnd = braid[braid.length - 1] ?? {
            x: toPt.x + row.to.dir * joinOffset,
            y: toPt.y,
          }
          const fromStub = {
            x: fromPt.x + row.from.dir * (joinOffset / 2),
            y: fromPt.y,
          }
          const toStub = {
            x: toPt.x + row.to.dir * (joinOffset / 2),
            y: toPt.y,
          }
          const points = dedupePoints([
            fromPt,
            fromStub,
            braidStart,
            ...braid,
            braidEnd,
            toStub,
            toPt,
          ])
          const color = resolveWireColor(row.wire.wire_color)
          const labelPt = longestSegmentLabel(braid.length ? braid : points)
          // One label per twisted pair, parked above the pair centerline.
          const pairY =
            slot.reduce((sum, r) => sum + (r.from.y + r.to.y) / 2, 0) /
            slot.length
          const spanMin = Math.min(...points.map((p) => p.x))
          const spanMax = Math.max(...points.map((p) => p.x))
          const labelX = Math.min(
            spanMax - 40,
            Math.max(spanMin + 40, labelPt.x),
          )
          sceneWires.push({
            id: row.wire.wire_id,
            points,
            path: polylinePath(points),
            color,
            underStroke: isLightColor(color),
            error: wireIsError(row.wire.wire_id),
            dashed: false,
            bundleId: id,
            label:
              options.showLabels && i === 0
                ? slot.length === 2
                  ? `${slot.map((r) => r.wire.wire_color).join('/')} · ${row.wire.gauge}`
                  : wireLabel(row.wire)
                : '',
            labelX,
            labelY: pairY - 14,
          })
          priorRoutes.push(points)
        })
        return
      }

      const sample = slot[0]!
      const base = routeAlongCorridor(
        sample.from.x,
        sample.from.y,
        sample.from.dir,
        sample.to.x,
        sample.to.y,
        sample.to.dir,
        corridorLaneX,
        stubLen,
      )
      const route = routeClear(base, bundleBlockers, 4)
        ? base
        : orthogonalRoute(
            sample.from.x,
            sample.from.y,
            sample.from.dir,
            sample.to.x,
            sample.to.y,
            sample.to.dir,
            lane,
            lanePitch,
            obstacles,
            bundleExclude,
            priorRoutes,
            reserved,
          )
      slotRoutes.push(route)
      trunkByWireId.set(sample.wire.wire_id, route)
      const color = resolveWireColor(sample.wire.wire_color)
      const labelPt = longestSegmentLabel(route)
      sceneWires.push({
        id: sample.wire.wire_id,
        points: route,
        path: polylinePath(route),
        color,
        underStroke: isLightColor(color),
        error: wireIsError(sample.wire.wire_id),
        dashed: false,
        bundleId: id,
        label: options.showLabels ? wireLabel(sample.wire) : '',
        labelX: labelPt.x,
        labelY: labelPt.y,
      })
      priorRoutes.push(route)
      reserveRouteChannels(route, reserved)
    })

    const centroid = averageRoute(slotRoutes)
    const [left, right] = id.split('--')
    if (options.showCableIds && members.length >= 2 && centroid.length) {
      // Park the cable ID above the uppermost conductor so it does not sit
      // on top of wire labels in the middle of the run.
      let topY = Infinity
      let midX = 0
      let n = 0
      for (const route of slotRoutes) {
        for (const p of route) {
          topY = Math.min(topY, p.y)
          midX += p.x
          n += 1
        }
      }
      const labelX = n ? midX / n : centroid[Math.floor(centroid.length / 2)]!.x
      const labelY = (Number.isFinite(topY) ? topY : centroid[0]!.y) - 34
      sceneBundles.push({
        id,
        points: centroid,
        path: polylinePath(centroid),
        label: `${
          bundlePigtail
            ? `${bundlePigtail.connector_id} pigtail`
            : `${left}–${right}`
        } · ${members.length} cond.`,
        labelX,
        labelY,
        strokeWidth: 6 + members.length * 0.4,
        wireCount: members.length,
      })
    }

    const shieldGroups = groupBy(
      members,
      ({ wire }) => wire.shield_group?.trim() ?? '',
    )
    const pairHalfWidth = new Map<string, number>()
    const pairTube = new Map<string, Point[]>()
    for (const [shieldId, group] of shieldGroups) {
      // Foil/pair jackets follow the orthogonal trunk, not the braid samples,
      // so dashed outlines stay straight while the twist still draws inside.
      const entries = group.flatMap((row) => {
        const route =
          trunkByWireId.get(row.wire.wire_id) ??
          sceneWires.find((w) => w.id === row.wire.wire_id)?.points
        return route && route.length >= 2
          ? [{ route, reach: conductorReach(row.wire) }]
          : []
      })
      const envelope = buildShieldEnvelope(
        entries.map((entry) => entry.route),
        10,
        'pair',
        0,
        [],
        [],
        entries.map((entry) => entry.reach),
      )
      if (!envelope) continue
      pairHalfWidth.set(shieldId, envelope.halfWidth)
      pairTube.set(shieldId, envelope.tube)
      const pairId = `${id}::${shieldId}`
      sceneShields.push({
        id: pairId,
        points: envelope.tube,
        path: polylinePath(envelope.tube),
        outline: envelope.outline,
        outlinePath: polylinePath(envelope.outline),
        kind: 'pair',
      })
      linkShield(pairId, 'pair', envelope.outline, group, [endA, endB])
    }

    const overallGroups = groupBy(
      members,
      ({ wire }) => wire.overall_shield?.trim() ?? '',
    )
    for (const [overallId, group] of overallGroups) {
      // Outer jacket must follow Manhattan trunks — never braided wire points —
      // so the dashed outline stays straight instead of wavy.
      const trunks = group
        .map((row) => trunkByWireId.get(row.wire.wire_id))
        .filter((r): r is Point[] => !!r && r.length >= 2)
      const groupRoutes =
        trunks.length >= 1
          ? trunks
          : sceneWires
              .filter((w) => group.some((row) => row.wire.wire_id === w.id))
              .map((w) => w.points)
      let memberClearance = 0
      const memberTubes = new Map<string, Point[]>()
      for (const row of group) {
        const key = row.wire.shield_group?.trim() ?? ''
        const tubePts = key ? pairTube.get(key) : undefined
        if (key && tubePts) memberTubes.set(key, tubePts)
        const reach = key
          ? (pairHalfWidth.get(key) ?? 0)
          : conductorReach(row.wire)
        memberClearance = Math.max(memberClearance, reach)
      }
      const envelope = buildShieldEnvelope(
        groupRoutes,
        18,
        'overall',
        memberClearance,
        [...memberTubes.values()],
        sceneWires
          .filter((w) => group.some((row) => row.wire.wire_id === w.id))
          .flatMap((w) => [w.points[0]!, w.points[w.points.length - 1]!]),
      )
      if (!envelope) continue
      const overallShieldId = `${id}::overall::${overallId}`
      sceneShields.push({
        id: overallShieldId,
        points: envelope.tube,
        path: polylinePath(envelope.tube),
        outline: envelope.outline,
        outlinePath: polylinePath(envelope.outline),
        kind: 'overall',
      })
      linkShield(overallShieldId, 'overall', envelope.outline, group, [endA, endB])
    }
  }

  let stubIndex = 0
  for (const wire of unrouted) {
    const fromLayout = layout.byId.get(wire.from_connector)
    const toLayout = layout.byId.get(wire.to_connector)
    const from = findPin(fromLayout, wire.from_pin)
    const to = findPin(toLayout, wire.to_pin)
    const fallbackStart = {
      x: layout.minX + 48,
      y: layout.minY + 48 + stubIndex * 22,
    }
    const start = from
      ? { x: from.x, y: from.y }
      : fromLayout
        ? {
            x: fromLayout.x + fromLayout.width / 2,
            y: fromLayout.y + fromLayout.height + 16,
          }
        : fallbackStart
    const end = to
      ? { x: to.x, y: to.y }
      : toLayout
        ? {
            x: toLayout.x + toLayout.width / 2,
            y: toLayout.y + toLayout.height + 16,
          }
        : { x: start.x + 90, y: start.y }
    stubIndex += 1
    const points = dedupePoints([
      start,
      { x: (start.x + end.x) / 2, y: start.y },
      end,
    ])
    const labelPt = longestSegmentLabel(points)
    sceneWires.push({
      id: wire.wire_id || `unrouted-${stubIndex}`,
      points,
      path: polylinePath(points),
      color: '#dc2626',
      underStroke: false,
      error: true,
      dashed: true,
      bundleId: '',
      label: `ERROR ${wire.wire_id || 'wire'}`,
      labelX: labelPt.x,
      labelY: labelPt.y,
    })
  }

  const sceneConnectors: SceneConnector[] = layout.connectors
    .filter((c) => !isPigtailEndId(c.connector.connector_id))
    .map((c) => ({
      id: c.connector.connector_id,
      name: c.connector.connector_name,
      x: c.x,
      y: c.y,
      width: c.width,
      height: c.height,
      pins: c.pins.map((p) => ({
        pin: p.pin,
        signal: p.signal,
        x: p.x,
        y: p.y,
        labelX: p.labelX,
        labelY: p.labelY,
        signalX: p.signalX,
        signalAnchor: p.signalAnchor,
        error: options.duplicatePins.has(`${c.connector.connector_id}:${p.pin}`),
        shield:
          p.pin === SHIELD_PIN && hasShieldPin(c.connector),
      })),
    }))

  deoverlapLabels(sceneWires)

  const box = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  }
  for (const c of sceneConnectors) {
    expandBox(box, c.x, c.y)
    expandBox(box, c.x + c.width, c.y + c.height)
  }
  for (const w of sceneWires) {
    for (const p of w.points) expandBox(box, p.x, p.y, 8)
    if (w.label) expandBox(box, w.labelX, w.labelY, 24)
  }
  for (const s of sceneShields) {
    for (const p of s.outline) expandBox(box, p.x, p.y, 4)
  }
  for (const link of shieldLinks) {
    for (const p of link.points) expandBox(box, p.x, p.y, 4)
  }
  if (!Number.isFinite(box.minX)) {
    box.minX = 0
    box.minY = 0
    box.maxX = 900
    box.maxY = 600
  }

  const pad = 48
  const titleH = TITLE_BLOCK_H + 8
  const minX = box.minX - pad
  const minY = box.minY - pad
  const width = box.maxX - box.minX + pad * 2
  const height = box.maxY - box.minY + pad * 2 + titleH
  const meta = options.meta ?? DEFAULT_DRAWING_META
  const frame: SceneFrame = {
    x: minX + 12,
    y: minY + 12,
    width: width - 24,
    height: height - 24,
    title: meta.title || DEFAULT_DRAWING_META.title,
    drawingNumber: meta.drawingNumber,
    revision: meta.revision,
    date: meta.date,
    author: meta.author,
    notes: meta.notes,
    subtitle: `${connectors.length} connectors · ${wires.length} wires`,
  }

  return {
    layout,
    connectors: sceneConnectors,
    wires: sceneWires,
    bundles: sceneBundles,
    shields: sceneShields,
    shieldLinks,
    frame,
    minX,
    minY,
    width,
    height,
  }
}
