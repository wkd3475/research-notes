import { marked } from 'marked';

/** Fenced chat blocks in note markdown (see add-research-note skill). */
const CHAT_BLOCK_RE = /:::chat\s+(teacher|student)(?:\s+([^\r\n]+))?\r?\n([\s\S]*?)\r?\n:::/g;

const DEFAULT_LABELS: Record<string, string> = {
  teacher: 'Teacher',
  student: 'Student',
};

/**
 * Expand `:::chat teacher` / `:::chat student` blocks into left/right chat bubbles.
 * Optional custom label: `:::chat teacher 선생님`
 */
export function expandChatBubbles(markdown: string): string {
  return markdown.replace(CHAT_BLOCK_RE, (_, role: string, label: string | undefined, body: string) => {
    const displayLabel = label?.trim() || DEFAULT_LABELS[role] || role;
    const bodyHtml = body.trim() ? (marked.parse(body.trim()) as string) : '';

    return `<div class="chat-bubble chat-bubble--${role}">
<span class="chat-bubble__label">${displayLabel}</span>
<div class="chat-bubble__body">${bodyHtml}</div>
</div>`;
  });
}

export function wrapChatThreads(html: string): string {
  if (!html.includes('chat-bubble')) return html;

  return html.replace(
    /((?:<div class="chat-bubble[^"]*">[\s\S]*?<\/div>\s*<\/div>\s*)+)/g,
    '<div class="chat-thread">$1</div>',
  );
}
