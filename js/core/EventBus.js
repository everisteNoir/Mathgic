/**
 * EventBus.js — Central Event Messaging System
 * Allows polyhedra, pointer interactions, and mathematical spell plugins to communicate
 * without tight coupling.
 */
export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  /**
   * Subscribe to an event (e.g., 'FACE_CLICK', 'VERTEX_HOVER', 'SOLID_CHANGED')
   */
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(callback);
    return () => this.off(eventName, callback);
  }

  /**
   * Unsubscribe from an event
   */
  off(eventName, callback) {
    const set = this.listeners.get(eventName);
    if (set) set.delete(callback);
  }

  /**
   * Broadcast an event payload across the entire system
   */
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
