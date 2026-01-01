import { EventEmitter } from "events";
import type { BusEvents } from "./types.js";

type EventCallback<T> = (data: T) => void | Promise<void>;

class EventBus {
  private emitter = new EventEmitter();

  publish<K extends keyof BusEvents>(event: K, data: BusEvents[K]): void {
    this.emitter.emit(event, data);
  }

  subscribe<K extends keyof BusEvents>(
    event: K,
    callback: EventCallback<BusEvents[K]>
  ): () => void {
    this.emitter.on(event, callback);
    return () => this.emitter.off(event, callback);
  }
}

// Singleton instance
export const bus = new EventBus();
