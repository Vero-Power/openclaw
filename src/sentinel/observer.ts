import type { Observation } from "./types.js";

export interface Observer {
  readonly name: string;
  observe(since: number): Promise<Omit<Observation, "id" | "created_at">[]>;
}

export class ObserverRegistry {
  private observers = new Map<string, Observer>();

  register(observer: Observer): void {
    if (this.observers.has(observer.name)) {
      throw new Error(`observer "${observer.name}" is already registered`);
    }
    this.observers.set(observer.name, observer);
  }

  list(): Observer[] {
    return Array.from(this.observers.values());
  }

  get(name: string): Observer | null {
    return this.observers.get(name) ?? null;
  }
}
