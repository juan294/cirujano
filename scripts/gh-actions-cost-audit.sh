#!/usr/bin/env bash
# gh-actions-cost-audit.sh — rank GitHub Actions billable minutes per workflow.
#
# Usage: gh-actions-cost-audit.sh <owner> [days=30] [sample=6] [min_runs=10]
# Needs: gh (authenticated), jq, bc.
#
# Method: for every non-archived PRIVATE repo of <owner>, for every active
# workflow with >= min_runs runs in the window, sample the last <sample>
# completed runs and compute billable minutes the way GitHub bills them:
# per job, ceil((completed_at - started_at) / 60s). Public repos are skipped
# because their minutes are free. The /timing endpoint is NOT used: it returns
# total_ms 0 on current GitHub (verified 2026-09-08).
set -euo pipefail
owner="${1:?owner}"; days="${2:-30}"; sample="${3:-6}"; min_runs="${4:-10}"
since=$(date -u -v-"${days}"d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "-${days} days" +%Y-%m-%dT%H:%M:%SZ)
out=$(mktemp)
gh repo list "$owner" --limit 200 --json name,isArchived,visibility \
  --jq '.[] | select(.isArchived|not) | select(.visibility=="PRIVATE") | .name' |
while read -r repo; do
  gh api "repos/$owner/$repo/actions/workflows" --paginate \
    --jq '.workflows[] | select(.state=="active") | "\(.id)|\(.name)"' |
  while IFS='|' read -r wid wname; do
    cnt=$(gh api "repos/$owner/$repo/actions/workflows/$wid/runs?created=>=$since&per_page=1" --jq .total_count)
    [ "${cnt:-0}" -lt "$min_runs" ] && continue
    total=0; n=0
    for id in $(gh api "repos/$owner/$repo/actions/workflows/$wid/runs?status=completed&per_page=$sample" --jq '.workflow_runs[].id' | tr '\n' ' '); do
      m=$(gh api "repos/$owner/$repo/actions/runs/$id/jobs?per_page=100" --jq \
        '[.jobs[] | select(.started_at!=null and .completed_at!=null) | (((.completed_at|fromdateiso8601) - (.started_at|fromdateiso8601)) / 60 | ceil)] | add // 0' 2>/dev/null || echo 0)
      total=$((total + ${m:-0})); n=$((n+1))
    done
    [ "$n" -eq 0 ] && continue
    avg=$(echo "scale=1; $total / $n" | bc); est=$(echo "$avg * $cnt / 1" | bc)
    printf "%7d|%5d|%6s|%s|%s\n" "$est" "$cnt" "$avg" "$repo" "$wname" >> "$out"
  done
done
echo "est_min/${days}d | runs | min/run | repo | workflow"
sort -t'|' -k1 -rn "$out" | awk -F'|' '{printf "%7d | %4d | %6s | %-16s | %s\n", $1, $2, $3, $4, $5}'
tot=$(awk -F'|' '{s+=$1} END{print s+0}' "$out")
echo "TOTAL est billable minutes: $tot  (~\$$(echo "scale=0; $tot * 0.008 / 1" | bc) at \$0.008/min list, before included minutes)"
rm -f "$out"
