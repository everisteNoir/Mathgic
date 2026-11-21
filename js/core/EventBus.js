/**
 * EventBus.js — Central Event Messaging System
 * Allows polyhedra, pointer interactions, and Mathgic plugins to communicate
 * without tight coupling.
 */
export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(callback);
    return () => this.off(eventName, callback);
  }

  off(eventName, callback) {
    const set = this.listeners.get(eventName);
    if (set) set.delete(callback);
  }

  emit(eventName, payload = {}) {
    const set = this.listeners.get(eventName);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(payload);
      } catch (err) {
        console.error(`[EventBus] Error handling event "${eventName}":`, err);
      }
    }
  }
}
