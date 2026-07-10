#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/new-next-research.sh <id> [options]

Options:
  --label-en "text"     English label (required)
  --label-ko "text"     Korean label (required)
  --reason-en "text"    English reason (optional)
  --reason-ko "text"    Korean reason (optional)
  --note <slug>         Linked note slug when already written (optional)
  --dry-run             print template only

Example:
  scripts/new-next-research.sh jdbc-failover-minimal-downtime \
    --label-en "JDBC failover detection and minimal downtime" \
    --label-ko "JDBC failover 감지와 최소 다운타임" \
    --reason-en "How the driver notices endpoint changes…" \
    --reason-ko "switchover 후 endpoint/DNS 변경을…"
EOF
  exit 1
}

[[ $# -lt 1 ]] && usage

ID=$1
shift

LABEL_EN=""
LABEL_KO=""
REASON_EN=""
REASON_KO=""
NOTE=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --label-en) LABEL_EN=$2; shift 2 ;;
    --label-ko) LABEL_KO=$2; shift 2 ;;
    --reason-en) REASON_EN=$2; shift 2 ;;
    --reason-ko) REASON_KO=$2; shift 2 ;;
    --note) NOTE=$2; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) usage ;;
  esac
done

[[ -z $LABEL_EN || -z $LABEL_KO ]] && usage

yaml_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"
}

REASON_BLOCK=""
if [[ -n $REASON_EN || -n $REASON_KO ]]; then
  REASON_BLOCK=$(
    cat <<EOF
reason:
  en: $(yaml_quote "$REASON_EN")
  ko: $(yaml_quote "$REASON_KO")
EOF
  )
fi

NOTE_LINE=""
[[ -n $NOTE ]] && NOTE_LINE="note: ${NOTE}"

CONTENT=$(
  cat <<EOF
label:
  en: $(yaml_quote "$LABEL_EN")
  ko: $(yaml_quote "$LABEL_KO")
${REASON_BLOCK}
${NOTE_LINE}
EOF
)

TARGET="src/content/nextResearch/${ID}.yaml"

if [[ $DRY_RUN == true ]]; then
  echo "=== ${TARGET} ==="
  echo "$CONTENT"
  exit 0
fi

if [[ -f $TARGET ]]; then
  echo "Error: $TARGET already exists" >&2
  exit 1
fi

echo "$CONTENT" > "$TARGET"
echo "Created $TARGET"
echo "Next: add '${ID}' to exploreNext in the parent note meta.yaml files"
