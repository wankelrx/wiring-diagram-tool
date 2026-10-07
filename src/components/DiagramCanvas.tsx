import { useEffect, useMemo, useRef, useState } from 'react'
import type { Connector, DiagramTheme, DrawingMeta, Wire } from '../types'
import { DiagramSvg } from '../diagram/render'
import { computeScene } from '../diagram/scene'
import { Icon } from './icons'

const GRID = 24

type DragState =
  | { kind: 'pan'; lastX: number; lastY: number }
  | {
      kind: 'connector'
      id: string
      startX: number
      startY: number
      origX: number
      origY: number
    }

export function DiagramCanvas({
  connectors,
  wires,
  theme,
  showLabels,
  showCableIds,
  highlightedBundleId,
  selectedConnectorId,
  hoveredConnectorId,
  duplicatePins,
  duplicateWireIds,
  errorWireIds,
  fitNonce,
  meta,
  onConnectorsChange,
  onSelectConnector,
  onHoverConnector,
  onHoverBundle,
  onHistoryCheckpoint,
}: {
  connectors: Connector[]
  wires: Wire[]
  theme: DiagramTheme
  showLabels: boolean
  showCableIds: boolean
  highlightedBundleId: string | null
  selectedConnectorId: string | null
  hoveredConnectorId: string | null
  duplicatePins: Set<string>
  duplicateWireIds: Set<string>
  errorWireIds: Set<string>
  fitNonce: number
  meta: DrawingMeta
  onConnectorsChange: (connectors: Connector[]) => void
  onSelectConnector: (id: string) => void
  onHoverConnector: (id: string | null) => void
  onHoverBundle: (id: string | null) => void
  onHistoryCheckpoint: () => void
}) {
  const scene = useMemo(
    () =>
      computeScene(connectors, wires, {
        showLabels,
        showCableIds,
        duplicatePins,
        duplicateWireIds,
        errorWireIds,
        meta,
      }),
    [
      connectors,
      wires,
      showLabels,
      showCableIds,
      duplicatePins,
      duplicateWireIds,
      errorWireIds,
      meta,
    ],
  )

  const sceneRef = useRef(scene)
  sceneRef.current = scene

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const panRef = useRef(pan)
  const zoomRef = useRef(zoom)
  panRef.current = pan
  zoomRef.current = zoom
  const hoverConnectorRef = useRef<string | null>(null)
  const hoverBundleRef = useRef<string | null>(null)

  const dragRef = useRef<DragState | null>(null)
  const connectorsRef = useRef(connectors)
  connectorsRef.current = connectors
  const onConnectorsChangeRef = useRef(onConnectorsChange)
  onConnectorsChangeRef.current = onConnectorsChange
  const onSelectConnectorRef = useRef(onSelectConnector)
  onSelectConnectorRef.current = onSelectConnector
  const onHoverConnectorRef = useRef(onHoverConnector)
  onHoverConnectorRef.current = onHoverConnector
  const onHoverBundleRef = useRef(onHoverBundle)
  onHoverBundleRef.current = onHoverBundle
  const onHistoryCheckpointRef = useRef(onHistoryCheckpoint)
  onHistoryCheckpointRef.current = onHistoryCheckpoint

  function fitToView() {
    const wrap = wrapRef.current
    const current = sceneRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    if (rect.width < 10 || rect.height < 10) return
    const scale =
      Math.min(
        rect.width / Math.max(current.width, 1),
        rect.height / Math.max(current.height, 1),
        1.4,
      ) * 0.92
    setZoom(scale)
    setPan({
      x: rect.width / 2 - (current.minX + current.width / 2) * scale,
      y: rect.height / 2 - (current.minY + current.height / 2) * scale,
    })
  }

  useEffect(() => {
    let frames = 0
    let frame = 0
    const run = () => {
      fitToView()
      frames += 1
      if (frames < 4) frame = requestAnimationFrame(run)
    }
    frame = requestAnimationFrame(run)
    return () => cancelAnimationFrame(frame)
  }, [fitNonce])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const worldPoint = (clientX: number, clientY: number) => {
      const rect = wrap.getBoundingClientRect()
      return {
        x: (clientX - rect.left - panRef.current.x) / zoomRef.current,
        y: (clientY - rect.top - panRef.current.y) / zoomRef.current,
      }
    }

    const hitConnector = (clientX: number, clientY: number) => {
      const pt = worldPoint(clientX, clientY)
      return sceneRef.current.connectors.find(
        (connector) =>
          pt.x >= connector.x &&
          pt.x <= connector.x + connector.width &&
          pt.y >= connector.y &&
          pt.y <= connector.y + connector.height,
      )
    }

    const hitBundle = (clientX: number, clientY: number) => {
      const pt = worldPoint(clientX, clientY)
      return sceneRef.current.bundles.find(
        (bundle) =>
          pt.x >= bundle.labelX - 64 &&
          pt.x <= bundle.labelX + 64 &&
          pt.y >= bundle.labelY - 11 &&
          pt.y <= bundle.labelY + 5,
      )
    }

    const zoomAt = (clientX: number, clientY: number, next: number) => {
      const rect = wrap.getBoundingClientRect()
      const mx = clientX - rect.left
      const my = clientY - rect.top
      const prev = zoomRef.current
      const clamped = Math.min(4, Math.max(0.15, next))
      setZoom(clamped)
      setPan({
        x: mx - ((mx - panRef.current.x) / prev) * clamped,
        y: my - ((my - panRef.current.y) / prev) * clamped,
      })
    }

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement | null
      if (target?.closest('button')) return
      event.preventDefault()
      wrap.focus()
      const hit = hitConnector(event.clientX, event.clientY)
      if (hit) {
        onHistoryCheckpointRef.current()
        dragRef.current = {
          kind: 'connector',
          id: hit.id,
          startX: event.clientX,
          startY: event.clientY,
          origX: hit.x,
          origY: hit.y,
        }
        onSelectConnectorRef.current(hit.id)
      } else {
        dragRef.current = {
          kind: 'pan',
          lastX: event.clientX,
          lastY: event.clientY,
        }
      }
      wrap.setPointerCapture(event.pointerId)
      wrap.style.cursor = 'grabbing'
    }

    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) {
        const connector = hitConnector(event.clientX, event.clientY)
        const bundle = hitBundle(event.clientX, event.clientY)
        const nextConnector = connector?.id ?? null
        const nextBundle = bundle?.id ?? null
        if (hoverConnectorRef.current !== nextConnector) {
          hoverConnectorRef.current = nextConnector
          onHoverConnectorRef.current(nextConnector)
        }
        if (hoverBundleRef.current !== nextBundle) {
          hoverBundleRef.current = nextBundle
          onHoverBundleRef.current(nextBundle)
        }
        wrap.style.cursor = connector ? 'move' : 'grab'
        return
      }
      if (drag.kind === 'pan') {
        const dx = event.clientX - drag.lastX
        const dy = event.clientY - drag.lastY
        drag.lastX = event.clientX
        drag.lastY = event.clientY
        setPan((p) => ({ x: p.x + dx, y: p.y + dy }))
        return
      }
      const scale = zoomRef.current || 1
      const dx = (event.clientX - drag.startX) / scale
      const dy = (event.clientY - drag.startY) / scale
      const grid = event.shiftKey ? 1 : 16
      const snap = (value: number) => Math.round(value / grid) * grid
      onConnectorsChangeRef.current(
        connectorsRef.current.map((connector) =>
          connector.connector_id === drag.id
            ? {
                ...connector,
                position_x: snap(drag.origX + dx),
                position_y: snap(drag.origY + dy),
              }
            : connector,
        ),
      )
    }

    const onUp = (event: PointerEvent) => {
      dragRef.current = null
      wrap.style.cursor = 'grab'
      if (wrap.hasPointerCapture(event.pointerId)) {
        wrap.releasePointerCapture(event.pointerId)
      }
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const factor = event.deltaY > 0 ? 0.92 : 1.08
      zoomAt(event.clientX, event.clientY, zoomRef.current * factor)
    }

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        return
      }
      if (event.key === '=' || event.key === '+') {
        event.preventDefault()
        const rect = wrap.getBoundingClientRect()
        zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, zoomRef.current * 1.12)
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        const rect = wrap.getBoundingClientRect()
        zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, zoomRef.current * 0.9)
      } else if (event.key === '0' || event.key.toLowerCase() === 'f') {
        event.preventDefault()
        fitToView()
      }
    }

    wrap.addEventListener('pointerdown', onDown)
    wrap.addEventListener('pointermove', onMove)
    wrap.addEventListener('pointerup', onUp)
    wrap.addEventListener('pointercancel', onUp)
    wrap.addEventListener('wheel', onWheel, { passive: false })
    wrap.addEventListener('keydown', onKey)
    return () => {
      wrap.removeEventListener('pointerdown', onDown)
      wrap.removeEventListener('pointermove', onMove)
      wrap.removeEventListener('pointerup', onUp)
      wrap.removeEventListener('pointercancel', onUp)
      wrap.removeEventListener('wheel', onWheel)
      wrap.removeEventListener('keydown', onKey)
    }
  }, [])

  function zoomCenter(factor: number) {
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const mx = rect.width / 2
    const my = rect.height / 2
    const prev = zoomRef.current
    const next = Math.min(4, Math.max(0.15, prev * factor))
    setZoom(next)
    setPan({
      x: mx - ((mx - panRef.current.x) / prev) * next,
      y: my - ((my - panRef.current.y) / prev) * next,
    })
  }

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      className="relative h-full min-h-0 w-full overflow-hidden outline-none"
      style={{
        background: theme.background,
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(color-mix(in srgb, ${theme.mutedText} 28%, transparent) 1px, transparent 1.2px)`,
          backgroundSize: `${GRID * zoom}px ${GRID * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      />
      {connectors.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-8 text-center">
          <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Nothing to draw yet
          </div>
          <div className="max-w-xs text-xs text-slate-500 dark:text-slate-400">
            Add a connector or import a spreadsheet to start a drawing.
          </div>
        </div>
      ) : (
        <svg
          className="relative block h-full w-full"
          style={{ pointerEvents: 'none' }}
        >
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            <DiagramSvg
              scene={scene}
              theme={theme}
              overlay={{
                selectedConnectorId,
                hoveredConnectorId,
                highlightedBundleId,
              }}
            />
          </g>
        </svg>
      )}
      <div
        className="card absolute bottom-4 right-4 flex items-center gap-0.5 p-1 shadow-float"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="btn btn-icon btn-ghost btn-sm"
          aria-label="Zoom out"
          title="Zoom out (−)"
          onClick={() => zoomCenter(0.9)}
        >
          <Icon name="minus" size={14} />
        </button>
        <span
          className="min-w-12 text-center font-mono text-[11px] text-slate-600 dark:text-slate-300"
          aria-live="polite"
        >
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className="btn btn-icon btn-ghost btn-sm"
          aria-label="Zoom in"
          title="Zoom in (+)"
          onClick={() => zoomCenter(1.12)}
        >
          <Icon name="plus" size={14} />
        </button>
        <div
          className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-700"
          aria-hidden="true"
        />
        <button
          type="button"
          className="btn btn-icon btn-ghost btn-sm"
          aria-label="Fit to view"
          title="Fit to view (F)"
          onClick={fitToView}
        >
          <Icon name="fit" size={14} />
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-4 left-4 hidden items-center gap-3 text-[11px] text-slate-500 md:flex dark:text-slate-400">
        <span>
          <span className="kbd">Drag</span> connector to move
        </span>
        <span>
          <span className="kbd">Scroll</span> to zoom
        </span>
        <span>
          <span className="kbd">Shift</span> fine snap
        </span>
      </div>
    </div>
  )
}
