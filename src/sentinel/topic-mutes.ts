import type { Database as DatabaseType } from "better-sqlite3";

/**
 * A durable suppression rule for the Inquirer. When a person has already
 * settled a recurring question ("yes, these channels are still in use — stop
 * asking"), JR shouldn't keep re-forming the same knowledge-gap question every
 * time the underlying low-confidence insight regenerates.
 *
 * A mute matches a question when `keyword` (case-insensitive substring) appears
 * in the question's topic OR question_text. `person_user_id === null` makes the
 * mute global; otherwise it only applies to that target.
 */
export interface TopicMute {
  person_user_id: string | null;
  keyword: string;
}

export interface MutableQuestion {
  topic: string;
  question_text: string;
  target_user_id: string;
}

export function isQuestionMuted(q: MutableQuestion, mutes: TopicMute[]): boolean {
  const haystack = `${q.topic} ${q.question_text}`.toLowerCase();
  return mutes.some(
    (m) =>
      (m.person_user_id === null || m.person_user_id === q.target_user_id) &&
      m.keyword.length > 0 &&
      haystack.includes(m.keyword.toLowerCase()),
  );
}

export function filterMutedQuestions<T extends MutableQuestion>(
  questions: T[],
  mutes: TopicMute[],
): T[] {
  return questions.filter((q) => !isQuestionMuted(q, mutes));
}

export function loadTopicMutes(db: DatabaseType): TopicMute[] {
  return db.prepare("SELECT person_user_id, keyword FROM inquiry_topic_mutes").all() as TopicMute[];
}
