import type { Connector, Wire } from '../types'
import { pinoutRows } from '../validation'
import { resolveWireColor } from '../colors'
import { Icon } from './icons'

export function PinoutPanel({
  connectors,
  wires,
  selectedConnectorId,
  hoveredConnectorId,
  open,
  onToggle,
}: {
  connectors: Connector[]
  wires: Wire[]
  selectedConnectorId: string | null
  hoveredConnectorId: string | null
  open: boolean
  onToggle: () => void
}) {
  const activeId = hoveredConnectorId ?? selectedConnectorId
  const connector = connectors.find((c) => c.connector_id === activeId)
  const rows = connector ? pinoutRows(connector, wires) : []
  const used = rows.filter((row) => row.signal || row.mates !== '-').length

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-l border-slate-200 bg-white transition-[width] duration-200 dark:border-slate-800 dark:bg-slate-900 ${
        open ? 'w-80' : 'w-11'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? 'Collapse pinout' : 'Expand pinout'}
        title={open ? 'Collapse pinout' : 'Expand pinout'}
        className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-200 px-3.5 text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100"
      >
        {open ? (
          <>
            <Icon name="plug" size={15} />
            <span className="eyebrow">Pinout</span>
            <Icon name="chevronRight" size={15} className="ml-auto" />
          </>
        ) : (
          <Icon name="chevronLeft" size={15} />
        )}
      </button>
      {open ? (
        <div className="flex-1 overflow-auto p-3.5">
          {connector ? (
            <>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
                    {connector.connector_name}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {used} of {rows.length} pins wired
                  </div>
                </div>
                <span className="shrink-0 rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-medium text-white dark:bg-slate-700">
                  {connector.connector_id}
                </span>
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                      <th className="px-2 py-1.5 font-semibold">Pin</th>
                      <th className="px-2 py-1.5 font-semibold">Signal</th>
                      <th className="px-2 py-1.5 font-semibold">Wire</th>
                      <th className="px-2 py-1.5 font-semibold">Mate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.pin}
                        className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                      >
                        <td className="px-2 py-1.5 font-mono font-medium text-slate-900 dark:text-slate-100">
                          {row.pin}
                        </td>
                        <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">
                          {row.signal || (
                            <span className="text-slate-300 dark:text-slate-600">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {row.color !== '-' ? (
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-600 dark:text-slate-300">
                              <span
                                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/15"
                                style={{
                                  background: resolveWireColor(
                                    row.color.split(',')[0] ?? row.color,
                                  ),
                                }}
                              />
                              {row.color}
                              <span className="text-slate-400">·</span>
                              {row.gauge}
                            </span>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {row.mates && row.mates !== '-' ? (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                              {row.mates}
                            </span>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600">
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
                <Icon name="pointer" size={18} />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Select or hover a connector to see its pinout.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </aside>
  )
}
