import type { Locale } from '../i18n';

export function buildNextResearchPrompt(
  locale: Locale,
  item: { label: string; reason?: string },
  fromTitle?: string,
): string {
  if (locale === 'ko') {
    const lines = [
      '다음 주제를 연구 노트로 정리하려고 합니다. 무엇부터 공부하면 좋을지 가이드를 부탁합니다.',
      '',
    ];
    if (fromTitle) lines.push(`**관련 노트:** ${fromTitle}`);
    lines.push(`**다음 연구 주제:** ${item.label}`);
    if (item.reason) lines.push(`**이 주제를 찾아보는 이유:** ${item.reason}`);
    lines.push(
      '',
      '다음을 알려주세요:',
      '1. 먼저 읽어야 할 공식 문서·글·자료 (URL 있으면 함께)',
      '2. 꼭 이해해야 할 핵심 개념',
      '3. 공부하면서 스스로에게 던져볼 질문 3~5개',
      '4. 이 주제를 다룬 뒤 이어서 볼 만한 다음 주제',
    );
    return lines.join('\n');
  }

  const lines = [
    'I want to study the following topic for my research notes. Please guide me on where to start.',
    '',
  ];
  if (fromTitle) lines.push(`**Related note:** ${fromTitle}`);
  lines.push(`**Next research topic:** ${item.label}`);
  if (item.reason) lines.push(`**Why I want to explore this:** ${item.reason}`);
  lines.push(
    '',
    'Please help with:',
    '1. Official docs, articles, or resources to read first (with URLs if possible)',
    '2. Key concepts I need to understand',
    '3. Three to five questions to answer while studying',
    '4. Natural follow-up topics after this one',
  );
  return lines.join('\n');
}

export function encodeCopyText(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64');
}
