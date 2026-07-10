import { marked } from 'marked';
import { expandQuizCards, wrapQuizDeck } from './quizCards';

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function renderMarkdown(body: string): string {
  const html = marked.parse(expandQuizCards(body)) as string;
  return wrapQuizDeck(html);
}
