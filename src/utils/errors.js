/**
 * Raised when caller-supplied input (typically query parameters) is invalid.
 *
 * Carries statusCode 400 and a machine-readable `details` array so a future error
 * middleware can serialize it without knowing where it came from. Malformed *programmer*
 * input — a non-array data set, a bad options object — throws TypeError instead, because
 * that is a bug rather than something a client can fix by changing its request.
 */
class ValidationError extends Error {
  /**
   * @param {Array<{ field: string, message: string }>|{ field: string, message: string }} details
   */
  constructor(details) {
    const list = Array.isArray(details) ? details : [details];
    super(list.map((detail) => detail.message).join('; '));

    this.name = 'ValidationError';
    this.code = 'VALIDATION_ERROR';
    this.statusCode = 400;
    this.details = list;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ValidationError);
    }
  }
}

/**
 * Raised when a backing dependency (cache, queue, datastore) is unavailable
 * or failing. Carries statusCode 503 so the error middleware answers with a
 * retryable "Service Unavailable" instead of a misleading 500 - the caller
 * did nothing wrong, and load balancers/orchestrators treat 503 as the
 * signal to shed load or reroute.
 *
 * @param {string} dependency - Which dependency failed (e.g. 'cache')
 * @param {string} [detail] - Optional safe technical detail (no internals)
 */
class DependencyUnavailableError extends Error {
  constructor(dependency, detail) {
    super(detail ? `${dependency} unavailable: ${detail}` : `${dependency} unavailable`);

    this.name = 'DependencyUnavailableError';
    this.code = 'DEPENDENCY_UNAVAILABLE';
    this.statusCode = 503;
    this.dependency = dependency;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DependencyUnavailableError);
    }
  }
}

module.exports = { ValidationError, DependencyUnavailableError };
