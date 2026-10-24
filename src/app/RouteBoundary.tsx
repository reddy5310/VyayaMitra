import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button, Card } from '@/ui';

interface Props {
  children: ReactNode;
  /** When this changes (e.g. the route path), a previous error is cleared. */
  resetKey?: string;
}
interface State {
  error: Error | null;
  key?: string;
}

/** Catches render errors (including failed lazy chunks) so one broken screen never blanks the app. */
export class RouteBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Local console only: nothing is ever sent anywhere.
    console.error('Screen crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Card className="mx-auto mt-6 max-w-lg text-center" role="alert">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-warning-soft text-warning">
          <ShieldCheck className="h-6 w-6" aria-hidden />
        </div>
        <h2 className="text-lg font-semibold text-fg">Something went wrong on this screen.</h2>
        <p className="mt-1 text-sm text-fg-muted">Your data is safe on this device. Reloading usually fixes it.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="secondary" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </div>
        <details className="mt-4 text-left text-xs text-fg-subtle">
          <summary className="cursor-pointer">Technical details</summary>
          <p className="mt-1 break-words font-mono">{this.state.error.message}</p>
        </details>
      </Card>
    );
  }
}
