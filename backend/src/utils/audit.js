import prisma from '../db.js';

/**
 * Write an audit log entry.
 *
 * @param {Object} params
 * @param {string} params.userId    - The user who performed the action
 * @param {string} params.action    - e.g. CREATE_CUSTOMER, UPDATE_USER
 * @param {string} params.entityType - e.g. Customer, User, Report
 * @param {string} params.entityId  - The ID of the affected entity
 * @param {Object} [params.oldValue] - Previous state (will be JSON-stringified)
 * @param {Object} [params.newValue] - New state (will be JSON-stringified)
 * @param {Object} [params.req]     - Express request for IP / user-agent
 */
export async function auditLog({ userId, action, entityType, entityId, oldValue, newValue, req }) {
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      entityType,
      entityId,
      oldValue: oldValue ? JSON.stringify(oldValue) : null,
      newValue: newValue ? JSON.stringify(newValue) : null,
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent'] || null,
    },
  });
}
