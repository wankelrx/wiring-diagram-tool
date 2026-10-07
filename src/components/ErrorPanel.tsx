import { useState } from 'react'
import type { ValidationError } from '../types'
import { Icon } from './icons'

type Tone = 'warn' | 'error' | 'info'

const TONES: Record<Tone, { dot: string; text: string; badge: string }> = {
  warn: {
    dot: 'bg-amber-500',
    text: 'text-amber-900 dark:text-amber-100',
    badge:
      'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  },
  error: {
    dot: 'bg-red-500',
    text: 'text-red-900 dark:text-red-100',
    badge: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  },
  info: {
    dot: 'bg-slate-400',
    text: 'text-slate-700 dark:text-slate-200',
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  },
}

function ErrorItem({
  error,
  tone,
  onSelect,
}: {
  error: ValidationError
  tone: Tone
  onSelect: (error: ValidationError) => void
}) {
  const clickable = Boolean(error.wire_id || error.connector_id)
  const body = (
    <>
      <span
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${TONES[tone].dot}`}
      />
      <span className={TONES[tone].text}>{error.message}</span>
    </>
  )
  if (!clickable) {
    return <li className="flex items-start gap-2 px-1 py-0.5">{body}</li>
  }
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-start gap-2 rounded-md px-1 py-0.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
        onClick={() => onSelect(error)}
      >
        {body}
      </button>
    </li>
  )
}

function Group({
  title,
  tone,
  errors,
  keyPrefix,
  onSelect,
}: {
  title: string
  tone: Tone
  errors: ValidationError[]
  keyPrefix: string
  onSelect: (error: ValidationError) => void
}) {
  if (!errors.length) return null
  return (
    <div className="min-w-0 flex-1 basis-72">
      <div className="mb-1 flex items-center gap-2">
        <span className="eyebrow">{title}</span>
        <span
          className={`rounded-full px-1.5 py-px font-mono text-[10px] ${TONES[tone].badge}`}
        >
          {errors.length}
        </span>
      </div>
      <ul className="space-y-px text-xs">
        {errors.map((error, index) => (
          <ErrorItem
            key={`${keyPrefix}-${index}`}
            error={error}
            tone={tone}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  )
}

export function ErrorPanel({
  importErrors,
  refErrors,
  duplicateErrors,
  warnings,
  onSelectError,
}: {
  importErrors: ValidationError[]
  refErrors: ValidationError[]
  duplicateErrors: ValidationError[]
  warnings: ValidationError[]
  onSelectError: (error: ValidationError) => void
}) {
  const [open, setOpen] = useState(true)
  const refs = [...importErrors, ...refErrors]
  const total = refs.length + duplicateErrors.length + warnings.length
  if (!total) return null

  const hardErrors = refs.length + duplicateErrors.length

  return (
    <div className="shrink-0 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <button
        type="button"
        className="flex h-9 w-full items-center gap-2 px-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon
          name="alert"
          size={14}
          className={
            hardErrors
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-slate-400'
          }
        />
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          {hardErrors
            ? `${hardErrors} issue${hardErrors === 1 ? '' : 's'} to fix`
            : `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}
        </span>
        {hardErrors && warnings.length ? (
          <span className="text-xs text-slate-500">
            · {warnings.length} warning{warnings.length === 1 ? '' : 's'}
          </span>
        ) : null}
        <Icon
          name="chevronDown"
          size={14}
          className={`ml-auto text-slate-400 transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open ? (
        <div className="flex max-h-44 flex-wrap gap-x-8 gap-y-3 overflow-auto border-t border-slate-100 px-4 py-3 dark:border-slate-800">
          <Group
            title="Import / reference"
            tone="warn"
            errors={refs}
            keyPrefix="ref"
            onSelect={onSelectError}
          />
          <Group
            title="Duplicate IDs / pins"
            tone="error"
            errors={duplicateErrors}
            keyPrefix="dup"
            onSelect={onSelectError}
          />
          <Group
            title="Warnings"
            tone="info"
            errors={warnings}
            keyPrefix="warn"
            onSelect={onSelectError}
          />
        </div>
      ) : null}
    </div>
  )
}
