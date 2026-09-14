const escape = require('escape-html');

/**
 * Sanitize a string by escaping HTML entities to prevent XSS attacks
 * @param {string} str - The string to sanitize
 * @returns {string} The sanitized string with HTML entities encoded
 */
function sanitize(str) {
  if (typeof str !== 'string') {
    return str;
  }
  return escape(str);
}

/**
 * Sanitize specific string fields in an object
 * @param {Object} obj - The object to sanitize
 * @param {string[]} fields - Array of field names to sanitize
 * @returns {Object} The object with specified fields sanitized
 */
function sanitizeObject(obj, fields) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const sanitized = { ...obj };
  
  for (const field of fields) {
    if (sanitized[field] !== undefined && typeof sanitized[field] === 'string') {
      sanitized[field] = sanitize(sanitized[field]);
    }
  }

  return sanitized;
}

/**
 * Sanitize all string values in an object recursively
 * @param {*} value - The value to sanitize
 * @returns {*} The sanitized value
 */
function sanitizeDeep(value) {
  if (typeof value === 'string') {
    return sanitize(value);
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeDeep(item));
  }

  if (value !== null && typeof value === 'object') {
    const sanitized = {};
    for (const [key, val] of Object.entries(value)) {
      sanitized[key] = sanitizeDeep(val);
    }
    return sanitized;
  }

  return value;
}

/**
 * Keys that enable prototype pollution when they appear in untrusted JSON
 * ("{"__proto__": {...}}" merges onto Object.prototype through naive deep
 * merges; constructor/reset are adjacent hazards). Blocks the whole object
 * graph under these keys at the body-parsing boundary.
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively strip prototype-pollution keys from a parsed value.
 * Runs on every JSON body before routes see it: defense happens at the
 * boundary, so no individual route or merge helper can forget it.
 * @param {*} value - Parsed JSON value
 * @returns {*} Value with dangerous keys removed
 */
function stripPrototypeKeys(value) {
  if (Array.isArray(value)) {
    return value.map(stripPrototypeKeys);
  }
  if (value !== null && typeof value === 'object') {
    const clean = {};
    for (const [key, val] of Object.entries(value)) {
      if (!DANGEROUS_KEYS.has(key)) {
        clean[key] = stripPrototypeKeys(val);
      }
    }
    return clean;
  }
  return value;
}

/**
 * Detect prototype-pollution keys without mutating (for strict checks).
 * @param {*} value - Parsed JSON value
 * @returns {boolean} True if any dangerous key exists at any depth
 */
function hasPrototypeKeys(value) {
  if (Array.isArray(value)) {
    return value.some(hasPrototypeKeys);
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      if (DANGEROUS_KEYS.has(key) || hasPrototypeKeys(val)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Remove control characters from a string to prevent log injection
 * @param {string} str - The string to clean
 * @returns {string} The string with control characters removed
 */
function removeControlChars(str) {
  if (typeof str !== 'string') {
    return str;
  }
  // Remove control characters except newline, tab, and carriage return.
  // The control-char class is deliberate here (log-injection defense), so
  // the no-control-regex lint rule is disabled for this line only.
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Sanitize a value destined for an HTTP header or other single-line protocol
 * field: strips ALL control characters including CR/LF/tab. removeControlChars
 * deliberately preserves line breaks for log readability - but a header value
 * carrying CR/LF is a smuggling vector and CR is invisible in most log
 * viewers, so header contexts need the stricter form.
 * @param {string} str - The header value to clean
 * @returns {string} The value with all control characters removed
 */
function sanitizeHeaderValue(str) {
  if (typeof str !== 'string') {
    return str;
  }
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\x00-\x1F\x7F]/g, '');
}

/**
 * Sanitize data for logging (remove control characters and limit length)
 * @param {*} data - The data to sanitize for logging
 * @param {number} maxLength - Maximum length for strings (default: 1000)
 * @returns {*} The sanitized data
 */
function sanitizeForLogging(data, maxLength = 1000) {
  if (typeof data === 'string') {
    let sanitized = removeControlChars(data);
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength) + '...[truncated]';
    }
    return sanitized;
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeForLogging(item, maxLength));
  }

  if (data !== null && typeof data === 'object') {
    const sanitized = {};
    for (const [key, val] of Object.entries(data)) {
      sanitized[key] = sanitizeForLogging(val, maxLength);
    }
    return sanitized;
  }

  return data;
}

module.exports = {
  sanitize,
  sanitizeObject,
  sanitizeDeep,
  stripPrototypeKeys,
  hasPrototypeKeys,
  removeControlChars,
  sanitizeHeaderValue,
  sanitizeForLogging,
};
