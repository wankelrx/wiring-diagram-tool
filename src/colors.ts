const NAMED: Record<string, string> = {
  red: '#dc2626',
  black: '#171717',
  white: '#f4f4f5',
  green: '#16a34a',
  blue: '#2563eb',
  yellow: '#eab308',
  orange: '#ea580c',
  brown: '#92400e',
  gray: '#6b7280',
  grey: '#6b7280',
  pink: '#ec4899',
  violet: '#7c3aed',
  purple: '#7c3aed',
  tan: '#d6b48a',
  natural: '#e7e5e4',
  bare: '#a8a29e',
  drain: '#a8a29e',
  silver: '#c0c0c0',
  gold: '#d4a017',
  slate: '#475569',
}

export const FALLBACK_COLOR = '#64748b'

export function resolveWireColor(input: string): string {
  const raw = input.trim()
  if (!raw) return FALLBACK_COLOR
  if (raw.startsWith('#')) {
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
      const r = raw[1]
      const g = raw[2]
      const b = raw[3]
      return `#${r}${r}${g}${g}${b}${b}`
    }
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw
  }
  const first = raw.split(/[/+,]| then /i)[0]?.trim().toLowerCase() ?? raw.toLowerCase()
  return NAMED[first] ?? FALLBACK_COLOR
}

export function isKnownWireColor(input: string): boolean {
  const raw = input.trim()
  if (!raw) return false
  if (raw.startsWith('#')) {
    return /^#[0-9a-fA-F]{3}$/.test(raw) || /^#[0-9a-fA-F]{6}$/.test(raw)
  }
  return raw
    .split(/[/+,]| then /i)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .every((part) => part in NAMED)
}

export function isLightColor(hex: string): boolean {
  const value = hex.replace('#', '')
  if (value.length !== 6) return false
  const n = Number.parseInt(value, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  // Only near-white wires get a contrast understroke (not yellow/amber).
  return (r * 299 + g * 587 + b * 114) / 1000 > 220
}
