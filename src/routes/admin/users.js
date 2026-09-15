// src/routes/admin/users.js
const express = require('express');
const { userStore, recordAdminAudit, ADMIN_AUDIT_ACTIONS } = require('../../data/adminStore');
const { validate } = require('../../middleware/validate');
const {
  adminCreateUserSchema,
  adminUpdateUserRolesSchema,
  adminIdParamSchema,
} = require('../../schemas/validation.schema');
const { paginateList } = require('../../utils/pagination');

const router = express.Router();

// Shared list options: keep the whitelist in one place so the schema-level
// sortable/filterset and the utility-level enforcement cannot drift apart.
const USER_LIST_OPTIONS = {
  allowedFilters: ['role', 'status'],
  searchableFields: ['email', 'name'],
  sortableFields: ['email', 'name', 'role', 'status', 'createdAt'],
  defaultSort: { field: 'createdAt', order: 'desc' },
  dateField: 'createdAt',
};

/**
 * @openapi
 * /api/admin/users:
 *   get:
 *     summary: List all users
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Paginated list of users }
 *       401: { description: Authentication required }
 *       403: { description: Admin role required }
 */
router.get('/', (req, res, next) => {
  try {
    // paginateList supports ?paginate=offset (default) and ?paginate=cursor,
    // validates page/limit/sort against the whitelist, and throws
    // ValidationError (400) for bad input instead of silently mis-paging.
    res.json(paginateList(userStore.list(), req.query, USER_LIST_OPTIONS));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/admin/users/{id}:
 *   get:
 *     summary: Get user details
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: User details }
 *       404: { description: User not found }
 */
router.get('/:id', validate(adminIdParamSchema), (req, res) => {
  const user = userStore.get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

/**
 * @openapi
 * /api/admin/users:
 *   post:
 *     summary: Create a new user
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, name]
 *             properties:
 *               email: { type: string }
 *               name: { type: string }
 *               roles:
 *                 type: array
 *                 items: { type: string, enum: [admin, user] }
 *     responses:
 *       201: { description: Created user }
 *       400: { description: Validation failed }
 */
router.post('/', validate(adminCreateUserSchema), (req, res) => {
  // Email is the user's lookup identity; duplicates would make role
  // administration ambiguous (two accounts, one address). 409 conflict -
  // well-formed request, collides with existing state. Comparison is
  // case-insensitive because local-part case is visually indistinguishable
  // for users and mail systems treat the domain as insensitive.
  const email = req.body.email.toLowerCase();
  const existing = userStore
    .list()
    .find((u) => (u.email || '').toLowerCase() === email);
  if (existing) {
    return res.status(409).json({
      error: 'User already exists',
      message: `A user with email "${req.body.email}" already exists.`,
    });
  }
  const created = userStore.create(req.body);
  recordAdminAudit({
    action: ADMIN_AUDIT_ACTIONS.USER_CREATE,
    admin: req.user?.sub || 'unknown',
    target: created.id,
    changes: { email: created.email, roles: created.roles },
  });
  res.status(201).json(created);
});

/**
 * @openapi
 * /api/admin/users/{id}:
 *   patch:
 *     summary: Update a user's roles
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Updated user }
 *       400: { description: Validation failed }
 *       404: { description: User not found }
 */
router.patch('/:id', validate({ ...adminUpdateUserRolesSchema, params: adminIdParamSchema.params }), (req, res) => {
  const user = userStore.updateRoles(req.params.id, req.body.roles);
  if (!user) return res.status(404).json({ error: 'User not found' });
  // Role changes are the highest-value admin action on this surface - they
  // grant or revoke admin itself - so they are audited with the actor.
  recordAdminAudit({
    action: ADMIN_AUDIT_ACTIONS.USER_ROLES_UPDATE,
    admin: req.user?.sub || 'unknown',
    target: user.id,
    changes: { roles: user.roles },
  });
  res.json(user);
});

/**
 * @openapi
 * /api/admin/users/{id}:
 *   delete:
 *     summary: Deactivate a user
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deactivated user }
 *       404: { description: User not found }
 */
router.delete('/:id', validate(adminIdParamSchema), (req, res) => {
  const user = userStore.deactivate(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  recordAdminAudit({
    action: ADMIN_AUDIT_ACTIONS.USER_DEACTIVATE,
    admin: req.user?.sub || 'unknown',
    target: user.id,
    changes: { active: false },
  });
  res.json(user);
});

module.exports = router;