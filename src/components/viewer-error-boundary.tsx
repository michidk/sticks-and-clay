import { Component, type ReactNode } from "react";
import { Alert, AlertDescription } from "./ui/alert";
export class ViewerErrorBoundary extends Component<
  { children: ReactNode; onError?: (error: Error) => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }
  render() {
    if (this.state.error)
      return (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            Could not display the 3D preview: {this.state.error.message}
          </AlertDescription>
        </Alert>
      );
    return this.props.children;
  }
}
