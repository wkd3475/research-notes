export type Locale = 'en' | 'ko';

export const locales: Locale[] = ['en', 'ko'];
export const defaultLocale: Locale = 'en';

export const ui = {
  en: {
    siteDescription: 'Diving deep until the questions clear',
    homePageLead: 'Not a polished archive—a study engine.',
    homePageDesc:
      'I record what I explore with AI, notice what I still don’t know, and follow the next thread. Deep dives matter, but the goal is to read widely as a habit—building background knowledge naturally along the way.',
    homeMetaDescription:
      'A study engine—not a polished archive. Record explorations with AI, read widely, build background knowledge.',
    home: 'Home',
    notes: 'Notes',
    readingQueue: 'Reading Queue',
    recentNotes: 'Recent Notes',
    allNotes: 'View all notes',
    noNotes: 'No notes yet.',
    notesPageDesc: 'Study notes, organized.',
    readingQueueDesc: 'Articles saved to read later — with why each one is worth your time.',
    savedOn: 'Saved',
    noReadingQueue: 'Nothing saved yet.',
    backToNotes: '← All notes',
    studyGrass: 'Study Grass',
    studyGrassDesc:
      'Writing activity for this blog. Each green cell is a day with notes — separate from your GitHub profile.',
    totalNotes: 'Notes',
    activeDays: 'Active days',
    longestStreak: 'Best streak',
    noNotesDay: 'No notes',
    less: 'Less',
    more: 'More',
    grassScrollHint: '← Swipe for older entries',
    nextResearch: 'Next Research',
    previousResearch: 'Previous Research',
    pendingNote: 'Not written yet',
    pendingCopyHint: 'Click to copy a study guide for AI',
    copyGuideToast: 'Next research guide copied to clipboard',
    footer: 'Study log',
    langSwitch: 'Korean',
    themePicker: 'Choose color theme',
    notesThisMonth: (n: number) => `${n} note${n === 1 ? '' : 's'} this month`,
    noNotesThisMonth: 'No notes this month.',
    noNotesEarlier: 'No earlier notes.',
    prevResearch: '← Earlier research',
    nextResearchMonth: 'Next month →',
    noNextMonth: 'No next month →',
    monthEmptyWithPrev: 'No notes this month. Closest earlier month:',
    monthEmptyFirst: 'This is your first month of notes. Nothing earlier.',
    monthEmpty: 'No notes this month.',
    dayNotes: (n: number) => `${n} note${n === 1 ? '' : 's'} on this day`,
    skippedMonths: (months: string) => `No notes in ${months}`,
    sectionWhy: 'Why I looked this up',
    sectionFelt: 'What stood out',
    sectionLearned: 'What I learned',
    sectionMemo: 'Memo',
    published: 'First written',
    firstWritten: 'First written',
    lastUpdated: 'Last updated',
    viewEditHistory: 'View edit history',
    currentVersion: 'Current',
    viewDiff: 'Diff',
    viewingRevision: 'Viewing an earlier version from',
    backToCurrent: '← Back to current version',
    taggedWith: (tag: string) => `#${tag}`,
    tagPageDesc: (tag: string) => `Notes and saved articles tagged “${tag}”.`,
    taggedNotes: 'Notes',
    taggedReadingQueue: 'Reading Queue',
    noTaggedItems: (tag: string) => `Nothing tagged “${tag}”.`,
  },
  ko: {
    siteDescription: '궁금한 건, 끝까지 파보기',
    homePageLead:
      '정리된 지식을 쌓아두는 곳이 아닙니다. 끊임없이 공부하게 만드는 기록장이에요.',
    homePageDesc:
      'AI와 대화하며 찾아본 걸 남기고, 뭘 아직 모르는지·뭘 더 봐야 하는지 짚으며 다음 질문으로 이어갑니다. 각 잡고 공부하는 것도 좋지만, 평소 습관처럼 많은 정보를 읽으며 배경 지식을 자연스럽게 넓혀가는 것이 목표입니다.',
    homeMetaDescription:
      '정리된 지식 저장소가 아닌 공부 기록장. AI와 함께 탐색하고, 습관처럼 많이 읽으며 배경 지식 넓히기.',
    home: '홈',
    notes: '노트',
    readingQueue: '읽을 글',
    recentNotes: '최근 노트',
    allNotes: '모든 노트 보기',
    noNotes: '아직 작성된 노트가 없습니다.',
    notesPageDesc: '공부한 내용을 정리한 기록들입니다.',
    readingQueueDesc: '나중에 읽으려고 킵해 둔 글 — 왜 저장했는지 이유와 함께.',
    savedOn: '저장',
    noReadingQueue: '아직 킵해 둔 글이 없습니다.',
    backToNotes: '← 모든 노트',
    studyGrass: 'Study Grass',
    studyGrassDesc:
      '이 블로그에 작성한 노트 기록입니다. GitHub 계정 잔디와는 별개로, 노트를 남긴 날만 초록색으로 표시됩니다.',
    totalNotes: '총 노트',
    activeDays: '기록한 날',
    longestStreak: '최장 연속 기록',
    noNotesDay: '작성한 노트 없음',
    less: '적음',
    more: '많음',
    grassScrollHint: '← 스와이프하면 과거 기록',
    nextResearch: 'Next Research',
    previousResearch: '이전 리서치',
    pendingNote: '아직 작성 전',
    pendingCopyHint: '클릭하면 AI에게 물어볼 가이드가 복사됩니다',
    copyGuideToast: '다음 연구를 위한 가이드가 복사되었어요',
    footer: '공부 기록',
    langSwitch: 'English',
    themePicker: '색상 테마 선택',
    notesThisMonth: (n: number) => `이 달에 작성한 노트 ${n}개`,
    noNotesThisMonth: '이 달에 작성한 노트가 없습니다.',
    noNotesEarlier: '이전 작성 기록 없음',
    prevResearch: '← 이전 리서치',
    nextResearchMonth: '다음 달 →',
    noNextMonth: '다음 작성 월 없음 →',
    monthEmptyWithPrev: '이 달에는 작성한 노트가 없습니다. 가장 가까운 이전 작성 월:',
    monthEmptyFirst: '이 달이 첫 작성 월입니다. 이전에 작성된 노트가 없습니다.',
    monthEmpty: '이 달에는 작성한 노트가 없습니다.',
    dayNotes: (n: number) => `이 날 작성한 노트 ${n}개`,
    skippedMonths: (months: string) => `${months}에는 작성한 글이 없어요`,
    sectionWhy: '왜 이 글을 찾아봤나',
    sectionFelt: '읽으면서 느낀 점',
    sectionLearned: '배운 것',
    sectionMemo: '메모',
    published: '최초 작성일',
    firstWritten: '최초 작성일',
    lastUpdated: '마지막 업데이트',
    viewEditHistory: '수정 이력 보기',
    currentVersion: '현재',
    viewDiff: 'Diff',
    viewingRevision: '이전 버전 보기',
    backToCurrent: '← 현재 글로 돌아가기',
    taggedWith: (tag: string) => `#${tag}`,
    tagPageDesc: (tag: string) => `“${tag}” 태그가 붙은 노트와 읽을 글.`,
    taggedNotes: '노트',
    taggedReadingQueue: '읽을 글',
    noTaggedItems: (tag: string) => `“${tag}” 태그가 붙은 항목이 없습니다.`,
  },
} as const;

export function t(locale: Locale) {
  return ui[locale];
}

export function parseNoteId(id: string): { locale: Locale; translationId: string } {
  const [first, ...rest] = id.split('/');
  if ((first === 'en' || first === 'ko') && rest.length > 0) {
    return { locale: first, translationId: rest.join('/') };
  }
  return { locale: defaultLocale, translationId: id };
}

export function noteId(locale: Locale, translationId: string): string {
  return `${locale}/${translationId}`;
}

export function isLocale(value: string): value is Locale {
  return value === 'en' || value === 'ko';
}

export function localePath(locale: Locale, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `/${locale}${clean === '/' ? '/' : clean}`;
}
