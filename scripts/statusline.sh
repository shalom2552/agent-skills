#!/usr/bin/env bash
# Claude Code statusline:
#   model effort fast │ tokens gauge ctx% │ cost │ +added/-removed │ branch │ 5h/7d %
# (dir/time intentionally omitted — already in tmux bar and zsh prompt)
#
# Progressive disclosure: segments that carry no signal stay hidden.
#   - rate limits appear only once either window crosses LIMIT_FLOOR
#   - a limit at/over HOT adds its reset countdown
#   - the diff appears only once lines have actually changed
#
# NOTE: percentages arrive as floats (e.g. 14.000000000000002) — always `round` in jq,
# never regex-match the raw value or the segment silently disappears.

LIMIT_FLOOR=30   # below this, rate limits are noise
HOT=85           # at/above this, show when the window resets

input=$(cat)
model=$(jq -r '.model.display_name // "?"' <<<"$input")
cost=$(jq -r '.cost.total_cost_usd // 0 | . * 100 | round / 100' <<<"$input")
added=$(jq -r '.cost.total_lines_added // 0 | round' <<<"$input")
removed=$(jq -r '.cost.total_lines_removed // 0 | round' <<<"$input")
ctx_pct=$(jq -r '.context_window.used_percentage // empty | round' <<<"$input")
ctx_used=$(jq -r '.context_window.total_input_tokens // empty | round' <<<"$input")
lim5=$(jq -r '.rate_limits.five_hour.used_percentage // empty | round' <<<"$input")
lim7=$(jq -r '.rate_limits.seven_day.used_percentage // empty | round' <<<"$input")
reset5=$(jq -r '.rate_limits.five_hour.resets_at // empty | round' <<<"$input")
reset7=$(jq -r '.rate_limits.seven_day.resets_at // empty | round' <<<"$input")
effort=$(jq -r '.effort.level // empty' <<<"$input")
fast=$(jq -r '.fast_mode // false' <<<"$input")
cwd=$(jq -r '.workspace.current_dir // .cwd // empty' <<<"$input")

# green under 60%, yellow to 85%, red above
heat() {
    local p=$1
    if   (( p >= 85 )); then printf '\033[31m'
    elif (( p >= 60 )); then printf '\033[33m'
    else                     printf '\033[32m'
    fi
}

# gauge <pct> <cells> -> heat-colored filled cells, dim empty cells
gauge() {
    local pct=$1 cells=$2 i filled
    filled=$(( (pct * cells + 99) / 100 ))       # round up, so 1% still shows a tick
    (( filled > cells )) && filled=$cells
    printf '%b' "$(heat "$pct")"
    for (( i = 0; i < filled; i++ )); do printf '▰'; done
    printf '\033[0m\033[2m'
    for (( i = filled; i < cells; i++ )); do printf '▱'; done
    printf '\033[0m'
}

# 36068 -> 36k, 1000000 -> 1M
human() {
    local n=$1
    if   (( n >= 1000000 )); then printf '%sM' "$(( n / 1000000 ))"
    elif (( n >= 1000 ));    then printf '%sk' "$(( n / 1000 ))"
    else                          printf '%s'  "$n"
    fi
}

# epoch -> "1h12m" / "45m" until then; empty if already past
countdown() {
    local secs=$(( $1 - $(date +%s) )) mins
    (( secs <= 0 )) && return
    mins=$(( secs / 60 ))
    if (( mins >= 60 )); then printf '%sh%sm' "$(( mins / 60 ))" "$(( mins % 60 ))"
    else                      printf '%sm' "$mins"
    fi
}

# one rate-limit window: "5h 88% ↻1h12m" (countdown only once hot)
limit() {
    local label=$1 pct=$2 at=$3 left=""
    if (( pct >= HOT )) && [[ -n "$at" ]]; then
        left=$(countdown "$at")
        [[ -n "$left" ]] && left=$(printf ' \033[2m↻%s\033[0m' "$left")
    fi
    printf '\033[2m%s\033[0m %b%s%%\033[0m%s' "$label" "$(heat "$pct")" "$pct" "$left"
}

# "main" — detached HEAD shows the short sha, "*" when dirty
git_seg() {
    local dir=$1 branch out
    [[ -z "$dir" ]] && return
    branch=$(git -C "$dir" symbolic-ref --quiet --short HEAD 2>/dev/null) \
        || branch=$(git -C "$dir" rev-parse --short HEAD 2>/dev/null) \
        || return
    out=$(printf '\033[36m%s\033[0m' "$branch")
    [[ -n "$(git -C "$dir" status --porcelain 2>/dev/null)" ]] \
        && out+=$(printf '\033[33m*\033[0m')
    printf '%s' "$out"
}

# each segment is fully rendered here, then joined below
segments=()

# model + effort + fast mode: one group, they describe the same thing
head=$(printf '\033[1;35m%s\033[0m' "$model")
[[ -n "$effort" ]] && head+=$(printf ' \033[36m%s\033[0m' "$effort")
[[ "$fast" == "true" ]] && head+=$(printf ' \033[1;33m⚡fast\033[0m')
segments+=( "$head" )

# context: "58k ▰▱▱▱▱▱▱▱ 6%" — tokens left of the bar
if [[ -n "$ctx_pct" ]]; then
    tokens=""
    [[ -n "$ctx_used" ]] && tokens=$(printf '\033[2m%s\033[0m ' "$(human "$ctx_used")")
    segments+=( "$(printf '%s%s %b%s%%\033[0m' "$tokens" "$(gauge "$ctx_pct" 8)" "$(heat "$ctx_pct")" "$ctx_pct")" )
fi

segments+=( "$(printf '\033[33m$%s\033[0m' "$cost")" )

# diff: only once something actually changed
if (( added || removed )); then
    segments+=( "$(printf '\033[32m+%s\033[0m\033[2m/\033[0m\033[31m-%s\033[0m' "$added" "$removed")" )
fi

segments+=( "$(git_seg "$cwd")" )

# rate limits: hidden while both windows are comfortably low
if [[ -n "$lim5" && -n "$lim7" ]] && (( lim5 >= LIMIT_FLOOR || lim7 >= LIMIT_FLOOR )); then
    segments+=( "$(printf '%s \033[2m·\033[0m %s' \
        "$(limit 5h "$lim5" "$reset5")" "$(limit 7d "$lim7" "$reset7")")" )
fi

# join non-empty segments with a dim bar
out=""
for seg in "${segments[@]}"; do
    [[ -z "$seg" ]] && continue
    [[ -n "$out" ]] && out+=$' \033[2m│\033[0m '
    out+="$seg"
done
printf '%s' "$out"
