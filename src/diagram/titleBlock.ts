import type { SceneFrame } from './scene'

export const TITLE_BLOCK_H = 58

export type TitleField = {
  label: string
  value: string
  x: number
  y: number
  width: number
  height: number
}

export type TitleBlockLayout = {
  x: number
  y: number
  width: number
  height: number
  notes: TitleField
  title: TitleField
  fields: TitleField[]
}

export function titleBlockLayout(frame: SceneFrame): TitleBlockLayout {
  const height = TITLE_BLOCK_H
  const y = frame.y + frame.height - height
  const notesW = Math.max(240, frame.width * 0.46)
  const metaX = frame.x + notesW
  const metaW = Math.max(200, frame.width - notesW)
  const fieldH = 22
  const titleH = height - fieldH
  const col = metaW / 4
  const fieldY = y + titleH
  return {
    x: frame.x,
    y,
    width: frame.width,
    height,
    notes: {
      label: 'NOTES',
      value: frame.notes || ' ',
      x: frame.x,
      y,
      width: notesW,
      height,
    },
    title: {
      label: 'TITLE',
      value: frame.title,
      x: metaX,
      y,
      width: metaW,
      height: titleH,
    },
    fields: [
      {
        label: 'DWG NO',
        value: frame.drawingNumber,
        x: metaX,
        y: fieldY,
        width: col,
        height: fieldH,
      },
      {
        label: 'REV',
        value: frame.revision,
        x: metaX + col,
        y: fieldY,
        width: col,
        height: fieldH,
      },
      {
        label: 'DATE',
        value: frame.date,
        x: metaX + col * 2,
        y: fieldY,
        width: col,
        height: fieldH,
      },
      {
        label: 'BY',
        value: frame.author || '-',
        x: metaX + col * 3,
        y: fieldY,
        width: col,
        height: fieldH,
      },
    ],
  }
}
