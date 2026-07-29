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
    config = { ...config, ...updates };
    configAuditLog.push({
      admin: adminId,
      changes: updates,
      timestamp: new Date().toISOString(),
    });
    return config;
  },
  reset: (adminId) => {
    config = { ...defaultConfig };
    configAuditLog.push({
      admin: adminId,
      changes: 'reset-to-defaults',
      timestamp: new Date().toISOString(),
    });
    return config;
  },
  auditLog: () => configAuditLog,
  _reset: () => {
    config = { ...defaultConfig };
    configAuditLog = [];
  },
};

module.exports = { userStore, deviceStore, configStore };