// G4 M2: a step view that throws (a step no check foresaw) shows a note instead of blanking the Do screen.
import { Component, type ReactNode } from 'react'

export class StepsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) return <p className="code-note" data-testid="steps-error">The step view could not draw this run.</p>
    return this.props.children
  }
}
