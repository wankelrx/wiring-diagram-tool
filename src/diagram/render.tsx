import type { DiagramTheme } from '../types'
import type { Scene } from './scene'
import { titleBlockLayout } from './titleBlock'

export type DiagramOverlay = {
  selectedConnectorId: string | null
  hoveredConnectorId: string | null
  highlightedBundleId: string | null
}

export function DiagramSvg({
  scene,
  theme,
  overlay,
}: {
  scene: Scene
  theme: DiagramTheme
  overlay?: DiagramOverlay
}) {
  const { frame } = scene
  const block = titleBlockLayout(frame)
  const selectedId = overlay?.selectedConnectorId
  const hoveredId = overlay?.hoveredConnectorId
  const bundleId = overlay?.highlightedBundleId

  return (
    <g id="diagram-content">
      <g pointerEvents="none">
        <rect
          x={frame.x}
          y={frame.y}
          width={frame.width}
          height={frame.height}
          fill="none"
          stroke={theme.frameStroke}
          strokeWidth={1.25}
        />
        <rect
          x={frame.x + 1.5}
          y={frame.y + 1.5}
          width={frame.width - 3}
          height={frame.height - 3}
          fill="none"
          stroke={theme.frameStroke}
          strokeWidth={0.4}
        />
        <rect
          x={block.x}
          y={block.y}
          width={block.width}
          height={block.height}
          fill={theme.headerFill}
          stroke={theme.frameStroke}
          strokeWidth={1}
        />
        <rect
          x={block.notes.x}
          y={block.notes.y}
          width={block.notes.width}
          height={block.notes.height}
          fill="none"
          stroke={theme.frameStroke}
          strokeWidth={0.75}
        />
        <text
          x={block.notes.x + 8}
          y={block.notes.y + 12}
          fontSize={7}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fill={theme.mutedText}
        >
          {block.notes.label}
        </text>
        <text
          x={block.notes.x + 8}
          y={block.notes.y + 28}
          fontSize={9}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fill={theme.text}
        >
          {frame.notes || frame.subtitle}
        </text>
        <rect
          x={block.title.x}
          y={block.title.y}
          width={block.title.width}
          height={block.title.height}
          fill="none"
          stroke={theme.frameStroke}
          strokeWidth={0.75}
        />
        <text
          x={block.title.x + 8}
          y={block.title.y + 12}
          fontSize={7}
          fill={theme.mutedText}
        >
          {block.title.label}
        </text>
        <text
          x={block.title.x + 8}
          y={block.title.y + 28}
          fontSize={13}
          fontWeight={700}
          fill={theme.text}
        >
          {frame.title}
        </text>
        {block.fields.map((field) => (
          <g key={field.label}>
            <rect
              x={field.x}
              y={field.y}
              width={field.width}
              height={field.height}
              fill="none"
              stroke={theme.frameStroke}
              strokeWidth={0.75}
            />
            <text
              x={field.x + 6}
              y={field.y + 8}
              fontSize={6}
              fill={theme.mutedText}
            >
              {field.label}
            </text>
            <text
              x={field.x + 6}
              y={field.y + 18}
              fontSize={9}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fill={theme.text}
            >
              {field.value}
            </text>
          </g>
        ))}
      </g>

      {/* Cable IDs are labels only — thick centroid strokes fight shield outlines. */}

      {scene.shields.map((shield) => {
        const overall = shield.kind === 'overall'
        return (
          <g key={shield.id} pointerEvents="none">
            <path
              d={shield.outlinePath}
              fill="none"
              stroke={
                overall ? theme.overallShieldStroke : theme.shieldStroke
              }
              strokeWidth={overall ? 2.25 : 1.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={overall ? '14 5 3 5' : '6 4'}
            />
          </g>
        )
      })}

      {scene.wires.map((wire) => {
        const highlighted = Boolean(bundleId && wire.bundleId === bundleId)
        return (
          <g key={wire.id} pointerEvents="none">
            {wire.underStroke ? (
              <path
                d={wire.path}
                fill="none"
                stroke={theme.connectorStroke}
                strokeWidth={highlighted ? 5 : 4.2}
                strokeLinecap="butt"
                strokeLinejoin="miter"
              />
            ) : null}
            <path
              d={wire.path}
              fill="none"
              stroke={wire.error ? theme.error : wire.color}
              strokeWidth={wire.error ? 3.1 : highlighted ? 2.8 : 2.15}
              strokeLinecap="butt"
              strokeLinejoin="miter"
              strokeDasharray={wire.dashed ? '5 4' : undefined}
            />
          </g>
        )
      })}

      {scene.wires.map((wire) =>
        wire.label ? (
          <text
            key={`label-${wire.id}`}
            x={wire.labelX}
            y={wire.labelY}
            textAnchor="middle"
            fontSize={9}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fill={theme.text}
            stroke={theme.background}
            strokeWidth={3}
            paintOrder="stroke"
            style={{ pointerEvents: 'none' }}
          >
            {wire.label}
          </text>
        ) : null,
      )}

      {scene.bundles.map((bundle) => (
        <g key={`id-${bundle.id}`} pointerEvents="none">
          <rect
            x={bundle.labelX - 64}
            y={bundle.labelY - 11}
            width={128}
            height={16}
            rx={2}
            fill={theme.labelBg}
            stroke={theme.bundleStroke}
            strokeWidth={0.75}
            opacity={0.95}
          />
          <text
            x={bundle.labelX}
            y={bundle.labelY + 2}
            textAnchor="middle"
            fontSize={9}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fill={theme.bundleLabel}
          >
            {bundle.label}
          </text>
        </g>
      ))}

      {scene.connectors.map((connector) => {
        const selected = selectedId === connector.id
        const hovered = hoveredId === connector.id
        const stroke = selected
          ? '#2563eb'
          : hovered
            ? '#64748b'
            : theme.connectorStroke
        return (
          <g key={connector.id} pointerEvents="none">
            <rect
              x={connector.x}
              y={connector.y}
              width={connector.width}
              height={connector.height}
              rx={2}
              fill={theme.connectorFill}
              stroke={stroke}
              strokeWidth={selected ? 2.5 : 1.5}
            />
            <rect
              x={connector.x}
              y={connector.y}
              width={connector.width}
              height={42}
              fill={theme.headerFill}
              stroke={stroke}
              strokeWidth={selected ? 2.5 : 1.5}
            />
            <text
              x={connector.x + connector.width / 2}
              y={connector.y + 18}
              textAnchor="middle"
              fontSize={12}
              fontWeight={600}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fill={theme.text}
            >
              {connector.name || connector.id}
            </text>
            <text
              x={connector.x + connector.width / 2}
              y={connector.y + 34}
              textAnchor="middle"
              fontSize={10}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fill={theme.mutedText}
            >
              {connector.id}
            </text>
            {connector.pins.map((pin) => (
              <g key={pin.pin}>
                <circle
                  cx={pin.x}
                  cy={pin.y}
                  r={4.5}
                  fill={
                    pin.error
                      ? theme.error
                      : pin.shield
                        ? theme.shieldStroke
                        : theme.pinFill
                  }
                  stroke={pin.error ? theme.error : pin.shield ? theme.shieldStroke : theme.pinStroke}
                  strokeWidth={1.35}
                />
                <text
                  x={pin.labelX}
                  y={pin.labelY + 3}
                  textAnchor="middle"
                  fontSize={10}
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fill={pin.error ? theme.error : theme.text}
                >
                  {pin.pin}
                </text>
                {pin.signal ? (
                  <text
                    x={pin.signalX}
                    y={pin.y + 3}
                    textAnchor={pin.signalAnchor}
                    fontSize={9}
                    fontFamily="ui-sans-serif, system-ui, sans-serif"
                    fill={theme.mutedText}
                  >
                    {pin.signal}
                  </text>
                ) : null}
              </g>
            ))}
          </g>
        )
      })}

      {scene.shieldLinks.map((link) => {
        const overall = link.kind === 'overall'
        const stroke = overall ? theme.overallShieldStroke : theme.shieldStroke
        return (
          <g key={`shield-link-${link.id}`} pointerEvents="none">
            <path
              d={link.path}
              fill="none"
              stroke={stroke}
              strokeWidth={overall ? 2.25 : 1.5}
              strokeLinecap="round"
              strokeLinejoin="miter"
              strokeDasharray={overall ? '14 5 3 5' : '6 4'}
            />
            <circle cx={link.pin.x} cy={link.pin.y} r={2.6} fill={stroke} />
            <circle cx={link.anchor.x} cy={link.anchor.y} r={2.6} fill={stroke} />
          </g>
        )
      })}
    </g>
  )
}
