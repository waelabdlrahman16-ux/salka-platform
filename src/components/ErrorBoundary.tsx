import { Component, type ReactNode } from 'react'
import * as Sentry from '@sentry/react'

interface Props { children: ReactNode }
interface State { hasError: boolean }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen grid place-items-center p-6 text-center">
          <div>
            <p className="text-4xl mb-3">⚠️</p>
            <h1 className="font-bold text-lg mb-1">حصل خطأ غير متوقع</h1>
            <p className="text-mist text-sm mb-4">جرب تحدّث الصفحة، ولو استمرت المشكلة كلّم الدعم</p>
            <button className="btn-sea" onClick={() => window.location.reload()}>تحديث الصفحة</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
