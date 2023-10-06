import stringHash from 'next/dist/compiled/string-hash'
import { formatServerError } from '../../lib/format-server-error'
import { SpanStatusCode, getTracer } from '../lib/trace/tracer'
import { isDynamicUsageError } from '../../lib/is-dynamic-usage-error'

/**
 * Create error handler for renderers.
 * Tolerate dynamic server errors during prerendering so console
 * isn't spammed with unactionable errors
 */
export function createErrorHandler({
  /**
   * Used for debugging
   */
  _source,
  dev,
  isNextExport,
  errorLogger,
  capturedErrors,
  allCapturedErrors,
}: {
  _source: string
  dev?: boolean
  isNextExport?: boolean
  errorLogger?: (err: any) => Promise<void>
  capturedErrors: Error[]
  allCapturedErrors?: Error[]
}) {
  return (err: any): string => {
    if (allCapturedErrors) allCapturedErrors.push(err)

    if (isDynamicUsageError(err)) return err.digest

    // Format server errors in development to add more helpful error messages
    if (dev) {
      formatServerError(err)
    }
    // Used for debugging error source
    // console.error(_source, err)
    // Don't log the suppressed error during export
    if (
      !(
        isNextExport &&
        err?.message?.includes(
          'The specific message is omitted in production builds to avoid leaking sensitive details.'
        )
      )
    ) {
      // Record exception in an active span, if available.
      const span = getTracer().getActiveScopeSpan()
      if (span) {
        span.recordException(err)
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err.message,
        })
      }

      if (errorLogger) {
        errorLogger(err).catch(() => {})
      } else {
        // The error logger is currently not provided in the edge runtime.
        // Use `log-app-dir-error` instead.
        // It won't log the source code, but the error will be more useful.
        if (process.env.NODE_ENV !== 'production') {
          const { logAppDirError } =
            require('../dev/log-app-dir-error') as typeof import('../dev/log-app-dir-error')
          logAppDirError(err)
        }
        if (process.env.NODE_ENV === 'production') {
          console.error(err)
        }
      }
    }

    capturedErrors.push(err)
    // TODO-APP: look at using webcrypto instead. Requires a promise to be awaited.
    return stringHash(err.message + err.stack + (err.digest || '')).toString()
  }
}
