import { DEFAULT_DRAWING_META } from './documentMeta'
import type { Connector, DrawingMeta, Wire } from './types'

export const STORAGE_KEY = 'wiring-diagram-tool:v1'
const BACKUP_KEY = 'wiring-diagram-tool:backups:v1'
const MAX_BACKUPS = 12
const PROJECT_FORMAT = 'wiring-diagram-tool'

export type PersistedProject = {
  connectors: Connector[]
  wires: Wire[]
  meta: DrawingMeta
  dark: boolean
  showLabels: boolean
  showCableIds: boolean
}

export type Backup = {
  savedAt: number
  project: PersistedProject
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

/** Validates untrusted data (storage, project file) into a project, or null. */
export function parseProject(value: unknown): PersistedProject | null {
  if (!value || typeof value !== 'object') return null
  const parsed = value as Partial<PersistedProject>
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
}

export function parseProjectText(text: string): PersistedProject | null {
  try {
    return parseProject(JSON.parse(text))
  } catch {
    return null
  }
}

/** The drawing itself, without view preferences. */
export function projectContent(project: PersistedProject): string {
  return JSON.stringify([project.connectors, project.wires, project.meta])
}

export function loadProject(): PersistedProject | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? parseProjectText(raw) : null
  } catch {
    return null
  }
}

export function saveProject(project: PersistedProject): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project))
    return true
  } catch {
    // Quota or private mode — editing still works in memory.
    return false
  }
}

export function clearProject() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

/** Contents of a downloadable project file (reopen with Import). */
export function serializeProjectFile(project: PersistedProject): string {
  return JSON.stringify(
    {
      format: PROJECT_FORMAT,
      version: 1,
      savedAt: new Date().toISOString(),
      ...project,
    },
    null,
    2,
  )
}

export function listBackups(): Backup[] {
  try {
    const raw = localStorage.getItem(BACKUP_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: Backup[] = []
    for (const entry of parsed) {
      const savedAt = Number((entry as Backup)?.savedAt)
      const project = parseProject((entry as Backup)?.project)
      if (Number.isFinite(savedAt) && project) out.push({ savedAt, project })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Keeps a timestamped copy of a drawing so work survives a conflicting tab or a
 * mistaken reset. Identical-to-newest copies are skipped; returns the list.
 */
export function addBackup(project: PersistedProject, now = Date.now()): Backup[] {
  const existing = listBackups()
  const newest = existing[0]
  if (newest && projectContent(newest.project) === projectContent(project)) {
    return existing
  }
  if (!project.connectors.length && !project.wires.length) return existing
  let next = [{ savedAt: now, project }, ...existing].slice(0, MAX_BACKUPS)
  while (next.length) {
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(next))
      return next
    } catch {
      next = next.slice(0, -1)
    }
  }
  return existing
}
