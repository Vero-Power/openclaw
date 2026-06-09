/**
 * Minimal Slack Web API surface needed by the messaging catalog actions.
 * Typed narrowly so tests can inject a simple mock without pulling in the full
 * @slack/web-api package.
 */
export interface SlackClientLike {
  chat: {
    postMessage(args: {
      token: string;
      channel: string;
      text: string;
      thread_ts?: string;
    }): Promise<{ ok?: boolean; ts?: string }>;
  };
  conversations: {
    open(args: {
      token: string;
      users: string;
    }): Promise<{ ok?: boolean; channel?: { id?: string } }>;
  };
}

export interface SlackMessageDeps {
  client: SlackClientLike;
  token: string;
}
