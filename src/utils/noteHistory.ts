import { execSync } from 'node:child_process';
import type { Locale } from '../i18n';
import { site } from '../config';

export interface NoteRevision {
  sha: string;
  shortSha: string;
  date: Date;
  message: string;
}

export interface ParsedNoteFile {
  title: string;
  description?: string;
  pubDate?: Date;
  tags: string[];
  body: string;
}

const FIELD_DELIM = '\x1f';

export function noteFilePath(locale: Locale, translationId: string): string {
  return `src/content/notes/${locale}/${translationId}.md`;
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

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseTagsBlock(yaml: string): string[] {
  const lines = yaml.split('\n');
  const tags: string[] = [];
  let inTags = false;

  for (const line of lines) {
    if (/^tags:\s*\[/.test(line)) {
      const inline = line.match(/^tags:\s*\[(.*)\]\s*$/);
      if (inline?.[1]) {
        return inline[1]
          .split(',')
          .map((tag) => unquote(tag.trim()))
          .filter(Boolean);
      }
    }

    if (/^tags:\s*$/.test(line)) {
      inTags = true;
      continue;
    }

    if (inTags) {
      const item = line.match(/^\s*-\s*(.+)$/);
      if (item) {
        tags.push(unquote(item[1]));
        continue;
      }
      if (line.trim() !== '' && !/^\s/.test(line)) {
        inTags = false;
      }
    }
  }

  return tags;
}

export function parseNoteFile(raw: string): ParsedNoteFile {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { title: 'Untitled', tags: [], body: raw };
  }

  const [, yaml, body] = match;
  const titleMatch = yaml.match(/^title:\s*(.+)$/m);
  const descriptionMatch = yaml.match(/^description:\s*(.+)$/m);
  const pubDateMatch = yaml.match(/^pubDate:\s*(.+)$/m);

  return {
    title: titleMatch ? unquote(titleMatch[1]) : 'Untitled',
    description: descriptionMatch ? unquote(descriptionMatch[1]) : undefined,
    pubDate: pubDateMatch ? new Date(unquote(pubDateMatch[1])) : undefined,
    tags: parseTagsBlock(yaml),
    body,
  };
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

export function shouldShowLastUpdated(pubDate: Date, revisions: NoteRevision[]): boolean {
  if (revisions.length === 0) return false;
  const lastUpdated = revisions[0].date;
  const pubDay = pubDate.toISOString().slice(0, 10);
  const updatedDay = lastUpdated.toISOString().slice(0, 10);
  return revisions.length > 1 || pubDay !== updatedDay;
}
