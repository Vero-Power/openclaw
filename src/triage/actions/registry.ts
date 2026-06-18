import type { CatalogAction, ActionContext } from "./types.js";

export class ActionRegistry {
  private actions = new Map<string, CatalogAction>();

  register(action: CatalogAction): void {
    if (this.actions.has(action.name)) {
      throw new Error(`action "${action.name}" is already registered`);
    }
    this.actions.set(action.name, action);
  }

  get(name: string): CatalogAction | null {
    return this.actions.get(name) ?? null;
  }

  list(): CatalogAction[] {
    return Array.from(this.actions.values());
  }

  async invoke(name: string, args: unknown, ctx: ActionContext): Promise<unknown> {
    const action = this.get(name);
    if (!action) {
      throw new Error(`unknown action: ${name}`);
    }
    const parsed = action.args_schema.parse(args);
    return action.invoke(parsed, ctx);
  }

  serializeForPrompt(): string {
    const lines = ["Available actions:"];
    for (const a of this.actions.values()) {
      const warn = a.external_effect ? " ⚠️" : "";
      const idem = a.idempotent ? " [idempotent]" : "";
      lines.push(`- ${a.name}${warn}${idem}: ${a.description}`);
    }
    return lines.join("\n");
  }
}
