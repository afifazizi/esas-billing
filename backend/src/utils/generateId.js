/**
 * Auto-generate unique entity IDs from names.
 *
 * Customer: acronym of name words → e.g. "Media Prima" → "mp"
 * Department: {custId}-{acronym} → e.g. "mp-ARCHIVE"
 * Folder: {deptId}-{acronym or shortName} → e.g. "mp-ARCHIVE-MASTER"
 *
 * All generators check the DB for uniqueness and append a counter if needed.
 */

/**
 * Derive a short acronym from a name:
 * "Media Prima" → "mp", "News Room Control System" → "NRCS"
 * Single words take first 4 chars lowercase: "Master" → "mast"
 */
function acronym(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 4).toLowerCase();
  return words.map(w => w[0]).join('').toLowerCase();
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} name
 * @returns {Promise<string>}
 */
export async function generateCustId(prisma, name) {
  const base = acronym(name);
  let id = base;
  let i = 1;
  while (await prisma.customer.findUnique({ where: { custId: id } })) {
    id = `${base}${i}`;
    i++;
  }
  return id;
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} name
 * @param {string} custId
 * @returns {Promise<string>}
 */
export async function generateDeptId(prisma, name, custId) {
  const base = acronym(name).toUpperCase();
  let id = `${custId}-${base}`;
  let i = 1;
  while (await prisma.department.findUnique({ where: { deptId: id } })) {
    id = `${custId}-${base}${i}`;
    i++;
  }
  return id;
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} name - folder name (used for acronym fallback)
 * @param {string} shortName - optional explicit short name from user
 * @param {string} deptId
 * @returns {Promise<string>}
 */
export async function generateFolderId(prisma, name, shortName, deptId) {
  const base = (shortName || acronym(name)).toUpperCase();
  let id = `${deptId}-${base}`;
  let i = 1;
  while (await prisma.folder.findUnique({ where: { folderId: id } })) {
    id = `${deptId}-${base}${i}`;
    i++;
  }
  return id;
}
