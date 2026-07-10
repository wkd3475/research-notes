#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/new-note.sh <slug> "<title>" [options]

Options:
  --date YYYY-MM-DD     pubDate (default: today KST)
  --desc "text"         description (EN; use --desc-ko for Korean)
  --desc-ko "text"      Korean description
  --tags "a,b,c"        comma-separated tags
  --from <parent-slug>  sets exploredFrom
  --both                create en + ko pair (default)
  --en-only             English only
  --dry-run             print template only

Example:
  scripts/new-note.sh react-hooks "React Hooks" --desc-ko "React Hooks 정리" --both
EOF
  exit 1
}

[[ $# -lt 2 ]] && usage

SLUG=$1
TITLE_EN=$2
shift 2

DATE=$(TZ=Asia/Seoul date +%Y-%m-%d)
DESC_EN=""
DESC_KO=""
TAGS=""
FROM=""
BOTH=true
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --date) DATE=$2; shift 2 ;;
    --desc) DESC_EN=$2; shift 2 ;;
    --desc-ko) DESC_KO=$2; shift 2 ;;
    --tags) TAGS=$2; shift 2 ;;
    --from) FROM=$2; shift 2 ;;
    --both) BOTH=true; shift ;;
    --en-only) BOTH=false; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) usage ;;
  esac
done

TAGS_YAML="[]"
if [[ -n $TAGS ]]; then
  TAGS_YAML="[\"$(echo "$TAGS" | sed 's/,/", "/g')\"]"
fi

EXPLORED_FROM=""
if [[ -n $FROM ]]; then
  EXPLORED_FROM="exploredFrom: ${FROM}"
fi

make_content() {
  local title=$1
  local refs_heading=$2
  local why=$3
  local felt=$4
  local learned=$5
  local memo=$6

  cat <<EOF
---
title: '${title}'
---

## ${refs_heading}

- [Title](https://example.com)

---

## ${why}

- **Trigger:**
- **Context:**
- **Questions:**

---

## ${felt}

---

## ${learned}

---

## ${memo}

EOF
}

make_meta() {
  local desc=$1

  local desc_line=""
  [[ -n $desc ]] && desc_line="description: '${desc}'"

  cat <<EOF
${desc_line}
pubDate: ${DATE}
tags: ${TAGS_YAML}
${EXPLORED_FROM}
exploreNext: []
EOF
}

CONTENT_EN=$(make_content "$TITLE_EN" "References" "Why I looked this up" "What stood out" "What I learned" "Memo")
META_EN=$(make_meta "$DESC_EN")
TITLE_KO="${DESC_KO:-$TITLE_EN}"
CONTENT_KO=$(make_content "$TITLE_KO" "레퍼런스" "왜 이 글을 찾아봤나" "읽으면서 느낀 점" "배운 것" "메모")
META_KO=$(make_meta "$DESC_KO")

if [[ $DRY_RUN == true ]]; then
  echo "=== en/${SLUG}/content.md ==="
  echo "$CONTENT_EN"
  echo "=== en/${SLUG}/meta.yaml ==="
  echo "$META_EN"
  if [[ $BOTH == true ]]; then
    echo "=== ko/${SLUG}/content.md ==="
    echo "$CONTENT_KO"
    echo "=== ko/${SLUG}/meta.yaml ==="
    echo "$META_KO"
  fi
  exit 0
fi

write_file() {
  local path=$1
  local content=$2
  if [[ -f $path ]]; then
    echo "Error: $path already exists" >&2
    exit 1
  fi
  echo "$content" > "$path"
  echo "Created $path"
}

write_note() {
  local locale=$1
  local content=$2
  local meta=$3
  local dir="src/content/notes/${locale}/${SLUG}"

  if [[ -d $dir ]]; then
    echo "Error: $dir already exists" >&2
    exit 1
  fi
  mkdir -p "$dir"
  write_file "${dir}/content.md" "$content"
  write_file "${dir}/meta.yaml" "$meta"
}

write_note en "$CONTENT_EN" "$META_EN"
[[ $BOTH == true ]] && write_note ko "$CONTENT_KO" "$META_KO"

echo "Preview EN: http://localhost:4321/research-notes/en/notes/${SLUG}/"
[[ $BOTH == true ]] && echo "Preview KO: http://localhost:4321/research-notes/ko/notes/${SLUG}/"

if [[ -n $FROM ]]; then
  echo "Next: update exploreNext.note in en/${FROM}/meta.yaml and ko/${FROM}/meta.yaml → ${SLUG}"
fi
