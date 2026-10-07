import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DRAWING_META } from './documentMeta'
import { inferConnectors, parseFiles, parseSheets } from './importExport'
import {
  addBackup,
  listBackups,
  loadProject,
  parseProjectText,
  saveProject,
  serializeProjectFile,
  type PersistedProject,
} from './storage'
import type { Wire } from './types'

class MemoryStorage {
  private data = new Map<string, string>()
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.data.set(key, value)
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
}

const project = (id = 'J1', extra: Partial<PersistedProject> = {}): PersistedProject => ({
  connectors: [
    { connector_id: id, connector_name: 'Main', pin_count: 4, position_x: 10, position_y: 20, pigtail: true, pigtail_length: 140, shield_to_body: true },
  ],
  wires: [
    { wire_id: 'W1', from_connector: id, from_pin: '1', to_connector: '', to_pin: '', wire_color: 'red', gauge: '22 AWG', shield_pin: '3' },
  ],
  meta: { ...DEFAULT_DRAWING_META, title: 'My harness', revision: 'C' },
  dark: false,
  showLabels: true,
  showCableIds: false,
  ...extra,
})

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
})

describe('project persistence', () => {
  it('round-trips a project file without losing anything', () => {
    const original = project()
    expect(parseProjectText(serializeProjectFile(original))).toEqual(original)
  })

  it('rejects files that are not projects', () => {
    expect(parseProjectText('{"hello":1}')).toBeNull()
    expect(parseProjectText('not json')).toBeNull()
  })

  it('saves and loads from local storage', () => {
    saveProject(project())
    expect(loadProject()).toEqual(project())
  })

  it('keeps distinct backups newest first and skips duplicates and empty drawings', () => {
    addBackup(project('A'), 1)
    addBackup(project('A'), 2)
    addBackup(project('B'), 3)
    addBackup({ ...project('C'), connectors: [], wires: [] }, 4)
    const backups = listBackups()
    expect(backups.map((b) => b.project.connectors[0]?.connector_id)).toEqual(['B', 'A'])
    expect(backups[0]!.savedAt).toBe(3)
  })

  it('caps the number of backups', () => {
    for (let i = 0; i < 30; i++) addBackup(project(`C${i}`), i)
    expect(listBackups().length).toBeLessThanOrEqual(12)
    expect(listBackups()[0]!.project.connectors[0]!.connector_id).toBe('C29')
  })
})

describe('reopening saved work', () => {
  it('imports a project JSON file including title block', async () => {
    const file = new File([serializeProjectFile(project())], 'p.json', {
      type: 'application/json',
    })
    const parsed = await parseFiles([file])
    expect(parsed.errors).toEqual([])
    expect(parsed.connectors?.[0]).toMatchObject({ pigtail_length: 140, shield_to_body: true })
    expect(parsed.wires?.[0]?.shield_pin).toBe('3')
    expect(parsed.meta?.revision).toBe('C')
  })

  it('reads the Drawing sheet of a project workbook', () => {
    const parsed = parseSheets([
      { name: 'Connectors', rows: [['connector_id', 'connector_name', 'pin_count', 'shield_to_body'], ['J1', 'Main', 4, 'yes']] },
      { name: 'Wires', rows: [['wire_id', 'from_connector', 'from_pin'], ['W1', 'J1', '1']] },
      { name: 'Drawing', rows: [['title', 'T'], ['revision', 'B'], ['drawingNumber', 'D-1']] },
    ])
    expect(parsed.meta).toMatchObject({ title: 'T', revision: 'B', drawingNumber: 'D-1' })
    expect(parsed.connectors?.[0]?.shield_to_body).toBe(true)
  })

  it('rebuilds connectors from a wire-only list', () => {
    const wires: Wire[] = [
      { wire_id: 'W1', from_connector: 'J1', from_pin: '3', to_connector: 'J2', to_pin: '7', wire_color: 'red', gauge: '' },
      { wire_id: 'W2', from_connector: 'J1', from_pin: '5', to_connector: '', to_pin: '', wire_color: 'red', gauge: '' },
    ]
    const made = inferConnectors(wires, [])
    expect(made.map((c) => [c.connector_id, c.pin_count])).toEqual([
      ['J1', 5],
      ['J2', 7],
    ])
    expect(inferConnectors(wires, made)).toEqual([])
  })
})
