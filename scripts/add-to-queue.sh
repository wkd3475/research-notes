#!/usr/bin/env bash
set -euo pipefail

# Scaffold a bilingual reading-queue item.
# Usage: scripts/add-to-queue.sh <slug> [options]

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QUEUE_DIR="$ROOT/src/content/reading-queue"

slug=""
title=""
title_ko=""
url=""
reason=""
reason_ko=""
source=""
tags=""
saved_date=""

usage() {
  cat <<'EOF'
Usage: scripts/add-to-queue.sh <slug> [options]

Options:
  --title EN          Article title (required)
  --title-ko KO       Korean title (defaults to --title)
  --url URL           Article URL (required)
  --reason EN         Why you saved it — English (required)
  --reason-ko KO      Korean reason (defaults to --reason)
  --source NAME       Publisher, e.g. LangChain
  --tags "a,b,c"      Comma-separated tags
  --date YYYY-MM-DD   savedAt (default: today KST)
  --dry-run           Print YAML without writing
  -h, --help          Show this help

Example:
  scripts/add-to-queue.sh langchain-ai-agent-frameworks-2026 \
    --title "The best AI agent frameworks in 2026" \
    --url "https://www.langchain.com/resources/ai-agent-frameworks" \
    --reason "Recent LangChain write-up on agent frameworks" \
    --reason-ko "LangChain의 에이전트 프레임워크 비교 글" \
    --source LangChain --tags "ai-agents,langchain"
EOF
}

today_kst() {
  TZ=Asia/Seoul date +%Y-%m-%d
}

yaml_tags() {
  local raw="$1"
  if [[ -z "$raw" ]]; then
    echo "tags: []"
    return
  fi
  echo "tags:"
  IFS=',' read -ra parts <<< "$raw"
  for t in "${parts[@]}"; do
    t="$(echo "$t" | xargs)"
    [[ -n "$t" ]] && echo "  - $t"
  done
}

write_item() {
  local locale="$1"
  local item_title="$2"
  local item_reason="$3"
  local path="$QUEUE_DIR/$locale/${slug}.yaml"

  mkdir -p "$(dirname "$path")"

  local tags_yaml
  tags_yaml="$(yaml_tags "$tags")"

  local source_line=""
  [[ -n "$source" ]] && source_line="source: $source"

  cat > "$path" <<EOF
title: '$item_title'
url: $url
reason: >-
  $item_reason
savedAt: $saved_date
$tags_yaml
$source_line
EOF

  echo "  $path"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --title) title="$2"; shift 2 ;;
    --title-ko) title_ko="$2"; shift 2 ;;
    --url) url="$2"; shift 2 ;;
    --reason) reason="$2"; shift 2 ;;
    --reason-ko) reason_ko="$2"; shift 2 ;;
    --source) source="$2"; shift 2 ;;
    --tags) tags="$2"; shift 2 ;;
    --date) saved_date="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -*) echo "Unknown option: $1" >&2; usage; exit 1 ;;
    *)
      if [[ -z "$slug" ]]; then slug="$1"; shift
      else echo "Unexpected argument: $1" >&2; exit 1; fi
      ;;
  esac
done

[[ -n "$slug" ]] || { echo "Error: slug required" >&2; usage; exit 1; }
[[ -n "$title" ]] || { echo "Error: --title required" >&2; exit 1; }
[[ -n "$url" ]] || { echo "Error: --url required" >&2; exit 1; }
[[ -n "$reason" ]] || { echo "Error: --reason required" >&2; exit 1; }

title_ko="${title_ko:-$title}"
reason_ko="${reason_ko:-$reason}"
saved_date="${saved_date:-$(today_kst)}"

if [[ "${DRY_RUN:-0}" == 1 ]]; then
  echo "# Would create EN and KO queue items for slug: $slug"
  exit 0
fi

for loc in en ko; do
  if [[ -f "$QUEUE_DIR/$loc/${slug}.yaml" ]]; then
    echo "Error: $QUEUE_DIR/$loc/${slug}.yaml already exists" >&2
    exit 1
  fi
done

echo "Created reading-queue items:"
write_item en "$title" "$reason"
write_item ko "$title_ko" "$reason_ko"

echo ""
echo "Queue URLs:"
echo "  http://localhost:4321/research-notes/en/reading-queue/"
echo "  http://localhost:4321/research-notes/ko/reading-queue/"
