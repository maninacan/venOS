import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '../i18n';

interface State { error: Error | null }

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(err: Error): State {
    return { error: err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary] Uncaught render error:', err, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card max-w-[560px] mx-auto mt-10 text-center">
          <div className="text-[2.5rem] mb-3"><i className="fa-solid fa-triangle-exclamation" /></div>
          <h2 className="text-[#0B2A4A] mt-0 mb-2">{i18n.t('nav:error.title', 'Something went wrong')}</h2>
          <p className="text-[#64748b] text-[0.9rem] mt-0 mb-5 leading-relaxed">
            {this.state.error.message || i18n.t('nav:error.generic', 'An unexpected error occurred.')}
          </p>
          <button className="btn-primary" onClick={() => window.location.reload()}>{i18n.t('nav:error.reload', 'Reload')}</button>
        </div>
      );
    }
    return this.props.children;
  }
}
