import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  failed: boolean;
}

/**
 * Catches rendering errors so one bad component does not blank the page.
 * Deliberately logs nothing: error messages can contain document text.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Intentionally empty: no console output, no remote reporting.
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="callout callout--danger" role="alert">
          <div className="callout__body">
            <p className="callout__title">The {this.props.label} could not be displayed.</p>
            <p>The rest of the app still works. Try removing the document and analysing it again.</p>
            <button type="button" className="button button--secondary" onClick={() => this.setState({ failed: false })}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
