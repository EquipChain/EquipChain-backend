const { Readable } = require('stream');
const { stringify } = require('csv-stringify');
const { childLogger } = require('../config/logger');

const log = childLogger('exporter');

/**
 * Supported export formats
 */
const SUPPORTED_FORMATS = ['csv', 'json', 'ndjson'];

/**
 * Default CSV options
 */
const DEFAULT_CSV_OPTIONS = {
  header: true,
  delimiter: ',',
  quoted: false,
  quotedEmpty: true,
  quotedString: false,
  escape: '\\',
};

/**
 * Generate a descriptive filename based on export type and date range
 * @param {string} type - Export type (e.g., 'readings', 'analytics', 'system-report')
 * @param {string} startDate - Start date in ISO format
 * @param {string} endDate - End date in ISO format
 * @param {string} format - File format ('csv' or 'json')
 * @returns {string} Generated filename
 */
function generateFilename(type, startDate, endDate, format) {
  const formatDate = (dateStr) => {
    if (!dateStr) return 'all';
    return dateStr.split('T')[0];
  };

  const start = formatDate(startDate);
  const end = formatDate(endDate);
  const ext = format === 'ndjson' ? 'json' : format;

  if (start === 'all' && end === 'all') {
    return `${type}.${ext}`;
  }

  return `${type}-${start}-to-${end}.${ext}`;
}

/**
 * Validate and normalize export format
 * @param {string} format - Requested format
 * @returns {string} Normalized format
 * @throws {Error} If format is invalid
 */
function validateFormat(format) {
  const normalized = format?.toLowerCase();
  if (!SUPPORTED_FORMATS.includes(normalized)) {
    throw new Error(`Invalid format '${format}'. Supported formats: ${SUPPORTED_FORMATS.join(', ')}`);
  }
  return normalized;
}

/**
 * Validate requested fields against available columns
 * @param {Array<string>} requestedFields - Fields requested by user
 * @param {Array<string>} availableFields - Available fields in data
 * @returns {Array<string>} Validated fields
 * @throws {Error} If invalid fields are requested
 */
function validateFields(requestedFields, availableFields) {
  if (!requestedFields || requestedFields.length === 0) {
    return availableFields;
  }

  const invalidFields = requestedFields.filter(field => !availableFields.includes(field));
  if (invalidFields.length > 0) {
    throw new Error(`Invalid fields requested: ${invalidFields.join(', ')}`);
  }

  return requestedFields;
}

/**
 * Filter object to include only specified fields
 * @param {Object} obj - Object to filter
 * @param {Array<string>} fields - Fields to include
 * @returns {Object} Filtered object
 */
function filterFields(obj, fields) {
  const filtered = {};
  fields.forEach(field => {
    if (obj.hasOwnProperty(field)) {
      filtered[field] = obj[field];
    }
  });
  return filtered;
}

/**
 * Create a Readable stream from an array of objects
 * @param {Array<Object>} data - Data to stream
 * @returns {Readable} Readable stream
 */
function createReadableStream(data) {
  return Readable.from(data);
}

/**
 * Export data to CSV format with streaming
 * @param {Readable} dataStream - Readable stream of data objects
 * @param {Array<string>} columns - Columns to include
 * @param {Object} options - CSV options
 * @returns {Readable} CSV stream
 */
function exportToCSV(dataStream, columns, options = {}) {
  const csvOptions = {
    ...DEFAULT_CSV_OPTIONS,
    columns,
    ...options,
  };

  log.debug({ columns, options: csvOptions }, 'Creating CSV export stream');

  const csvStream = stringify(csvOptions);

  // Transform data to include only specified columns
  const transformStream = new Readable({
    objectMode: true,
    read() {},
  });

  dataStream.on('data', (chunk) => {
    const filtered = filterFields(chunk, columns);
    transformStream.push(filtered);
  });

  dataStream.on('end', () => {
    transformStream.push(null);
  });

  dataStream.on('error', (error) => {
    transformStream.emit('error', error);
  });

  transformStream.pipe(csvStream);
  return csvStream;
}

/**
 * Export data to JSON format with streaming
 * @param {Readable} dataStream - Readable stream of data objects
 * @param {Array<string>} columns - Columns to include
 * @param {Object} options - Export options
 * @returns {Readable} JSON stream
 */
function exportToJSON(dataStream, columns, options = {}) {
  const { pretty = false, ndjson = false } = options;

  log.debug({ columns, pretty, ndjson }, 'Creating JSON export stream');

  const jsonStream = new Readable({
    read() {},
  });

  let first = true;
  let itemCount = 0;

  if (!ndjson) {
    // JSON array format
    jsonStream.push('[');
  }

  dataStream.on('data', (chunk) => {
    const filtered = filterFields(chunk, columns);
    const jsonStr = JSON.stringify(filtered, null, pretty ? 2 : 0);

    if (ndjson) {
      // Newline-delimited JSON
      jsonStream.push(jsonStr + '\n');
    } else {
      // JSON array
      if (!first) {
        jsonStream.push(',');
      }
      jsonStream.push(jsonStr);
      first = false;
    }
    itemCount++;
  });

  dataStream.on('end', () => {
    if (!ndjson) {
      jsonStream.push(']');
    }
    jsonStream.push(null);
    log.debug({ itemCount }, 'JSON export stream completed');
  });

  dataStream.on('error', (error) => {
    jsonStream.emit('error', error);
  });

  return jsonStream;
}

/**
 * Set appropriate response headers for export
 * @param {Object} res - Express response object
 * @param {string} format - Export format
 * @param {string} filename - Filename for Content-Disposition
 */
function setExportHeaders(res, format, filename) {
  const contentTypes = {
    csv: 'text/csv; charset=utf-8',
    json: 'application/json; charset=utf-8',
    ndjson: 'application/x-ndjson; charset=utf-8',
  };

  res.setHeader('Content-Type', contentTypes[format] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Transfer-Encoding', 'chunked');
}

/**
 * Handle export request with streaming response
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Object} data - Data to export (array or stream)
 * @param {Array<string>} availableFields - Available fields in data
 * @param {string} exportType - Type of export for filename
 * @returns {Promise<void>}
 */
async function handleExport(req, res, data, availableFields, exportType) {
  try {
    const format = validateFormat(req.query.format || 'csv');
    const requestedFields = req.query.fields ? req.query.fields.split(',').map(f => f.trim()) : null;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    const columns = validateFields(requestedFields, availableFields);
    const filename = generateFilename(exportType, startDate, endDate, format);

    setExportHeaders(res, format, filename);

    // Create data stream
    const dataStream = Array.isArray(data) ? createReadableStream(data) : data;

    // Pipe appropriate export stream to response
    let exportStream;
    if (format === 'csv') {
      exportStream = exportToCSV(dataStream, columns, req.query);
    } else {
      exportStream = exportToJSON(dataStream, columns, {
        pretty: req.query.pretty === 'true',
        ndjson: format === 'ndjson',
      });
    }

    exportStream.pipe(res);

    // Handle stream errors
    exportStream.on('error', (error) => {
      log.error({ error }, 'Export stream error');
      if (!res.headersSent) {
        res.status(500).json({ error: 'Export failed', message: error.message });
      }
    });

  } catch (error) {
    log.error({ error }, 'Export request error');
    if (!res.headersSent) {
      res.status(400).json({ error: error.message });
    }
  }
}

module.exports = {
  generateFilename,
  validateFormat,
  validateFields,
  exportToCSV,
  exportToJSON,
  setExportHeaders,
  handleExport,
  SUPPORTED_FORMATS,
};
