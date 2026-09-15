// src/data/adminStore.js
//
// In-memory storage for admin-managed resources (users, devices,
// config + audit log), per issue #11's own allowance ("initially using
// in-memory storage, ready for database integration"). Issue #22's
// repository pattern has not landed, so this is a plain module-level
// store for now - swap for a real repository layer later without
// changing the route handlers' public shape.

let users = [];
let nextUserId = 1;

let devices = [];
let nextDeviceId = 1;

const defaultConfig = { rateLimitPerMinute: 60, maintenanceMode: false };
let config = { ...defaultConfig };
let configAuditLog = [];

// Mutable-key whitelist. configStore.update spreads arbitrary client JSON
// into the live config object: today the schema restricts values to
// string/number/boolean, but ANY future reader that trusts config's shape
// (or an admin client that guesses a key like "__proto__"-safe but
// unvalidated) could inject keys nobody consumes or, worse, shadow keys
// future code adds. Whitelisting at the store makes the stored shape
// closed regardless of what the schema allows.
const MUTABLE_CONFIG_KEYS = new Set(Object.keys(defaultConfig));

// Audit log cap: this log is only for admin inspection, so keeping the most
// recent entries is sufficient. Without a cap, a long-lived process with
// periodic config writes grows the array forever (slow memory leak).
const MAX_AUDIT_ENTRIES = 500;

const userStore = {
  list: () => users,
  get: (id) => users.find((u) => u.id === id),
  create: (data) => {
    const user = {
      id: String(nextUserId++),
      active: true,
      createdAt: new Date().toISOString(),
      ...data,
    };
    users.push(user);
    return user;
  },
  updateRoles: (id, roles) => {
    const user = users.find((u) => u.id === id);
    if (!user) return null;
    user.roles = roles;
    return user;
  },
  deactivate: (id) => {
    const user = users.find((u) => u.id === id);
    if (!user) return null;
    user.active = false;
    return user;
  },
  // Test-only reset hook, so each test file/run starts clean.
  _reset: () => {
    users = [];
    nextUserId = 1;
  },
};

const deviceStore = {
  list: () => devices,
  get: (id) => devices.find((d) => d.id === id),
  create: (data) => {
    const device = {
      id: String(nextDeviceId++),
      registeredAt: new Date().toISOString(),
      ...data,
    };
    devices.push(device);
    return device;
  },
  update: (id, updates) => {
    const device = devices.find((d) => d.id === id);
    if (!device) return null;
    Object.assign(device, updates);
    return device;
  },
  remove: (id) => {
    const idx = devices.findIndex((d) => d.id === id);
    if (idx === -1) return false;
    devices.splice(idx, 1);
    return true;
  },
  _reset: () => {
    devices = [];
    nextDeviceId = 1;
  },
};

const configStore = {
  get: () => config,
  update: (updates, adminId) => {
    // Only whitelisted keys land; unknown keys are ignored (and reported in
    // the audit entry's `ignored` list so admins see what didn't apply).
    const applied = {};
    const ignored = [];
    for (const [key, value] of Object.entries(updates || {})) {
      if (MUTABLE_CONFIG_KEYS.has(key)) {
        applied[key] = value;
      } else {
        ignored.push(key);
      }
    }
    config = { ...config, ...applied };
    _appendAudit({ admin: adminId, changes: applied, ...(ignored.length > 0 ? { ignored } : {}) });
    // Mirror into the shared admin trail so one ordered log covers every
    // privileged mutation surface.
    recordAdminAudit({
      action: ADMIN_AUDIT_ACTIONS.CONFIG_UPDATE,
      admin: adminId || 'unknown',
      target: 'config',
      changes: applied,
      ...(ignored.length > 0 ? { ignored } : {}),
    });
    return config;
  },
  reset: (adminId) => {
    config = { ...defaultConfig };
    _appendAudit({ admin: adminId, changes: 'reset-to-defaults' });
    recordAdminAudit({
      action: ADMIN_AUDIT_ACTIONS.CONFIG_RESET,
      admin: adminId || 'unknown',
      target: 'config',
      changes: 'reset-to-defaults',
    });
    return config;
  },
  auditLog: () => configAuditLog,
  _reset: () => {
    config = { ...defaultConfig };
    configAuditLog = [];
  },
};

/**
 * Shared admin action audit trail. Config changes had one; user and device
 * mutations - the actions that actually change who can access what (role
 * grants, deactivations, device registration/removal) - happened with no
 * record beyond HTTP logs. Security review for a compromised admin account
 * needs a single ordered trail of every privileged mutation.
 *
 * Entries: { action, admin, target, changes?, ignored?, timestamp }
 * Capped at MAX_AUDIT_ENTRIES like the config log (most recent kept).
 */
const adminAuditLog = [];

const ADMIN_AUDIT_ACTIONS = Object.freeze({
  USER_CREATE: 'user.create',
  USER_ROLES_UPDATE: 'user.roles.update',
  USER_DEACTIVATE: 'user.deactivate',
  DEVICE_CREATE: 'device.create',
  DEVICE_UPDATE: 'device.update',
  DEVICE_DELETE: 'device.delete',
  CONFIG_UPDATE: 'config.update',
  CONFIG_RESET: 'config.reset',
  WEBHOOK_CREATE: 'webhook.create',
  WEBHOOK_UPDATE: 'webhook.update',
  WEBHOOK_DELETE: 'webhook.delete',
});

/**
 * Record one admin action. Never throws into the caller: audit failures
 * must not break the mutation being audited (or, worse, roll it back).
 * @param {{ action: string, admin: string, target: string, changes?: Object|string, ignored?: string[] }} entry
 */
function recordAdminAudit(entry) {
  try {
    adminAuditLog.push({
      ...entry,
      timestamp: new Date().toISOString(),
    });
    if (adminAuditLog.length > MAX_AUDIT_ENTRIES) {
      adminAuditLog.splice(0, adminAuditLog.length - MAX_AUDIT_ENTRIES);
    }
  } catch {
    // Swallow: an audit sink must never take down the request path.
  }
}

/**
 * Append an audit entry, dropping the oldest when over the cap.
 * @param {{ admin: string, changes: Object|string }} entry
 */
function _appendAudit(entry) {
  configAuditLog.push({ ...entry, timestamp: new Date().toISOString() });
  if (configAuditLog.length > MAX_AUDIT_ENTRIES) {
    configAuditLog = configAuditLog.slice(-MAX_AUDIT_ENTRIES);
  }
}

module.exports = {
  userStore,
  deviceStore,
  configStore,
  recordAdminAudit,
  adminAuditLog: () => adminAuditLog,
  ADMIN_AUDIT_ACTIONS,
  _resetAdminAudit: () => {
    adminAuditLog.length = 0;
  },
};