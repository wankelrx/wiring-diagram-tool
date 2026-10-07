import { useEffect, useMemo, useRef, useState } from 'react'
import { DataPanel } from './components/DataPanel'
import { DiagramCanvas } from './components/DiagramCanvas'
import { ErrorPanel } from './components/ErrorPanel'
import { Icon } from './components/icons'
import { PinoutPanel } from './components/PinoutPanel'
import { TopBar } from './components/TopBar'
import { sceneToDxf } from './diagram/dxf'
import { sceneToPdf } from './diagram/pdf'
import { themeFor, LIGHT_THEME } from './diagram/theme'
import { sceneToSvgString } from './diagram/svgString'
import { layoutExportDocument } from './diagram/exportDocument'
import { computeScene } from './diagram/scene'
import { DEFAULT_DRAWING_META, drawingFilename } from './documentMeta'
import {
  downloadDxf,
  downloadPdf,
  downloadPng,
  downloadSvg,
  downloadTemplate,
  exportWireListCsv,
  exportWireListXlsx,
  parseFiles,
} from './importExport'
import { SAMPLE_CONNECTORS, SAMPLE_WIRES } from './sampleData'
import { autoArrangeConnectors } from './autoArrange'
import { clearProject, loadProject, saveProject } from './storage'
import type { Connector, DrawingMeta, ValidationError, Wire } from './types'
import { validateDataset } from './validation'

type Snapshot = {
  connectors: Connector[]
  wires: Wire[]
  meta: DrawingMeta
}

const saved = loadProject()

export default function App() {
  const [connectors, setConnectors] = useState<Connector[]>(
    saved?.connectors ?? SAMPLE_CONNECTORS,
  )
  const [wires, setWires] = useState<Wire[]>(saved?.wires ?? SAMPLE_WIRES)
  const [meta, setMeta] = useState<DrawingMeta>(
    saved?.meta ?? DEFAULT_DRAWING_META,
  )
  const [history, setHistory] = useState<Snapshot[]>([])
  const [future, setFuture] = useState<Snapshot[]>([])
  const [showLabels, setShowLabels] = useState(saved?.showLabels ?? true)
  const [showCableIds, setShowCableIds] = useState(saved?.showCableIds ?? true)
  const [dark, setDark] = useState(saved?.dark ?? true)
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(
    saved ? (saved.connectors[0]?.connector_id ?? null) : 'J1',
  )
  const [hoveredConnectorId, setHoveredConnectorId] = useState<string | null>(
    null,
  )
  const [highlightedBundleId, setHighlightedBundleId] = useState<string | null>(
    null,
  )
  const [focusedWireId, setFocusedWireId] = useState<string | null>(null)
  const [rightOpen, setRightOpen] = useState(true)
  const [importErrors, setImportErrors] = useState<ValidationError[]>([])
  const [fitNonce, setFitNonce] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const [pendingExport, setPendingExport] = useState<null | (() => void)>(null)

  const theme = themeFor(dark)
  const validation = useMemo(
    () => validateDataset(connectors, wires),
    [connectors, wires],
  )
  const errorCount =
    importErrors.length +
    validation.refErrors.length +
    validation.duplicateErrors.length

  const snapshotRef = useRef<Snapshot>({ connectors, wires, meta })
  snapshotRef.current = { connectors, wires, meta }
  const historyRef = useRef(history)
  historyRef.current = history
  const futureRef = useRef(future)
  futureRef.current = future

  useEffect(() => {
    saveProject({
      connectors,
      wires,
      meta,
      dark,
      showLabels,
      showCableIds,
    })
  }, [connectors, wires, meta, dark, showLabels, showCableIds])

  function sameSnapshot(a: Snapshot, b: Snapshot) {
    return (
      a.connectors === b.connectors && a.wires === b.wires && a.meta === b.meta
    )
  }

  function checkpoint() {
    const current = snapshotRef.current
    setHistory((prev) => {
      const last = prev[prev.length - 1]
      if (last && sameSnapshot(last, current)) return prev
      return [...prev, current].slice(-50)
    })
    setFuture([])
  }

  function undo() {
    const previous = historyRef.current[historyRef.current.length - 1]
    if (!previous) return
    const current = snapshotRef.current
    setHistory((h) => h.slice(0, -1))
    setFuture((f) => [current, ...f].slice(0, 50))
    setConnectors(previous.connectors)
    setWires(previous.wires)
    setMeta(previous.meta)
  }

  function redo() {
    const next = futureRef.current[0]
    if (!next) return
    const current = snapshotRef.current
    setFuture((f) => f.slice(1))
    setHistory((h) => [...h, current].slice(-50))
    setConnectors(next.connectors)
    setWires(next.wires)
    setMeta(next.meta)
  }

  useEffect(() => {
    if (!status) return
    const timer = window.setTimeout(() => setStatus(null), 5000)
    return () => window.clearTimeout(timer)
  }, [status])

  const undoRef = useRef(undo)
  const redoRef = useRef(redo)
  undoRef.current = undo
  redoRef.current = redo

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') {
        return
      }
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        return
      }
      event.preventDefault()
      if (event.shiftKey) redoRef.current()
      else undoRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function onImport(files: FileList) {
    try {
      const parsed = await parseFiles([...files])
      checkpoint()
      if (parsed.connectors) setConnectors(parsed.connectors)
      if (parsed.wires) setWires(parsed.wires)
      setImportErrors(parsed.errors)
      setFitNonce((n) => n + 1)
      if (parsed.connectors?.[0]) {
        setSelectedConnectorId(parsed.connectors[0].connector_id)
      }
      setStatus('Imported spreadsheet.')
    } catch (error) {
      setImportErrors([
        {
          kind: 'import',
          message: `Import failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        },
      ])
    }
  }

  function exportScene() {
    const scene = computeScene(connectors, wires, {
      showLabels,
      showCableIds,
      duplicatePins: validation.duplicatePins,
      duplicateWireIds: validation.duplicateWireIds,
      errorWireIds: validation.errorWireIds,
      meta,
    })
    const doc = layoutExportDocument(scene, connectors, wires, meta)
    return {
      scene,
      doc,
      svg: sceneToSvgString(scene, LIGHT_THEME, doc),
    }
  }

  function requestExport(action: () => void) {
    if (validation.refErrors.length || validation.duplicateErrors.length) {
      setPendingExport(() => action)
      return
    }
    action()
  }

  function reportExportError(error: unknown) {
    setImportErrors([
      {
        kind: 'import',
        message: `Export failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      },
    ])
  }

  function resetSample() {
    checkpoint()
    clearProject()
    setConnectors(SAMPLE_CONNECTORS)
    setWires(SAMPLE_WIRES)
    setMeta(DEFAULT_DRAWING_META)
    setSelectedConnectorId('J1')
    setImportErrors([])
    setFitNonce((n) => n + 1)
    setStatus('Loaded sample harness.')
  }

  function newDiagram() {
    checkpoint()
    setConnectors([])
    setWires([])
    setMeta({
      ...DEFAULT_DRAWING_META,
      date: new Date().toLocaleDateString('en-CA'),
    })
    setSelectedConnectorId(null)
    setHoveredConnectorId(null)
    setHighlightedBundleId(null)
    setFocusedWireId(null)
    setImportErrors([])
    setPendingExport(null)
    setFitNonce((n) => n + 1)
    setStatus('Started a new diagram. Undo to get the previous one back.')
  }

  function arrangeConnectors() {
    checkpoint()
    setConnectors((current) => autoArrangeConnectors(current, wires))
    setFitNonce((n) => n + 1)
    setStatus('Connectors auto-arranged.')
  }

  const documentLabel =
    [meta.drawingNumber, meta.revision ? `Rev ${meta.revision}` : '']
      .filter(Boolean)
      .join(' · ') || 'Untitled drawing'

  return (
    <div className={dark ? 'dark h-full' : 'h-full'}>
      <div className="flex h-full flex-col bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <TopBar
          showLabels={showLabels}
          showCableIds={showCableIds}
          dark={dark}
          canUndo={history.length > 0}
          canRedo={future.length > 0}
          errorCount={errorCount}
          documentLabel={documentLabel}
          onShowLabels={setShowLabels}
          onShowCableIds={setShowCableIds}
          onDark={setDark}
          onImport={onImport}
          onTemplate={() => {
            void downloadTemplate().catch(reportExportError)
          }}
          onFit={() => setFitNonce((n) => n + 1)}
          onArrange={arrangeConnectors}
          onUndo={undo}
          onRedo={redo}
          onNew={newDiagram}
          onResetSample={resetSample}
          onExportSvg={() =>
            requestExport(() =>
              downloadSvg(exportScene().svg, drawingFilename(meta, 'svg')),
            )
          }
          onExportPng={() =>
            requestExport(() => {
              const { doc, svg } = exportScene()
              void downloadPng(
                svg,
                doc.width,
                doc.height,
                drawingFilename(meta, 'png'),
              ).catch(reportExportError)
            })
          }
          onExportPdf={() =>
            requestExport(() => {
              const { scene, doc } = exportScene()
              downloadPdf(
                sceneToPdf(scene, LIGHT_THEME, doc),
                drawingFilename(meta, 'pdf'),
              )
            })
          }
          onExportDxf={() =>
            requestExport(() => {
              const { scene, doc } = exportScene()
              downloadDxf(sceneToDxf(scene, doc), drawingFilename(meta, 'dxf'))
            })
          }
          onExportWireCsv={() =>
            exportWireListCsv(wires, drawingFilename(meta, 'csv'))
          }
          onExportWireXlsx={() => {
            void exportWireListXlsx(
              wires,
              drawingFilename(meta, 'xlsx'),
            ).catch(reportExportError)
          }}
        />
        {pendingExport ? (
          <div
            role="alert"
            className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
          >
            <Icon name="alert" size={15} className="shrink-0" />
            <span>
              This drawing has validation errors. Unrouted wires export as dashed
              ERROR stubs.
            </span>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setPendingExport(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => {
                  pendingExport()
                  setPendingExport(null)
                }}
              >
                Export anyway
              </button>
            </div>
          </div>
        ) : null}
        {status ? (
          <div
            role="status"
            className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center"
          >
            <div className="pointer-events-auto flex items-center gap-2.5 rounded-xl bg-slate-900 py-2 pl-3 pr-2 text-[13px] text-white shadow-float dark:bg-slate-100 dark:text-slate-900">
              <Icon name="check" size={15} className="text-emerald-400 dark:text-emerald-600" />
              <span>{status}</span>
              <button
                type="button"
                aria-label="Dismiss"
                className="flex h-6 w-6 items-center justify-center rounded-md text-slate-300 hover:bg-white/10 dark:text-slate-500 dark:hover:bg-black/10"
                onClick={() => setStatus(null)}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[440px] min-w-[300px] shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <DataPanel
              connectors={connectors}
              wires={wires}
              meta={meta}
              refErrors={validation.refErrors}
              duplicateWireIds={validation.duplicateWireIds}
              selectedConnectorId={selectedConnectorId}
              focusedWireId={focusedWireId}
              onMetaChange={setMeta}
              onConnectorsChange={setConnectors}
              onWiresChange={setWires}
              onDatasetChange={(nextConnectors, nextWires) => {
                setConnectors(nextConnectors)
                setWires(nextWires)
              }}
              onEditStart={checkpoint}
              onSelectConnector={setSelectedConnectorId}
              onStatus={setStatus}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <DiagramCanvas
                connectors={connectors}
                wires={wires}
                theme={theme}
                showLabels={showLabels}
                showCableIds={showCableIds}
                highlightedBundleId={highlightedBundleId}
                selectedConnectorId={selectedConnectorId}
                hoveredConnectorId={hoveredConnectorId}
                duplicatePins={validation.duplicatePins}
                duplicateWireIds={validation.duplicateWireIds}
                errorWireIds={validation.errorWireIds}
                fitNonce={fitNonce}
                meta={meta}
                onConnectorsChange={setConnectors}
                onSelectConnector={setSelectedConnectorId}
                onHoverConnector={setHoveredConnectorId}
                onHoverBundle={setHighlightedBundleId}
                onHistoryCheckpoint={checkpoint}
              />
            </div>
            <ErrorPanel
              importErrors={importErrors}
              refErrors={validation.refErrors}
              duplicateErrors={validation.duplicateErrors}
              warnings={validation.warnings}
              onSelectError={(error) => {
                if (error.connector_id) {
                  setSelectedConnectorId(error.connector_id)
                }
                setFocusedWireId(error.wire_id ?? null)
              }}
            />
          </div>
          <PinoutPanel
            connectors={connectors}
            wires={wires}
            selectedConnectorId={selectedConnectorId}
            hoveredConnectorId={hoveredConnectorId}
            open={rightOpen}
            onToggle={() => setRightOpen((open) => !open)}
          />
        </div>
      </div>
    </div>
  )
}
