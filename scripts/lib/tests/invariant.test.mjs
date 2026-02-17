
import { getToolStatus } from '../front-door.mjs';
import assert from 'assert';

console.log('Running invariant test for front-door stability...');

const mockTool = { tags: [] };
const mockOverride = { featured: true };
const status = getToolStatus('test', mockTool, mockOverride);

assert.strictEqual(status.isFeatured, true, 'Featured status should be preserved');
assert.strictEqual(status.isInternal, false, 'Should not be internal by default');
assert.strictEqual(status.isFrontDoor, true, 'Should be front-door by default');

const internalOverride = { category: 'internal' };
const internalStatus = getToolStatus('test', mockTool, internalOverride);
assert.strictEqual(internalStatus.isInternal, true, 'Should rely on category');
assert.strictEqual(internalStatus.isFrontDoor, false, 'Internal implies not front-door');

console.log('Invariant test passed.');

