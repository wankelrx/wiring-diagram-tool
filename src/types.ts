export type Connector = {
  connector_id: string
  connector_name: string
  pin_count: number
  position_x?: number
  position_y?: number
  pigtail?: boolean
  pigtail_length?: number
  pigtail_shield_to_body?: boolean
}

export type Wire = {
  wire_id: string
  from_connector: string
  from_pin: string
  to_connector: string
  to_pin: string
  wire_color: string
  gauge: string
  signal_name?: string
  twist_group?: string
  /** Inner/pair shield (e.g. one twisted-pair shield). */
  shield_group?: string
  /** Outer cable shield covering multiple pairs / the whole harness between two connectors. */
  overall_shield?: string
}

export type ValidationError = {
  kind: 'missing_ref' | 'duplicate_pin' | 'duplicate_id' | 'import' | 'warning'
  message: string
  wire_id?: string
  connector_id?: string
  pin?: string
}

export type DiagramTheme = {
  background: string
  connectorFill: string
  connectorStroke: string
  headerFill: string
  text: string
  mutedText: string
  pinFill: string
  pinStroke: string
  shieldStroke: string
  overallShieldStroke: string
  bundleFill: string
  bundleStroke: string
  bundleLabel: string
  error: string
  ground: string
  labelBg: string
  frameStroke: string
}

export type DrawingMeta = {
  title: string
  drawingNumber: string
  revision: string
  date: string
  author: string
  notes: string
}

export type PinoutRow = {
  pin: string
  signal: string
  color: string
  gauge: string
  mates: string
  wireIds: string[]
}
