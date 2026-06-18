export interface ConversationsInfoClient {
  conversations: {
    info(args: { channel: string }): Promise<{
      ok: boolean;
      channel?: { id?: string; name?: string; is_archived?: boolean };
      error?: string;
    }>;
  };
}

export class ChannelNameResolver {
  private cache = new Map<string, string | null>();
  private maxSize = 500;

  constructor(private client: ConversationsInfoClient) {}

  /** Returns the channel name (without #), or null if unknown / not found. */
  async resolve(channelId: string): Promise<string | null> {
    if (this.cache.has(channelId)) {
      return this.cache.get(channelId) ?? null;
    }
    try {
      const resp = await this.client.conversations.info({ channel: channelId });
      const name = resp.ok && resp.channel?.name ? resp.channel.name : null;
      this.set(channelId, name);
      return name;
    } catch {
      this.set(channelId, null);
      return null;
    }
  }

  /**
   * Rewrite any channel-ID references in `text` so they include the actual
   * channel name. Matches both `<#CXXX>` (Slack auto-link syntax) and bare
   * `CXXX` / `#CXXX` tokens. Output format:
   *   "<#CXXX|name>"   when name is known (Slack will render as #name link)
   *   "<#CXXX>"        when name is unknown (Slack will still render the link)
   */
  async enrichText(text: string): Promise<string> {
    const idPattern = /(?:<#)?#?(C[A-Z0-9]{8,})\b>?/g;
    const seen = new Set<string>();
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = idPattern.exec(text)) !== null) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        matches.push(m[1]);
      }
    }
    if (matches.length === 0) {
      return text;
    }
    const names = await Promise.all(matches.map((id) => this.resolve(id)));
    let out = text;
    for (let i = 0; i < matches.length; i++) {
      const id = matches[i];
      const name = names[i];
      const replacement = name ? `<#${id}|${name}>` : `<#${id}>`;
      // Replace all forms: <#CXXX>, #CXXX, plain CXXX.
      const re = new RegExp(`(?:<#)?#?${id}\\b>?`, "g");
      out = out.replace(re, replacement);
    }
    return out;
  }

  private set(id: string, name: string | null): void {
    if (this.cache.size >= this.maxSize) {
      // Drop oldest entry (Map iteration is insertion order)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(id, name);
  }
}
