import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'fs';

const prisma = new PrismaClient();
const SQL_PATH = '../.hermes/desktop-attachments/ipsbcomm_billing (3).sql';

function extractInsertBlocks(sql) {
  const blocks = [];
  const regex = /INSERT INTO `(\w+)`\s*\(([^)]+)\)\s*VALUES\s*([\s\S]*?);/g;
  let m;
  while ((m = regex.exec(sql)) !== null) {
    blocks.push({ table: m[1], cols: m[2], values: m[3] });
  }
  return blocks;
}

function parseValues(colsRaw, valuesRaw) {
  const cols = colsRaw.split(',').map(c => c.trim().replace(/`/g, ''));
  const rows = [];

  // Split values into individual tuples: (val1,val2,...),(val3,...)
  let i = 0;
  const s = valuesRaw.trim();
  while (i < s.length) {
    if (s[i] === '(') {
      let tuple = '';
      let depth = 1;
      i++;
      while (i < s.length && depth > 0) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') { depth--; if (depth === 0) break; }
        tuple += s[i];
        i++;
      }
      rows.push(parseTuple(tuple, cols));
      i++;
    } else {
      i++;
    }
  }
  return rows;
}

function parseTuple(tuple, cols) {
  const values = [];
  let i = 0;
  while (i < tuple.length) {
    // Skip whitespace
    while (i < tuple.length && (tuple[i] === ' ' || tuple[i] === '\n' || tuple[i] === '\r' || tuple[i] === '\t')) i++;
    if (i >= tuple.length) break;

    if (tuple[i] === "'") {
      i++;
      let str = '';
      while (i < tuple.length) {
        if (tuple[i] === '\\' && i + 1 < tuple.length) { str += tuple[i + 1]; i += 2; continue; }
        if (tuple[i] === "'") { i++; break; }
        str += tuple[i];
        i++;
      }
      values.push(str);
    } else if (tuple.slice(i, i + 4) === 'NULL') {
      values.push(null);
      i += 4;
    } else {
      let num = '';
      while (i < tuple.length && tuple[i] !== ',' && tuple[i] !== ' ' && tuple[i] !== '\n' && tuple[i] !== '\r') {
        num += tuple[i]; i++;
      }
      if (num === '') { values.push(null); }
      else if (num.includes('.')) values.push(parseFloat(num));
      else if (/^-?\d+$/.test(num)) values.push(parseInt(num, 10));
      else values.push(num);
    }

    // Skip to next comma
    while (i < tuple.length && tuple[i] !== ',') i++;
    if (tuple[i] === ',') i++;
  }

  // Build row object
  const row = {};
  cols.forEach((col, idx) => { row[col] = idx < values.length ? values[idx] : null; });
  return row;
}

async function main() {
  console.log('Reading SQL dump...');
  const sql = fs.readFileSync(SQL_PATH, 'utf-8');
  const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;

  const blocks = extractInsertBlocks(sql);
  console.log(`Found ${blocks.length} INSERT blocks\n`);

  // Group by table
  const tables = {};
  for (const b of blocks) {
    if (!tables[b.table]) tables[b.table] = [];
    const rows = parseValues(b.cols, b.values);
    tables[b.table].push(...rows);
  }

  // Build lookup maps
  const custMap = {}; // legacy int id -> cust_id
  const deptMap = {}; // legacy int id -> dept_id
  const folderMap = {}; // legacy int id -> folder_id

  // 1. Users
  if (tables.user) {
    console.log(`--- Users (${tables.user.length}) ---`);
    for (const u of tables.user) {
      const existing = await prisma.user.findUnique({ where: { username: u.username } });
      if (existing) { console.log(`  Skip: ${u.username}`); continue; }
      const hashed = await bcrypt.hash(u.password || 'password123', rounds);
      await prisma.user.create({
        data: {
          username: u.username,
          password: hashed,
          userRole: u.user_role || 'user',
          email: u.email || `${u.username}@esas.local`,
          fullname: u.fullname || u.username,
        },
      });
      console.log(`  Added: ${u.username} (${u.user_role})`);
    }
  }

  // 2. Customers
  if (tables.customer) {
    console.log(`\n--- Customers (${tables.customer.length}) ---`);
    for (const c of tables.customer) {
      const existing = await prisma.customer.findUnique({ where: { custId: c.cust_id } });
      if (existing) { custMap[c.id] = c.cust_id; console.log(`  Skip: ${c.cust_name}`); continue; }
      await prisma.customer.create({
        data: { custId: c.cust_id, custName: c.cust_name, custDescription: c.cust_description || null },
      });
      custMap[c.id] = c.cust_id;
      console.log(`  Added: ${c.cust_name} (${c.cust_id})`);
    }
  }

  // 3. Prices
  if (tables.price) {
    console.log(`\n--- Prices (${tables.price.length}) ---`);
    for (const p of tables.price) {
      const custId = custMap[p.cust_id] || p.cust_id;
      const existing = await prisma.price.findFirst({ where: { custId, price: parseFloat(p.price) } });
      if (existing) { console.log(`  Skip: ${custId} @ ${p.price}`); continue; }
      await prisma.price.create({ data: { custId, price: parseFloat(p.price) } });
      console.log(`  Added: ${custId} @ ${p.price}`);
    }
  }

  // 4. Departments
  if (tables.department) {
    console.log(`\n--- Departments (${tables.department.length}) ---`);
    for (const d of tables.department) {
      const custId = custMap[d.cust_id] || d.cust_id;
      const existing = await prisma.department.findUnique({ where: { deptId: d.dept_id } });
      if (existing) { deptMap[d.id] = d.dept_id; continue; }
      await prisma.department.create({
        data: { deptId: d.dept_id, deptName: d.dept_name, deptDesc: d.dept_desc || null, custId },
      });
      deptMap[d.id] = d.dept_id;
      console.log(`  Added: ${d.dept_name} (${d.dept_id}) → ${custId}`);
    }
  }

  // 5. Folders
  if (tables.folder) {
    console.log(`\n--- Folders (${tables.folder.length}) ---`);
    for (const f of tables.folder) {
      const deptId = deptMap[f.dept_id] || f.dept_id;
      const existing = await prisma.folder.findUnique({ where: { folderId: f.folder_id } });
      if (existing) { folderMap[f.id] = f.folder_id; continue; }
      await prisma.folder.create({
        data: {
          folderId: f.folder_id,
          folderDirectory: f.folder_directory,
          folderName: f.folder_name,
          folderDesc: f.folder_desc || null,
          folderShortName: f.folder_short_name || null,
          deptId,
          ...(f.deleted_at && f.deleted_at !== 'NULL' ? { deletedAt: new Date(f.deleted_at) } : {}),
        },
      });
      folderMap[f.id] = f.folder_id;
      console.log(`  Added: ${f.folder_name} → ${deptId}`);
    }
  }

  // 6. Reports
  if (tables.report) {
    console.log(`\n--- Reports (${tables.report.length}) — importing...`);
    let rDone = 0, rSkip = 0;
    for (const r of tables.report) {
      const folderId = folderMap[r.folder_id] || r.folder_id;
      const custId = custMap[r.cust_id] || r.cust_id;
      const existing = await prisma.report.findFirst({
        where: { folderId, month: String(r.month).padStart(2, '0'), year: String(r.year), fileHash: r.file_hash || `legacy-${r.id}` },
      });
      if (existing) { rSkip++; continue; }
      try {
        await prisma.report.create({
          data: {
            folderId,
            usageSize: BigInt(r.usage_size || 0),
            month: String(r.month).padStart(2, '0'),
            year: String(r.year),
            pricePerGb: parseFloat(r.price_per_gb) || 0,
            fileHash: r.file_hash || `legacy-${r.id}`,
            fileName: r.file_name || null,
            folderDir: r.folder_dir || null,
            dirCount: parseInt(r.dir_count) || 0,
            fileCount: parseInt(r.file_count) || 0,
            adsCount: parseInt(r.ads_count) || 0,
            otherCount: parseInt(r.other_count) || 0,
            custId,
          },
        });
        rDone++;
        if (rDone % 500 === 0) console.log(`  ${rDone}/${tables.report.length}...`);
      } catch (e) {
        console.log(`  Error: ${e.message?.slice(0, 80)}`);
        rSkip++;
      }
    }
    console.log(`  Done: ${rDone} imported, ${rSkip} skipped`);
  }

  // 7. Breakdowns
  if (tables.breakdown) {
    console.log(`\n--- Breakdowns (${tables.breakdown.length}) ---`);
    let bDone = 0;
    for (const b of tables.breakdown) {
      const custId = custMap[b.cust_id] || b.cust_id;
      const month = String(b.month).padStart(2, '0');
      const year = String(b.year);
      const existing = await prisma.breakdown.findFirst({ where: { unit: b.unit, custId, month, year } });
      if (existing) { continue; }
      await prisma.breakdown.create({
        data: { unit: b.unit, usageSize: parseInt(b.usage_size) || 0, month, year, custId },
      });
      bDone++;
    }
    console.log(`  Done: ${bDone} imported`);
  }

  // 8. business_unit — skip (not in new schema)
  if (tables.business_unit) {
    console.log(`\n--- business_unit (${tables.business_unit.length}) — SKIPPED (not in new schema)`);
  }

  console.log('\n✅ Import complete.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
