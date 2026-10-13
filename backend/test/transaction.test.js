import test from 'node:test';
import assert from 'node:assert/strict';
import { runSerializableTransaction } from '../src/services/transaction.js';

test('serializable transactions retry bounded write conflicts', async () => {
  let attempts = 0;
  const options = [];
  const db = {
    async $transaction(operation, transactionOptions) {
      attempts += 1;
      options.push(transactionOptions);
      if (attempts < 3) throw Object.assign(new Error('write conflict'), { code: 'P2034' });
      return operation({});
    },
  };

  const result = await runSerializableTransaction(db, async () => 'done');
  assert.equal(result, 'done');
  assert.equal(attempts, 3);
  assert.deepEqual(options, Array(3).fill({ isolationLevel: 'Serializable' }));
});

test('serializable transactions do not retry unrelated failures', async () => {
  let attempts = 0;
  const failure = Object.assign(new Error('audit failed'), { code: 'P2003' });
  const db = {
    async $transaction() {
      attempts += 1;
      throw failure;
    },
  };

  await assert.rejects(() => runSerializableTransaction(db, async () => null), failure);
  assert.equal(attempts, 1);
});
