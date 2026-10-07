import { useEffect, useRef, type ReactNode } from 'react'
import { resolveWireColor } from '../colors'
import type { Connector, DrawingMeta, ValidationError, Wire } from '../types'
import { firstFreePin, firstFreePins } from '../validation'
import { Icon } from './icons'

function nextId(prefix: string, existing: string[]): string {
  const set = new Set(existing)
  let n = existing.length + 1
  while (set.has(`${prefix}${n}`)) n += 1
  return `${prefix}${n}`
}

function Cell({
  value,
  onChange,
  onFocus,
  type = 'text',
  error,
  title,
  boxed,
  mono,
  placeholder,
  ariaLabel,
}: {
  value: string | number
  onChange: (value: string) => void
  onFocus?: () => void
  type?: string
  error?: boolean
  title?: string
  boxed?: boolean
  mono?: boolean
  placeholder?: string
  ariaLabel?: string
}) {
  return (
    <input
      className={`field ${boxed ? 'field-boxed' : ''} ${mono ? 'font-mono' : ''} ${error ? 'field-error' : ''}`}
      type={type}
      title={title}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onFocus={onFocus}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

function SectionHeader({
  title,
  count,
  onAdd,
  addLabel,
}: {
  title: string
  count?: number
  onAdd?: () => void
  addLabel?: string
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <h2 className="eyebrow">{title}</h2>
        {count !== undefined ? (
          <span className="rounded-full bg-slate-100 px-1.5 py-px font-mono text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {count}
          </span>
        ) : null}
      </div>
      {onAdd ? (
        <button
          type="button"
          className="btn btn-sm"
          onClick={onAdd}
          aria-label={addLabel}
        >
          <Icon name="plus" size={13} />
          Add
        </button>
      ) : null}
    </div>
  )
}

function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={`sticky top-0 z-10 whitespace-nowrap bg-slate-50 px-1.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-900 dark:text-slate-400 ${className ?? ''}`}
    >
      {children}
    </th>
  )
}

function DeleteButton({
  label,
  onClick,
}: {
  label: string
  onClick: (event: React.MouseEvent) => void
}) {
  return (
    <button
      type="button"
      className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-400"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon name="trash" size={13} />
    </button>
  )
}

type WireColumn = {
  label: string
  width: number
  get: (wire: Wire) => string
  set: (value: string) => Partial<Wire>
  invalidates?: boolean
  mono?: boolean
  swatch?: boolean
}

const WIRE_COLUMNS: WireColumn[] = [
  { label: 'ID', width: 56, get: (w) => w.wire_id, set: (v) => ({ wire_id: v }), invalidates: true, mono: true },
  { label: 'From', width: 58, get: (w) => w.from_connector, set: (v) => ({ from_connector: v }), invalidates: true, mono: true },
  { label: 'Pin', width: 46, get: (w) => String(w.from_pin), set: (v) => ({ from_pin: v }), invalidates: true, mono: true },
  { label: 'To', width: 58, get: (w) => w.to_connector, set: (v) => ({ to_connector: v }), invalidates: true, mono: true },
  { label: 'Pin', width: 46, get: (w) => String(w.to_pin), set: (v) => ({ to_pin: v }), invalidates: true, mono: true },
  { label: 'Color', width: 92, get: (w) => w.wire_color, set: (v) => ({ wire_color: v }), swatch: true },
  { label: 'Signal', width: 84, get: (w) => w.signal_name ?? '', set: (v) => ({ signal_name: v || undefined }) },
  { label: 'Gauge', width: 76, get: (w) => w.gauge, set: (v) => ({ gauge: v }) },
  { label: 'Twist', width: 62, get: (w) => w.twist_group ?? '', set: (v) => ({ twist_group: v || undefined }) },
  { label: 'Shield', width: 62, get: (w) => w.shield_group ?? '', set: (v) => ({ shield_group: v || undefined }) },
  { label: 'Overall', width: 66, get: (w) => w.overall_shield ?? '', set: (v) => ({ overall_shield: v || undefined }) },
]

export function DataPanel({
  connectors,
  wires,
  meta,
  refErrors,
  duplicateWireIds,
  selectedConnectorId,
  focusedWireId,
  onMetaChange,
  onConnectorsChange,
  onWiresChange,
  onDatasetChange,
  onEditStart,
  onSelectConnector,
  onStatus,
}: {
  connectors: Connector[]
  wires: Wire[]
  meta: DrawingMeta
  refErrors: ValidationError[]
  duplicateWireIds: Set<string>
  selectedConnectorId: string | null
  focusedWireId: string | null
  onMetaChange: (meta: DrawingMeta) => void
  onConnectorsChange: (connectors: Connector[]) => void
  onWiresChange: (wires: Wire[]) => void
  onDatasetChange: (connectors: Connector[], wires: Wire[]) => void
  onEditStart: () => void
  onSelectConnector: (id: string) => void
  onStatus: (message: string) => void
}) {
  const wireErrorIds = new Set(
    refErrors.map((error) => error.wire_id).filter(Boolean) as string[],
  )
  const focusedRef = useRef<HTMLTableRowElement | null>(null)

  useEffect(() => {
    focusedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [focusedWireId, selectedConnectorId])

  function updateConnector(index: number, patch: Partial<Connector>) {
    const previous = connectors[index]
    if (!previous) return
    const nextConnectors = connectors.map((row, i) =>
      i === index ? { ...row, ...patch } : row,
    )
    if (
      patch.connector_id !== undefined &&
      patch.connector_id !== previous.connector_id
    ) {
      const oldId = previous.connector_id
      const newId = patch.connector_id
      onDatasetChange(
        nextConnectors,
        wires.map((wire) => ({
          ...wire,
          from_connector:
            wire.from_connector === oldId ? newId : wire.from_connector,
          to_connector: wire.to_connector === oldId ? newId : wire.to_connector,
        })),
      )
      return
    }
    onConnectorsChange(nextConnectors)
  }

  function updateWire(index: number, patch: Partial<Wire>) {
    onWiresChange(wires.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function addConnector() {
    onEditStart()
    onConnectorsChange([
      ...connectors,
      {
        connector_id: nextId(
          'J',
          connectors.map((c) => c.connector_id),
        ),
        connector_name: 'New connector',
        pin_count: 4,
      },
    ])
  }

  function addWire() {
    const from = connectors[0]
    const to = connectors[1] ?? connectors[0]
    const sameConnector = from && to && from.connector_id === to.connector_id
    const fromPin = sameConnector
      ? firstFreePins(from, wires, 2)[0]
      : firstFreePin(from, wires)
    const toPin = sameConnector
      ? firstFreePins(from, wires, 2)[1]
      : firstFreePin(to, wires)
    onEditStart()
    onWiresChange([
      ...wires,
      {
        wire_id: nextId(
          'W',
          wires.map((w) => w.wire_id),
        ),
        from_connector: from?.connector_id ?? '',
        from_pin: fromPin ?? '1',
        to_connector: to?.connector_id ?? '',
        to_pin: toPin ?? '1',
        wire_color: 'red',
        gauge: '22 AWG',
      },
    ])
  }

  const metaLabel = 'flex flex-col gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400'

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto bg-slate-50/60 p-3 dark:bg-slate-950/40">
      <section className="card p-3.5">
        <SectionHeader title="Drawing" />
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-2">
          <label className={`col-span-2 ${metaLabel}`}>
            Title
            <Cell
              boxed
              value={meta.title}
              onFocus={onEditStart}
              onChange={(value) => onMetaChange({ ...meta, title: value })}
            />
          </label>
          <label className={metaLabel}>
            Drawing no.
            <Cell
              boxed
              mono
              value={meta.drawingNumber}
              onFocus={onEditStart}
              onChange={(value) =>
                onMetaChange({ ...meta, drawingNumber: value })
              }
            />
          </label>
          <label className={metaLabel}>
            Revision
            <Cell
              boxed
              mono
              value={meta.revision}
              onFocus={onEditStart}
              onChange={(value) => onMetaChange({ ...meta, revision: value })}
            />
          </label>
          <label className={metaLabel}>
            Date
            <Cell
              boxed
              mono
              value={meta.date}
              onFocus={onEditStart}
              onChange={(value) => onMetaChange({ ...meta, date: value })}
            />
          </label>
          <label className={metaLabel}>
            Drawn by
            <Cell
              boxed
              value={meta.author}
              onFocus={onEditStart}
              onChange={(value) => onMetaChange({ ...meta, author: value })}
            />
          </label>
          <label className={`col-span-2 ${metaLabel}`}>
            Notes
            <Cell
              boxed
              value={meta.notes}
              onFocus={onEditStart}
              onChange={(value) => onMetaChange({ ...meta, notes: value })}
            />
          </label>
        </div>
      </section>

      <section className="card p-3.5">
        <SectionHeader
          title="Connectors"
          count={connectors.length}
          onAdd={addConnector}
          addLabel="Add connector"
        />
        {connectors.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center dark:border-slate-700">
            <Icon name="plug" size={20} className="text-slate-400" />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Add a connector or import a spreadsheet to start a drawing.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr>
                  <Th className="w-16 pl-2.5">ID</Th>
                  <Th>Name</Th>
                  <Th className="w-16">Pins</Th>
                  <Th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {connectors.map((row, index) => {
                  const selected = selectedConnectorId === row.connector_id
                  return (
                    <tr
                      key={`${row.connector_id}-${index}`}
                      ref={selected ? focusedRef : undefined}
                      className={`border-t border-slate-100 dark:border-slate-800 ${
                        selected
                          ? 'bg-blue-50/80 shadow-[inset_2px_0_0_0_var(--color-blue-600)] dark:bg-blue-500/10'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                      onClick={() => onSelectConnector(row.connector_id)}
                    >
                      <td className="py-1 pl-1.5 pr-0.5">
                        <Cell
                          mono
                          value={row.connector_id}
                          ariaLabel="Connector ID"
                          onFocus={onEditStart}
                          onChange={(value) =>
                            updateConnector(index, { connector_id: value })
                          }
                        />
                      </td>
                      <td className="px-0.5 py-1">
                        <Cell
                          value={row.connector_name}
                          ariaLabel="Connector name"
                          onFocus={onEditStart}
                          onChange={(value) =>
                            updateConnector(index, { connector_name: value })
                          }
                        />
                      </td>
                      <td className="px-0.5 py-1">
                        <Cell
                          mono
                          type="number"
                          value={row.pin_count}
                          ariaLabel="Pin count"
                          onFocus={onEditStart}
                          onChange={(value) => {
                            const n = Number(value)
                            updateConnector(index, {
                              pin_count: Number.isFinite(n) ? n : 0,
                            })
                          }}
                        />
                      </td>
                      <td className="py-1 pr-1.5 text-right">
                        <DeleteButton
                          label={`Delete connector ${row.connector_id}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            const id = row.connector_id
                            const removed = wires.filter(
                              (wire) =>
                                wire.from_connector === id ||
                                wire.to_connector === id,
                            )
                            onEditStart()
                            onDatasetChange(
                              connectors.filter((_, i) => i !== index),
                              wires.filter(
                                (wire) =>
                                  wire.from_connector !== id &&
                                  wire.to_connector !== id,
                              ),
                            )
                            onStatus(
                              removed.length
                                ? `Removed ${id} and ${removed.length} wire${removed.length === 1 ? '' : 's'}. Undo to restore.`
                                : `Removed ${id}.`,
                            )
                          }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-3.5">
        <SectionHeader
          title="Wires"
          count={wires.length}
          onAdd={addWire}
          addLabel="Add wire"
        />
        <div className="max-h-[28rem] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr>
                {WIRE_COLUMNS.map((column, i) => (
                  <Th
                    key={`${column.label}-${i}`}
                    className={i === 0 ? 'pl-2.5' : undefined}
                  >
                    {column.label}
                  </Th>
                ))}
                <Th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {wires.map((row, index) => {
                const error =
                  wireErrorIds.has(row.wire_id) ||
                  duplicateWireIds.has(row.wire_id)
                const focused = focusedWireId === row.wire_id
                return (
                  <tr
                    key={`${row.wire_id}-${index}`}
                    ref={focused ? focusedRef : undefined}
                    className={`border-t border-slate-100 dark:border-slate-800 ${
                      focused
                        ? 'bg-amber-50 dark:bg-amber-500/10'
                        : error
                          ? 'bg-red-50/50 dark:bg-red-950/20'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    {WIRE_COLUMNS.map((column, i) => (
                      <td
                        key={`${column.label}-${i}`}
                        className={`py-1 pr-0.5 ${i === 0 ? 'pl-1.5' : 'pl-0.5'}`}
                        style={{ minWidth: column.width }}
                      >
                        <div className="relative">
                          {column.swatch ? (
                            <span
                              className="pointer-events-none absolute left-1.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-black/15"
                              style={{ background: resolveWireColor(column.get(row)) }}
                            />
                          ) : null}
                          <input
                            className={`field ${column.mono ? 'font-mono' : ''} ${column.swatch ? 'pl-5' : ''} ${error && column.invalidates ? 'field-error' : ''}`}
                            aria-label={`${column.label} for ${row.wire_id}`}
                            value={column.get(row)}
                            onFocus={onEditStart}
                            onChange={(event) =>
                              updateWire(index, column.set(event.target.value))
                            }
                          />
                        </div>
                      </td>
                    ))}
                    <td className="py-1 pr-1.5 text-right">
                      <DeleteButton
                        label={`Delete wire ${row.wire_id}`}
                        onClick={() => {
                          onEditStart()
                          onWiresChange(wires.filter((_, i) => i !== index))
                        }}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
