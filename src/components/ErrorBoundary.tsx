import { Component, type ErrorInfo, type ReactNode } from 'react'
import { clearProject } from '../storage'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error in wiring diagram tool', error, info)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-full min-h-screen flex-col items-center justify-center gap-4 bg-slate-100 p-8 text-center dark:bg-slate-950">
        <div className="card max-w-md p-6 shadow-float">
          <h1 className="mb-2 text-lg font-semibold text-slate-900 dark:text-slate-50">
            Something went wrong
          </h1>
          <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
            The drawing hit an unexpected error. Your last autosave may be
            recoverable, or you can reset to a clean project.
          </p>
          <pre className="mb-4 max-h-32 overflow-auto rounded-lg bg-slate-100 p-2.5 text-left font-mono text-xs text-red-700 dark:bg-slate-800 dark:text-red-300">
            {error.message}
          </pre>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
            <button
              type="button"
              className="btn border-red-300 bg-red-50 text-red-700 hover:border-red-400 hover:bg-red-100 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20"
              onClick={() => {
                clearProject()
                window.location.reload()
              }}
            >
              Reset project
            </button>
          </div>
        </div>
      </div>
    )
  }
}
