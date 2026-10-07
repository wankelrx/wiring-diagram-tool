import type { DiagramTheme } from '../types'

export const LIGHT_THEME: DiagramTheme = {
  background: '#f8fafc',
  connectorFill: '#ffffff',
  connectorStroke: '#334155',
  headerFill: '#e2e8f0',
  text: '#0f172a',
  mutedText: '#475569',
  pinFill: '#f8fafc',
  pinStroke: '#334155',
  shieldStroke: '#64748b',
  overallShieldStroke: '#0f766e',
  bundleFill: '#94a3b8',
  bundleStroke: '#334155',
  bundleLabel: '#0f172a',
  error: '#dc2626',
  ground: '#334155',
  labelBg: '#ffffff',
  frameStroke: '#0f172a',
}

export const DARK_THEME: DiagramTheme = {
  background: '#0b1220',
  connectorFill: '#1e293b',
  connectorStroke: '#94a3b8',
  headerFill: '#334155',
  text: '#f8fafc',
  mutedText: '#cbd5e1',
  pinFill: '#0f172a',
  pinStroke: '#94a3b8',
  shieldStroke: '#94a3b8',
  overallShieldStroke: '#2dd4bf',
  bundleFill: '#64748b',
  bundleStroke: '#cbd5e1',
  bundleLabel: '#f8fafc',
  error: '#f87171',
  ground: '#cbd5e1',
  labelBg: '#1e293b',
  frameStroke: '#e2e8f0',
}

export function themeFor(dark: boolean): DiagramTheme {
  return dark ? DARK_THEME : LIGHT_THEME
}
