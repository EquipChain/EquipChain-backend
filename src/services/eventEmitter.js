/**
 * Application Event Emitter
 *
 * Centralized EventEmitter instance for handling system-wide asynchronous events.
 * Services emit events here when business actions or contract changes occur.
 */

const { EventEmitter } = require('node:events');

class AppEventEmitter extends EventEmitter {
  constructor() {
    super();
    // Set max listeners to prevent memory leak warnings in large deployments
    this.setMaxListeners(50);
  }

  /**
   * Emit a typed application event.
   * @param {string} eventType - e.g. 'meter.reading.created', 'contract.state.changed'
   * @param {Object} payload - Event specific data
   */
  emitEvent(eventType, payload) {
    this.emit(eventType, payload);
    this.emit('*', { type: eventType, data: payload });
  }
}

const appEventEmitter = new AppEventEmitter();

module.exports = {
  appEventEmitter,
  AppEventEmitter,
};
