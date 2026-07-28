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

module.exports = { ValidationError };
