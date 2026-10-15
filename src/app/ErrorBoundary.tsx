import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * The app's top-level error fallback (README, MIG-01): a render crash anywhere below shows `screen-error` instead of a blank
 * page. It is mounted in src/main.tsx around <App/> (not in App.tsx, which holds the partner gate) and must never be
 * present in a contract walk.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Dojo render error', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <main className="fatal" role="alert" data-testid="fatal">
        <section data-testid="screen-error">
          <h1>Something went wrong</h1>
          <p className="fatal-msg">Dojo hit an unexpected error. Your work is saved. Reload to continue.</p>
          <button type="button" className="sr-btn sr-btn-quiet" onClick={() => window.location.reload()}>Reload</button>
        </section>
      </main>
    )
  }
}
