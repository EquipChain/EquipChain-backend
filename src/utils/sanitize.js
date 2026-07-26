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
 * Remove control characters from a string to prevent log injection
 * @param {string} str - The string to clean
 * @returns {string} The string with control characters removed
 */
function removeControlChars(str) {
  if (typeof str !== 'string') {
    return str;
  }
  // Remove control characters except newline, tab, and carriage return
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
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
  removeControlChars,
  sanitizeForLogging,
};
