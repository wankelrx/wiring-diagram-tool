import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './icons'

type ButtonProps = {
  icon?: IconName
  children?: ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
  label?: string
  variant?: 'default' | 'ghost'
}

function ToolbarButton({
  icon,
  children,
  onClick,
  disabled,
  title,
  label,
  variant = 'default',
}: ButtonProps) {
  const iconOnly = !children
  return (
    <button
      type="button"
      title={title}
      aria-label={label ?? (typeof children === 'string' ? children : title)}
      onClick={onClick}
      disabled={disabled}
      className={`btn ${variant === 'ghost' ? 'btn-ghost' : ''} ${iconOnly ? 'btn-icon' : ''}`}
    >
      {icon ? <Icon name={icon} size={15} /> : null}
      {children}
    </button>
  )
}

function Toggle({
  active,
  onChange,
  title,
  icon,
  children,
}: {
  active: boolean
  onChange: (value: boolean) => void
  title?: string
  icon: IconName
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={() => onChange(!active)}
      className="chip-toggle"
    >
      <Icon name={icon} size={13} />
      {children}
    </button>
  )
}

function Divider() {
  return (
    <div
      className="mx-1 hidden h-5 w-px bg-slate-200 sm:block dark:bg-slate-700"
      aria-hidden="true"
    />
  )
}

function MenuItem({
  onClick,
  hint,
  children,
}: {
  onClick: () => void
  hint?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full items-center justify-between gap-6 rounded-md px-2.5 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700/70"
      onClick={onClick}
    >
      <span>{children}</span>
      {hint ? (
        <span className="font-mono text-[10px] uppercase text-slate-400">
          {hint}
        </span>
      ) : null}
    </button>
  )
}

export function TopBar({
  showLabels,
  showCableIds,
  dark,
  canUndo,
  canRedo,
  errorCount,
  documentLabel,
  onShowLabels,
  onShowCableIds,
  onDark,
  onImport,
  onTemplate,
  onFit,
  onArrange,
  onUndo,
  onRedo,
  onNew,
  onResetSample,
  onExportSvg,
  onExportPng,
  onExportPdf,
  onExportDxf,
  onExportWireCsv,
  onExportWireXlsx,
}: {
  showLabels: boolean
  showCableIds: boolean
  dark: boolean
  canUndo: boolean
  canRedo: boolean
  errorCount: number
  documentLabel: string
  onShowLabels: (value: boolean) => void
  onShowCableIds: (value: boolean) => void
  onDark: (value: boolean) => void
  onImport: (files: FileList) => void
  onTemplate: () => void
  onFit: () => void
  onArrange: () => void
  onUndo: () => void
  onRedo: () => void
  onNew: () => void
  onResetSample: () => void
  onExportSvg: () => void
  onExportPng: () => void
  onExportPdf: () => void
  onExportDxf: () => void
  onExportWireCsv: () => void
  onExportWireXlsx: () => void
}) {
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!exportOpen) return
    const onDoc = (event: MouseEvent) => {
      if (!exportRef.current?.contains(event.target as Node)) {
        setExportOpen(false)
      }
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExportOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEscape)
    }
  }, [exportOpen])

  function run(action: () => void) {
    setExportOpen(false)
    action()
  }

  return (
    <header className="z-20 flex h-14 shrink-0 items-center gap-1.5 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mr-3 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white shadow-xs dark:bg-blue-500">
          <Icon name="cable" size={18} />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Wiring Diagram
          </div>
          <div className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
            {documentLabel}
          </div>
        </div>
      </div>

      <Divider />

      <ToolbarButton
        icon="plus"
        onClick={onNew}
        title="Start a blank diagram (undo restores the current one)"
      >
        New
      </ToolbarButton>

      <label className="cursor-pointer" title="Import a wire list (.xlsx or .csv)">
        <span className="btn">
          <Icon name="upload" size={15} />
          Import
        </span>
        <input
          type="file"
          accept=".xlsx,.csv"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) onImport(event.target.files)
            event.target.value = ''
          }}
        />
      </label>

      <div className="relative" ref={exportRef}>
        <button
          type="button"
          className="btn btn-primary"
          aria-haspopup="menu"
          aria-expanded={exportOpen}
          title="Export drawing and wire list"
          onClick={() => setExportOpen((open) => !open)}
        >
          <Icon name="download" size={15} />
          Export
          <Icon name="chevronDown" size={13} className="-mr-0.5 opacity-80" />
        </button>
        {exportOpen ? (
          <div
            role="menu"
            className="card absolute left-0 top-full z-30 mt-1.5 w-56 p-1 shadow-float"
          >
            <div className="eyebrow px-2.5 pb-1 pt-1.5">Drawing</div>
            <MenuItem hint="pdf" onClick={() => run(onExportPdf)}>
              Print sheet
            </MenuItem>
            <MenuItem hint="svg" onClick={() => run(onExportSvg)}>
              Vector image
            </MenuItem>
            <MenuItem hint="png" onClick={() => run(onExportPng)}>
              Raster image
            </MenuItem>
            <MenuItem hint="dxf" onClick={() => run(onExportDxf)}>
              CAD drawing
            </MenuItem>
            <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
            <div className="eyebrow px-2.5 pb-1 pt-1.5">Wire list</div>
            <MenuItem hint="csv" onClick={() => run(onExportWireCsv)}>
              Spreadsheet (CSV)
            </MenuItem>
            <MenuItem hint="xlsx" onClick={() => run(onExportWireXlsx)}>
              Workbook (Excel)
            </MenuItem>
          </div>
        ) : null}
      </div>

      <ToolbarButton
        icon="file"
        onClick={onTemplate}
        title="Download a blank spreadsheet template"
        variant="ghost"
      >
        Template
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        icon="undo"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (Ctrl/Cmd+Z)"
        label="Undo"
      />
      <ToolbarButton
        icon="redo"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (Shift+Ctrl/Cmd+Z)"
        label="Redo"
      />

      <Divider />

      <ToolbarButton
        icon="arrange"
        onClick={onArrange}
        title="Auto-arrange connectors to reduce wire crossings"
      >
        Arrange
      </ToolbarButton>
      <ToolbarButton
        icon="fit"
        onClick={onFit}
        title="Fit drawing to view (F)"
        label="Fit"
      />
      <ToolbarButton
        icon="sample"
        onClick={onResetSample}
        title="Replace the drawing with the sample harness"
        variant="ghost"
      >
        Sample
      </ToolbarButton>

      <div className="ml-auto flex items-center gap-2">
        {errorCount > 0 ? (
          <span
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 text-xs font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
            title="See the issues list under the canvas"
          >
            <Icon name="alert" size={13} />
            {errorCount} issue{errorCount === 1 ? '' : 's'}
          </span>
        ) : null}
        <Toggle
          active={showLabels}
          onChange={onShowLabels}
          title="Show wire labels"
          icon="tag"
        >
          Labels
        </Toggle>
        <Toggle
          active={showCableIds}
          onChange={onShowCableIds}
          title="Show cable/bundle IDs"
          icon="hash"
        >
          Cable IDs
        </Toggle>
        <Divider />
        <button
          type="button"
          className="btn btn-icon btn-ghost"
          aria-pressed={dark}
          aria-label="Dark theme"
          title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={() => onDark(!dark)}
        >
          <Icon name={dark ? 'sun' : 'moon'} size={16} />
        </button>
      </div>
    </header>
  )
}
