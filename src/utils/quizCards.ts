import { marked } from 'marked';

/** Fenced quiz blocks in note markdown (see add-research-note skill). */
const QUIZ_BLOCK_RE = /:::quiz\r?\n([\s\S]*?)\r?\n:::/g;

/**
 * Expand `:::quiz` blocks into clickable <details> cards (answer hidden until open).
 * Question and answer are separated by a line containing only `---`.
 */
export function expandQuizCards(markdown: string): string {
  return markdown.replace(QUIZ_BLOCK_RE, (_, block: string) => {
    const parts = block.split(/\r?\n---\r?\n/);
    const question = parts[0]?.trim() ?? '';
    const answer = parts.slice(1).join('\n---\n').trim();

    const questionHtml = question ? (marked.parseInline(question) as string) : '';
    const answerHtml = answer ? (marked.parse(answer) as string) : '';

    return `<details class="quiz-card">
<summary class="quiz-card__question"><span class="quiz-card__question-text">${questionHtml}</span></summary>
<div class="quiz-card__answer">${answerHtml}</div>
</details>`;
  });
}

export function wrapQuizDeck(html: string): string {
  if (!html.includes('class="quiz-card"')) return html;

  return html.replace(
    /((?:<details class="quiz-card">[\s\S]*?<\/details>\s*)+)/g,
    '<div class="quiz-deck">$1</div>',
  );
}
