/**
 * Test suite for Collection Mutation Persistence Bugs in Legend-State
 *
 * This file contains tests that demonstrate and verify bugs where using mutation methods
 * on observable collections does not trigger persistence correctly, while using set() works.
 *
 * Bug Description:
 * - When using obs.array.push(item) or obs.map.delete(key), only individual changes are persisted
 * - Existing elements/entries are lost in the persisted data
 * - The observable state appears correct but persistence is corrupted
 *
 * Root Cause:
 * - Fast path optimizations for collection mutations (push, delete, etc.)
 * - Only notify about individual index/key changes, not complete collection changes
 * - Persistence layer expects complete collection change notifications for proper storage
 *
 * Affected Operations:
 * - Array: push() with single argument, direct index assignment
 * - Map: delete(), and likely other mutation methods
 */

import { applyChanges } from '../src/helpers';
import { observable } from '../src/observable';
import type { Change } from '../src/observableInterfaces';
import { configureSynced } from '../src/sync/configureSynced';
import { synced } from '../src/sync/synced';
import { syncObservable } from '../src/sync/syncObservable';
import type { ObservablePersistPlugin, PersistMetadata, PersistOptions } from '../src/sync/syncTypes';
import { when } from '../src/when';
import { getPersistName, promiseTimeout } from './testglobals';

// ===== Mock Storage =====

interface MockStorage {
    [table: string]: any;
}

const mockStorage: MockStorage = {};

// ===== Mock Persistence Plugin =====

/**
 * Generic mock persistence plugin for testing the array push bug
 * This simulates any persistence plugin (localStorage, IndexedDB, etc.)
 */
class MockPersistPlugin implements ObservablePersistPlugin {
    async initialize() {
        // No initialization needed for mock
    }

    async loadTable(table: string, _config: PersistOptions): Promise<any> {
        console.log(`MockPlugin: Loading from table '${table}'`);
        return mockStorage[table] || undefined;
    }

    getTable<T = any>(table: string, init: object, _config: PersistOptions): T {
        return (mockStorage[table] || init) as T;
    }

    async set(table: string, changes: Change[], _config: PersistOptions) {
        console.log(`MockPlugin: Setting changes for table '${table}':`, changes);

        if (!mockStorage[table]) {
            mockStorage[table] = {};
        }

        mockStorage[table] = applyChanges(mockStorage[table] as object, changes);
        console.log(`MockPlugin: Stored value:`, JSON.stringify(mockStorage[table], null, 2));
    }

    async deleteTable(table: string, _config: PersistOptions) {
        console.log(`MockPlugin: Deleting entire table '${table}'`);
        delete mockStorage[table];
    }

    getMetadata(_table: string, _config: PersistOptions): PersistMetadata {
        return {};
    }

    async setMetadata(_table: string, _metadata: PersistMetadata, _config: PersistOptions) {
        // Mock doesn't need metadata
    }

    async deleteMetadata(_table: string, _config: PersistOptions) {
        // Mock doesn't need metadata
    }
}

// ===== Test Helpers =====

/**
 * Resets the mock storage to ensure test isolation
 */
function resetMockStorage(): void {
    Object.keys(mockStorage).forEach((key) => {
        delete mockStorage[key];
    });
}

// ===== Plugin Configuration =====

const mockPlugin = new MockPersistPlugin();
const mySynced = configureSynced(synced, {
    persist: {
        plugin: mockPlugin,
    },
});

describe('Array Push Persistence Bug Tests', () => {
    beforeEach(() => {
        resetMockStorage();
        jest.clearAllMocks();
    });

    describe('Bug 1 - Array push() or direct index assignment persists as sparse object if its the first mutation', () => {
        // Compares array persistence with push() vs set(), showing that push() incorrectly persists as a sparse object.
        test('Array persisted as object when using push()', async () => {
            const persistName = getPersistName();
            const obsPush = observable<string[]>();
            const statePush = syncObservable(
                obsPush,
                mySynced({
                    persist: { name: persistName + 'push' },
                }),
            );
            const obsSet = observable<string[]>();
            const stateSet = syncObservable(
                obsSet,
                mySynced({
                    persist: { name: persistName + 'set' },
                }),
            );

            await when(statePush.isPersistLoaded);
            await when(stateSet.isPersistLoaded);

            // change observable using push()
            obsPush.push('item1');
            obsPush.push('item2');
            obsPush.push('item3');

            // change observable using set()
            obsSet.set(['item1']);
            obsSet.set((prev) => [...(prev ?? []), 'item2']);
            obsSet.set((prev) => [...(prev ?? []), 'item3']);

            await promiseTimeout(150);

            const storedPush = mockStorage[persistName + 'push'];
            console.log('Expected items: ["item1", "item2", "item3"] - Actual items:', storedPush);

            const storedSet = mockStorage[persistName + 'set'];
            console.log('Expected items: ["item1", "item2", "item3"] - Actual items:', storedSet);

            // expectations fail due to the bug (it persists as an object with sparse indices)
            expect(storedPush).toEqual(['item1', 'item2', 'item3']);
            // Expectation for set() works correctly
            expect(storedSet).toEqual(['item1', 'item2', 'item3']);
        });

        // Compares array persistence with direct index assignment vs set(), showing that push() incorrectly persists as a sparse object.
        test('Array persisted as object when using push()', async () => {
            const persistName = getPersistName();
            const obsPush = observable<string[]>();
            const statePush = syncObservable(
                obsPush,
                mySynced({
                    persist: { name: persistName + 'push' },
                }),
            );
            const obsSet = observable<string[]>();
            const stateSet = syncObservable(
                obsSet,
                mySynced({
                    persist: { name: persistName + 'set' },
                }),
            );

            await when(statePush.isPersistLoaded);
            await when(stateSet.isPersistLoaded);

            // change observable using push()
            obsPush[0].set('item1');
            obsPush[1].set('item2');
            obsPush[2].set('item3');

            // change observable using set()
            obsSet.set(['item1']);
            obsSet.set((prev) => [...(prev ?? []), 'item2']);
            obsSet.set((prev) => [...(prev ?? []), 'item3']);

            await promiseTimeout(150);

            const storedPush = mockStorage[persistName + 'push'];
            console.log('Expected items: ["item1", "item2", "item3"] - Actual items:', storedPush);

            const storedSet = mockStorage[persistName + 'set'];
            console.log('Expected items: ["item1", "item2", "item3"] - Actual items:', storedSet);

            // expectations fail due to the bug (it persists as an object with sparse indices)
            expect(storedPush).toEqual(['item1', 'item2', 'item3']);
            // Expectation for set() works correctly
            expect(storedSet).toEqual(['item1', 'item2', 'item3']);
        });

        // demonstrates that the bug is not present when push is not the first mutation
        test('Array persisted correctly when first calling set() and then push()', async () => {
            const persistName = getPersistName();
            const obs = observable<string[]>();
            const state = syncObservable(
                obs,
                mySynced({
                    persist: { name: persistName },
                }),
            );

            await when(state.isPersistLoaded);

            // change observable using push()
            obs.set(['item1']);
            obs[1].set('item2');
            obs.push('item3');

            await promiseTimeout(150);

            const stored = mockStorage[persistName];
            console.log('Expected items: ["item1", "item2", "item3"] - Actual items:', stored);

            // Expectation for set() works correctly
            expect(stored).toEqual(['item1', 'item2', 'item3']);
        });
    });

    describe('Bug 2 - Array with initial value: initial value is not persisted', () => {
        test('initial value is not persisted', async () => {
            const initialValue = ['item1', 'item2'];
            const persistName = getPersistName();
            const obs = observable(initialValue);
            const state = syncObservable(
                obs,
                mySynced({
                    persist: { name: persistName },
                }),
            );
            await when(state.isPersistLoaded);
            await promiseTimeout(150);
            const stored = mockStorage[persistName];
            console.log('Expected stored:', initialValue, 'Actual stored:', stored);
            // fails because stored is empty
            expect(stored).toEqual(initialValue);
        });
    });

    describe('Bug 3 - Map delete() causes persisted data corruption', () => {
        test('Map delete() loses persisted data', async () => {
            const persistName = getPersistName();
            const obs = observable(
                new Map([
                    ['key1', 'value1'],
                    ['key2', 'value2'],
                    ['key3', 'value3'],
                ]),
            );

            const state = syncObservable(
                obs,
                mySynced({
                    persist: { name: persistName },
                }),
            );

            await when(state.isPersistLoaded);
            // Use Map.delete() - this has similar issues to array.push()
            obs.delete('key2');

            await promiseTimeout(150);

            const stored = mockStorage[persistName];

            // This demonstrates the bug - only the deleted key with undefined value is stored
            expect(stored).not.toEqual({ key2: undefined });
            // What we SHOULD expect (but fails due to the bug):
            expect(stored).toEqual({ key1: 'value1', key3: 'value3' });
        });
    });
});
