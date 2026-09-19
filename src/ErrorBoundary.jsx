import { Component } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

// Catches any render-time crash so the user sees a recoverable screen
// instead of a blank white page.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Surface in console for support/debugging without breaking the UI
    console.error('UI crash:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-800 p-6">
        <div className="card max-w-md p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-400">
            <AlertTriangle size={22} />
          </div>
          <h1 className="text-lg font-bold text-slate-100">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-400">
            The page hit an unexpected error. Reloading usually fixes it — your data is saved on our servers.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <button className="btn-primary" onClick={() => window.location.reload()}>
              <RotateCcw size={14} /> Reload page
            </button>
            <button className="btn-ghost" onClick={() => { this.setState({ error: null }) }}>
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }
}
