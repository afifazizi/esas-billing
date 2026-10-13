import { Router } from 'express';
import prisma from '../db.js';
import { authenticate, requireInternal } from '../middleware/auth.js';
import { auditLog } from '../utils/audit.js';
import { generateCustId } from '../utils/generateId.js';
import { z } from 'zod';

export const customerRouter = Router();
customerRouter.use(authenticate);
customerRouter.use(requireInternal);

async function resolveCustomerId(custId) {
  const requested = String(custId || '').trim();
  if (!requested) return requested;

  const exact = await prisma.customer.findUnique({
    where: { custId: requested },
    select: { custId: true },
  });
  if (exact) return exact.custId;

  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    select: { custId: true },
  });
  return customers.find((customer) => customer.custId.toLowerCase() === requested.toLowerCase())?.custId || requested;
}

const customerSchema = z.object({
  cust_id: z.string().min(1).max(255).optional(),
  cust_name: z.string().min(1).max(255),
  cust_description: z.string().max(1000).optional(),
  price: z.number().min(0).max(999999.9999),
  registeredAt: z.string().datetime().optional(),
  contractEndAt: z.string().datetime().optional(),
});

// GET /api/customers
customerRouter.get('/', async (req, res, next) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { deletedAt: null },
      include: {
        prices: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { departments: true, reports: true } },
      },
    });

    const latestReports = await Promise.all(customers.map(async (customer) => {
      const latest = await prisma.report.groupBy({
        by: ['year', 'month'],
        where: { custId: customer.custId, deletedAt: null },
        _count: { _all: true },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        take: 1,
      });
      return [customer.custId, latest[0] || null];
    }));
    const latestReportByCustomer = new Map(latestReports);

    res.json(customers.map(c => {
      const latestReport = latestReportByCustomer.get(c.custId);
      return {
        id: c.custId,
        name: c.custName,
        description: c.custDescription,
        price: c.prices[0]?.price || 0,
        departmentCount: c._count.departments,
        reportCount: c._count.reports,
        latestReport: latestReport ? {
          year: latestReport.year,
          month: latestReport.month,
          reportRows: latestReport._count._all,
        } : null,
        registeredAt: c.registeredAt,
        contractEndAt: c.contractEndAt,
      };
    }));
  } catch (err) {
    next(err);
  }
});

// POST /api/customers
customerRouter.post('/', async (req, res, next) => {
  try {
    const data = customerSchema.parse(req.body);

    const custId = data.cust_id || await generateCustId(prisma, data.cust_name);

    const existing = await prisma.customer.findUnique({ where: { custId } });
    if (existing) return res.status(409).json({ error: 'Customer ID already exists' });

    const customer = await prisma.customer.create({
      data: {
        custId,
        custName: data.cust_name,
        custDescription: data.cust_description,
        registeredAt: data.registeredAt ? new Date(data.registeredAt) : null,
        contractEndAt: data.contractEndAt ? new Date(data.contractEndAt) : null,
        prices: { create: { price: data.price } },
      },
    });

    await auditLog({
      userId: req.user.id,
      action: 'CREATE_CUSTOMER',
      entityType: 'Customer',
      entityId: customer.custId,
      newValue: { custId: customer.custId, custName: customer.custName, price: data.price },
      req,
    });

    res.status(201).json({
      id: customer.custId,
      name: customer.custName,
      price: data.price,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/customers/suggest-id?name=Media+Prima
customerRouter.get('/suggest-id', async (req, res, next) => {
  try {
    const name = req.query.name;
    if (!name) return res.status(400).json({ error: 'Query param "name" is required' });

    // Generate base ID: split by spaces, first letter of each word, lowercase
    const words = name.trim().split(/\s+/);
    let baseId;
    if (words.length === 1) {
      // Single word: take first 3-4 chars, lowercase
      baseId = words[0].slice(0, 4).toLowerCase();
    } else {
      // Multi-word: first letter of each word
      baseId = words.map(w => w[0]).join('').toLowerCase();
    }

    // Check if ID exists; if so, append incrementing number
    let custId = baseId;
    let counter = 1;
    while (await prisma.customer.findUnique({ where: { custId } })) {
      custId = `${baseId}${counter}`;
      counter++;
    }

    res.json({ custId });
  } catch (err) {
    next(err);
  }
});

// PUT /api/customers/:id
customerRouter.put('/:id', async (req, res, next) => {
  try {
    const data = customerSchema.partial().parse(req.body);

    const customer = await prisma.customer.findUnique({
      where: { custId: req.params.id },
      include: { prices: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!customer || customer.deletedAt) return res.status(404).json({ error: 'Customer not found' });

    const oldValue = {
      custName: customer.custName,
      custDescription: customer.custDescription,
      registeredAt: customer.registeredAt,
      contractEndAt: customer.contractEndAt,
      price: customer.prices[0]?.price,
    };

    await prisma.customer.update({
      where: { custId: req.params.id },
      data: {
        ...(data.cust_name && { custName: data.cust_name }),
        ...(data.cust_description !== undefined && { custDescription: data.cust_description }),
        ...(data.registeredAt !== undefined && { registeredAt: data.registeredAt ? new Date(data.registeredAt) : null }),
        ...(data.contractEndAt !== undefined && { contractEndAt: data.contractEndAt ? new Date(data.contractEndAt) : null }),
      },
    });

    if (data.price !== undefined) {
      await prisma.price.create({
        data: { custId: req.params.id, price: data.price },
      });
    }

    const newValue = {
      custName: data.cust_name || customer.custName,
      custDescription: data.cust_description !== undefined ? data.cust_description : customer.custDescription,
      price: data.price !== undefined ? data.price : oldValue.price,
    };
    await auditLog({
      userId: req.user.id,
      action: 'UPDATE_CUSTOMER',
      entityType: 'Customer',
      entityId: req.params.id,
      oldValue,
      newValue,
      req,
    });

    res.json({ message: 'Customer updated' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/customers/:id (soft delete)
customerRouter.delete('/:id', async (req, res, next) => {
  try {
    const customer = await prisma.customer.findUnique({ where: { custId: req.params.id } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    await prisma.customer.update({
      where: { custId: req.params.id },
      data: { deletedAt: new Date() },
    });

    await auditLog({
      userId: req.user.id,
      action: 'SOFT_DELETE_CUSTOMER',
      entityType: 'Customer',
      entityId: req.params.id,
      oldValue: { custName: customer.custName },
      req,
    });

    res.json({ message: 'Customer soft-deleted' });
  } catch (err) {
    next(err);
  }
});

// ─── Price Tiers ───

const priceTierSchema = z.object({
  label: z.string().max(255).optional(),
  price: z.number().min(0).max(999999.9999),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().optional(),
  isDefault: z.boolean().optional(),
});

// GET /api/customers/:id/prices
customerRouter.get('/:id/prices', async (req, res, next) => {
  try {
    const custId = await resolveCustomerId(req.params.id);
    const tiers = await prisma.price.findMany({
      where: { custId },
      orderBy: [{ isDefault: 'desc' }, { effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    res.json(tiers);
  } catch (err) {
    next(err);
  }
});

// POST /api/customers/:id/prices
customerRouter.post('/:id/prices', async (req, res, next) => {
  try {
    const data = priceTierSchema.parse(req.body);

    // If this is marked as default, unset any existing default
    if (data.isDefault) {
      await prisma.price.updateMany({
        where: { custId: req.params.id, isDefault: true },
        data: { isDefault: false },
      });
    }

    // If no tiers exist yet, make this the default automatically
    const count = await prisma.price.count({ where: { custId: req.params.id } });
    const isDefault = data.isDefault ?? (count === 0);

    const tier = await prisma.price.create({
      data: {
        custId: req.params.id,
        label: data.label,
        price: data.price,
        effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : null,
        effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
        isDefault,
      },
    });

    res.status(201).json(tier);
  } catch (err) {
    next(err);
  }
});

// PUT /api/prices/:id
customerRouter.put('/prices/:id', async (req, res, next) => {
  try {
    const data = priceTierSchema.partial().parse(req.body);
    const tier = await prisma.price.findUnique({ where: { id: req.params.id } });
    if (!tier) return res.status(404).json({ error: 'Price tier not found' });

    if (data.isDefault) {
      await prisma.price.updateMany({
        where: { custId: tier.custId, isDefault: true, id: { not: req.params.id } },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.price.update({
      where: { id: req.params.id },
      data: {
        ...(data.label !== undefined && { label: data.label }),
        ...(data.price !== undefined && { price: data.price }),
        ...(data.effectiveFrom !== undefined && { effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : null }),
        ...(data.effectiveTo !== undefined && { effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null }),
        ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/prices/:id
customerRouter.delete('/prices/:id', async (req, res, next) => {
  try {
    const tier = await prisma.price.findUnique({ where: { id: req.params.id } });
    if (!tier) return res.status(404).json({ error: 'Price tier not found' });

    await prisma.price.delete({ where: { id: req.params.id } });
    res.json({ message: 'Price tier deleted' });
  } catch (err) {
    next(err);
  }
});
