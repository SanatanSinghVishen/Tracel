const { MemoryStore } = require('./memory_store');

describe('MemoryStore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('enforces maxPerOwner (LRU eviction)', () => {
    const store = new MemoryStore({ maxPerOwner: 3, ttlMinutes: 30 });
    const owner = 'user1';
    
    store.put({ id: 1, owner_user_id: owner, timestamp: new Date() });
    store.put({ id: 2, owner_user_id: owner, timestamp: new Date() });
    store.put({ id: 3, owner_user_id: owner, timestamp: new Date() });
    store.put({ id: 4, owner_user_id: owner, timestamp: new Date() }); // Should evict id 1

    const packets = store.getAll(owner);
    expect(packets.length).toBe(3);
    expect(packets[0].id).toBe(4);
    expect(packets[2].id).toBe(2);
  });

  test('evicts items older than ttlMinutes on read', () => {
    const store = new MemoryStore({ maxPerOwner: 10, ttlMinutes: 30 });
    const owner = 'user1';
    
    const now = Date.now();
    
    // Packet 1 is 31 minutes old (expired)
    store.put({ id: 1, owner_user_id: owner, timestamp: new Date(now - 31 * 60 * 1000) });
    
    // Packet 2 is 10 minutes old (valid)
    store.put({ id: 2, owner_user_id: owner, timestamp: new Date(now - 10 * 60 * 1000) });

    // Read to trigger eviction
    const packets = store.getAll(owner);
    expect(packets.length).toBe(1);
    expect(packets[0].id).toBe(2);
  });

  test('getStats returns accurate statistics', () => {
    const store = new MemoryStore({ maxPerOwner: 10, ttlMinutes: 30 });
    const owner = 'user1';
    const now = Date.now();
    
    store.put({ id: 1, owner_user_id: owner, timestamp: new Date(now - 10000) });
    store.put({ id: 2, owner_user_id: owner, timestamp: new Date(now) });

    const stats = store.getStats();
    expect(stats.size).toBe(2);
    expect(stats.maxSize).toBe(10);
    expect(new Date(stats.newestEntry).getTime()).toBe(now);
    expect(new Date(stats.oldestEntry).getTime()).toBe(now - 10000);
  });

  test('handles threats store independently', () => {
    const store = new MemoryStore({ maxPerOwner: 5, ttlMinutes: 30 });
    const owner = 'user1';
    
    store.put({ id: 1, owner_user_id: owner, is_anomaly: false, timestamp: new Date() });
    store.put({ id: 2, owner_user_id: owner, is_anomaly: true, timestamp: new Date() });

    const threats = store.query(owner, { anomaly: true });
    expect(threats.length).toBe(1);
    expect(threats[0].id).toBe(2);

    const packets = store.query(owner, { anomaly: false });
    expect(packets.length).toBe(2);
  });
});
