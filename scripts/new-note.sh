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
  local locale=$1
  local title=$2
  local desc=$3
  local source_label=$4
  local why=$5
  local felt=$6
  local learned=$7
  local memo=$8

  local desc_line=""
  [[ -n $desc ]] && desc_line="description: '${desc}'"

  cat <<EOF
---
title: '${title}'
${desc_line}
pubDate: ${DATE}
tags: ${TAGS_YAML}
${EXPLORED_FROM}
exploreNext: []
---

> ${source_label}

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

CONTENT_EN=$(make_content en "$TITLE_EN" "$DESC_EN" "Source:" "Why I looked this up" "What stood out" "What I learned" "Memo")
TITLE_KO="${DESC_KO:-$TITLE_EN}"
CONTENT_KO=$(make_content ko "$TITLE_KO" "$DESC_KO" "원문:" "왜 이 글을 찾아봤나" "읽으면서 느낀 점" "배운 것" "메모")

if [[ $DRY_RUN == true ]]; then
  echo "=== en/${SLUG}.md ==="
  echo "$CONTENT_EN"
  [[ $BOTH == true ]] && echo "=== ko/${SLUG}.md ===" && echo "$CONTENT_KO"
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

write_file "src/content/notes/en/${SLUG}.md" "$CONTENT_EN"
[[ $BOTH == true ]] && write_file "src/content/notes/ko/${SLUG}.md" "$CONTENT_KO"

echo "Preview EN: http://localhost:4321/research-notes/en/notes/${SLUG}/"
[[ $BOTH == true ]] && echo "Preview KO: http://localhost:4321/research-notes/ko/notes/${SLUG}/"

if [[ -n $FROM ]]; then
  echo "Next: update exploreNext.note in en/${FROM}.md and ko/${FROM}.md → ${SLUG}"
fi
