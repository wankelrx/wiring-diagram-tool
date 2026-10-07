import { DEFAULT_DRAWING_META } from './documentMeta'
import type { Connector, DrawingMeta, Wire } from './types'

const KEY = 'wiring-diagram-tool:v1'

export type PersistedProject = {
  connectors: Connector[]
  wires: Wire[]
  meta: DrawingMeta
  dark: boolean
  showLabels: boolean
  showCableIds: boolean
}

function isConnector(value: unknown): value is Connector {
  if (!value || typeof value !== 'object') return false
  const row = value as Connector
  return typeof row.connector_id === 'string' && typeof row.connector_name === 'string'
}

function isWire(value: unknown): value is Wire {
  if (!value || typeof value !== 'object') return false
  const row = value as Wire
  return typeof row.wire_id === 'string' && typeof row.from_connector === 'string'
}

export function loadProject(): PersistedProject | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedProject>
    if (!Array.isArray(parsed.connectors) || !parsed.connectors.every(isConnector)) {
      return null
    }
    if (!Array.isArray(parsed.wires) || !parsed.wires.every(isWire)) {
      return null
    }
    return {
      connectors: parsed.connectors,
      wires: parsed.wires,
      meta: { ...DEFAULT_DRAWING_META, ...parsed.meta },
      dark: typeof parsed.dark === 'boolean' ? parsed.dark : true,
      showLabels: parsed.showLabels !== false,
      showCableIds: parsed.showCableIds !== false,
    }
  } catch {
    return null
  }
}

export function saveProject(project: PersistedProject) {
  try {
    localStorage.setItem(KEY, JSON.stringify(project))
  } catch {
    // Quota or private mode — editing still works in memory.
  }
}

export function clearProject() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
