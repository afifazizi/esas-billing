const SERIALIZABLE_OPTIONS = { isolationLevel: 'Serializable' };
const DEFAULT_MAX_ATTEMPTS = 3;

export async function runSerializableTransaction(db, operation, maxAttempts = DEFAULT_MAX_ATTEMPTS) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await db.$transaction(operation, SERIALIZABLE_OPTIONS);
    } catch (error) {
      if (error?.code !== 'P2034' || attempt === maxAttempts) throw error;
    }
  }

  throw new Error('Serializable transaction retry limit exceeded');
}
