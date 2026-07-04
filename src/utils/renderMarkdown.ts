import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function renderMarkdown(body: string): string {
  return marked.parse(body) as string;
}
