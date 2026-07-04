import { execSync } from 'node:child_process';
import type { Locale } from '../i18n';
import { site } from '../config';
import { parseContentFile } from '../content/notesLoader';
import { parse as parseYaml } from 'yaml';

export interface NoteRevision {
  sha: string;
  shortSha: string;
  date: Date;
  message: string;
}

export interface ParsedNoteContent {
  title: string;
  body: string;
}

export interface ParsedNoteMeta {
  description?: string;
  pubDate?: Date;
  tags: string[];
  exploreNext: Array<{ label: string; reason?: string; note?: string }>;
  exploredFrom?: string;
}

const FIELD_DELIM = '\x1f';

export function noteContentPath(locale: Locale, translationId: string): string {
  return `src/content/notes/${locale}/${translationId}/content.md`;
}

export function noteMetaPath(locale: Locale, translationId: string): string {
  return `src/content/notes/${locale}/${translationId}/meta.yaml`;
}

/** @deprecated Use noteContentPath — git history tracks content.md only */
export function noteFilePath(locale: Locale, translationId: string): string {
  return noteContentPath(locale, translationId);
}

function canReadGitHistory(): boolean {
  try {
    execSync('git rev-parse HEAD', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function getNoteRevisions(relativePath: string): NoteRevision[] {
  if (!canReadGitHistory()) return [];

  try {
    const output = execSync(`git log --follow --format=%H${FIELD_DELIM}%cI${FIELD_DELIM}%s -- "${relativePath}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    if (!output) return [];

    return output.split('\n').map((line) => {
      const [sha, dateIso, message] = line.split(FIELD_DELIM);
      return {
        sha,
        shortSha: sha.slice(0, 7),
        date: new Date(dateIso),
        message: message ?? '',
      };
    });
  } catch {
    return [];
  }
}

export function resolveRevisionSha(relativePath: string, shaPrefix: string): string | null {
  const revisions = getNoteRevisions(relativePath);
  const match = revisions.find(
    (revision) => revision.sha === shaPrefix || revision.sha.startsWith(shaPrefix),
  );
  return match?.sha ?? null;
}

export function getFileAtRevision(relativePath: string, sha: string): string | null {
  if (!canReadGitHistory()) return null;

  const fullSha = resolveRevisionSha(relativePath, sha);
  if (!fullSha) return null;

  try {
    return execSync(`git show ${fullSha}:"${relativePath}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

export function parseNoteMeta(raw: string): ParsedNoteMeta {
  const meta = parseYaml(raw) ?? {};

  return {
    description: typeof meta.description === 'string' ? meta.description : undefined,
    pubDate: meta.pubDate ? new Date(String(meta.pubDate)) : undefined,
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    exploreNext: Array.isArray(meta.exploreNext) ? meta.exploreNext : [],
    exploredFrom: typeof meta.exploredFrom === 'string' ? meta.exploredFrom : undefined,
  };
}

/** Parse content.md at a git revision (title + body only). */
export function parseNoteFile(raw: string): ParsedNoteContent {
  return parseContentFile(raw);
}

export function githubCommitUrl(sha: string): string {
  return `https://github.com/${site.githubUsername}/${site.githubRepo}/commit/${sha}`;
}

export function formatRevisionDate(date: Date, locale: Locale): string {
  return date.toLocaleDateString(locale === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatNoteDate(date: Date, locale: Locale): string {
  return date.toLocaleDateString(locale === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function getFirstWrittenDate(pubDate: Date, revisions: NoteRevision[]): Date {
  if (revisions.length === 0) return pubDate;
  return revisions[revisions.length - 1].date;
}

export function getLastUpdatedDate(revisions: NoteRevision[]): Date | null {
  if (revisions.length === 0) return null;
  return revisions[0].date;
}

export function shouldShowLastUpdated(firstWritten: Date, revisions: NoteRevision[]): boolean {
  const lastUpdated = getLastUpdatedDate(revisions);
  if (!lastUpdated) return false;

  const firstDay = firstWritten.toISOString().slice(0, 10);
  const updatedDay = lastUpdated.toISOString().slice(0, 10);
  return revisions.length > 1 || firstDay !== updatedDay;
}

export function githubContentDiffUrl(sha: string, contentPath: string): string {
  return `${githubCommitUrl(sha)}`;
}
