/**
 * tool-ask.ts — parse the AskUserQuestion tool's input (questions + options)
 * and its tool_result text (the user's selected answers), for the tool-row
 * render. Pure (no React/DOM), unit-testable.
 */

export interface AskOption {
  label: string;
  description: string;
}

export interface AskQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: AskOption[];
}

export interface AskAnswer {
  question: string;
  header: string;
  /** Selected labels — multiple for multiSelect, one for single, or free text. */
  answers: string[];
}

const ASK_TOOLS = new Set(['askuserquestion', 'ask_user_question']);

export function isAskTool(name: string): boolean {
  return ASK_TOOLS.has(name.toLowerCase());
}

/** Parse AskUserQuestion input into AskQuestion[], or null when not applicable. */
export function parseAskQuestions(input: unknown): AskQuestion[] | null {
  if (!input || typeof input !== 'object') return null;
  const raw = (input as Record<string, unknown>).questions;
  if (!Array.isArray(raw)) return null;
  const questions: AskQuestion[] = raw.map((q) => {
    const o = (q || {}) as Record<string, unknown>;
    const options = Array.isArray(o.options)
      ? (o.options as unknown[]).map((opt) => {
          const oo = (opt || {}) as Record<string, unknown>;
          return {
            label: typeof oo.label === 'string' ? oo.label : '',
            description: typeof oo.description === 'string' ? oo.description : '',
          };
        })
      : [];
    return {
      question: typeof o.question === 'string' ? o.question : '',
      header: typeof o.header === 'string' ? o.header : '',
      multiSelect: o.multiSelect === true,
      options,
    };
  });
  return questions.length > 0 ? questions : null;
}

/**
 * Extract the user's selected answers from the AskUserQuestion tool_result text.
 *
 * The result contains `"<question>"="<answer>"` pairs (comma-separated across
 * questions), wrapped in prose that varies ("User has answered your questions: …"
 * / "Your questions have been answered: …"). For a multiSelect question the
 * answer value is itself a ", "-joined list of labels.
 *
 * Each `"Q"="A"` is paired to the input question by exact text (else by index),
 * and A is split on ", " only when that question is multiSelect. Free-text
 * ("Other") answers pass through unchanged.
 */
export function parseAskAnswers(result: string, input: unknown): AskAnswer[] {
  const questions = parseAskQuestions(input) || [];
  const pairs: { q: string; a: string }[] = [];
  const re = /"([^"]+)"\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(result)) !== null) {
    pairs.push({ q: m[1], a: m[2] });
  }

  if (questions.length > 0) {
    return questions
      .map((q, i) => {
        const pair = pairs.find((p) => p.q === q.question) ?? pairs[i];
        const rawAnswer = pair?.a ?? '';
        const answers = q.multiSelect
          ? rawAnswer.split(/,\s*/).map((s) => s.trim()).filter(Boolean)
          : rawAnswer
            ? [rawAnswer]
            : [];
        return { question: q.question, header: q.header, answers };
      })
      .filter((a) => a.answers.length > 0);
  }

  // No input available — surface whatever pairs we found.
  return pairs.filter((p) => p.a).map((p) => ({ question: p.q, header: '', answers: [p.a] }));
}
