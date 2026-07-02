import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const dbFile = path.resolve('userData/anybuddy-checkpoints.db');
mkdirSync(path.dirname(dbFile), { recursive: true });
rmSync(dbFile, { force: true });

const cp = SqliteSaver.fromConnString(dbFile);

const config = { configurable: { thread_id: 'test-1' } };

const checkpoint = {
  v: 1,
  id: 'cp-1',
  ts: new Date().toISOString(),
  channel_values: { foo: 'bar' },
  channel_versions: { foo: 1 },
  versions_seen: { foo: 1 },
  pending_sends: [],
};
const metadata = { source: 'input', step: 0, parents: {} };

await cp.put(config, checkpoint, metadata);
const tuple = await cp.getTuple(config);
console.log('getTuple.checkpoint.channel_values:', tuple?.checkpoint?.channel_values);
console.log('getTuple.metadata.step:', tuple?.metadata?.step);

const listResult = [];
for await (const t of cp.list(config)) {
  listResult.push(t.checkpoint.id);
}
console.log('list ids:', listResult);

await cp.deleteThread('test-1');
const after = await cp.getTuple(config);
console.log('after delete:', after);

console.log('SMOKE_OK');
