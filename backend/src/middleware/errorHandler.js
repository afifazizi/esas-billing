export function errorHandler(err, req, res, next) {
  console.error('Unhandled error:', err);

  if (err.name === 'ZodError') {
    const issues = err.issues || [];
    return res.status(400).json({
      error: 'Validation failed',
      details: issues.map((e) => ({
        path: Array.isArray(e.path) ? e.path.join('.') || '(root)' : '(root)',
        message: e.message,
      })),
    });
  }

  if (err.name === 'PrismaClientKnownRequestError') {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A record with that value already exists' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Record not found' });
    }
  }

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
}
