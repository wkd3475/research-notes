import { marked } from 'marked';
import { expandChatBubbles, wrapChatThreads } from './chatBubbles';
import { expandQuizCards, wrapQuizDeck } from './quizCards';

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function renderMarkdown(body: string): string {
  const preprocessed = expandChatBubbles(expandQuizCards(body));
  const html = marked.parse(preprocessed) as string;
  return wrapChatThreads(wrapQuizDeck(html));
}
