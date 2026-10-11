#!/usr/bin/env bash
# Claude Code statusline, lualine-style pills:
#   ( model effort fast ) branch ) +added/-removed  ...  cost ( tokens gauge ctx% ( 5h/7d % )
# Left group sits at the start, right group is padded out to $COLUMNS.
# (dir/time intentionally omitted — already in tmux bar and zsh prompt)
#
# Progressive disclosure: segments that carry no signal stay hidden.
#   - 7d shows only once at/over HOT
#   - the diff appears only once lines have actually changed
#
# NOTE: percentages arrive as floats (e.g. 14.000000000000002) — always `round` in jq,
# never regex-match the raw value or the segment silently disappears.
# NOTE: inside a pill never reset with \033[0m, it drops the pill background.
# Use $TEXT (fg) and \033[22m (bold/dim) instead.

shopt -s extglob

HOT=85           # 7d window shows from here
BAR_CAP=300000   # context bar full at this many tokens
CTX_WARN=150000  # context yellow from here
CTX_HOT=300000   # context red from here
MARGIN=4       # columns kept free at the right edge for Claude Code's own spacing

input=$(cat)
model=$(jq -r '.model.display_name // "?"' <<<"$input")
cost=$(jq -r '.cost.total_cost_usd // 0 | . * 100 | round / 100' <<<"$input")
added=$(jq -r '.cost.total_lines_added // 0 | round' <<<"$input")
removed=$(jq -r '.cost.total_lines_removed // 0 | round' <<<"$input")
ctx_pct=$(jq -r '.context_window.used_percentage // empty | round' <<<"$input")
ctx_size=$(jq -r '.context_window.context_window_size // empty' <<<"$input")
ctx_used=$(jq -r '.context_window.total_input_tokens // empty | round' <<<"$input")
lim5=$(jq -r '.rate_limits.five_hour.used_percentage // empty | round' <<<"$input")
lim7=$(jq -r '.rate_limits.seven_day.used_percentage // empty | round' <<<"$input")
reset5=$(jq -r '.rate_limits.five_hour.resets_at // empty | round' <<<"$input")
reset7=$(jq -r '.rate_limits.seven_day.resets_at // empty | round' <<<"$input")
effort=$(jq -r '.effort.level // empty' <<<"$input")
fast=$(jq -r '.fast_mode // false' <<<"$input")
cwd=$(jq -r '.workspace.current_dir // .cwd // empty' <<<"$input")

# Catppuccin Mocha, matching nvim's lualine
BLUE='#89b4fa'
SURFACE0='#313244'
MANTLE='#181825'
GREEN='#a6e3a1'
YELLOW='#f9e2af'
RED='#f38ba8'

# hex -> truecolor fg / bg params, and a ready fg escape
fgc() { printf '38;2;%d;%d;%d' "0x${1:1:2}" "0x${1:3:2}" "0x${1:5:2}"; }
bgc() { printf '48;2;%d;%d;%d' "0x${1:1:2}" "0x${1:3:2}" "0x${1:5:2}"; }
fg()  { printf '\033[%sm' "$(fgc "$1")"; }

TEXT=$(fg "$BLUE")   # plain text inside surface pills

# context color by tokens in context
ctx_heat() {
    local t=$1
    if   (( t >= CTX_HOT ));  then printf '%s' "$RED"
    elif (( t >= CTX_WARN )); then printf '%s' "$YELLOW"
    else                           printf '%s' "$BLUE"
    fi
}

# bar <r|l> <color> <body> ...: segments chained by rounded caps, like lualine.
#   r: ( a ) b ) c )    l: ( a ( b ( c )
# blue gets mantle text, surface gets $TEXT. A joint gets one space on the inner pill's side.
bar() {
    local dir=$1 out="" prev="" c body text pad
    shift
    while (( $# )); do
        c=$1 body=$2
        shift 2
        [[ -z "$body" ]] && continue
        pad=""
        [[ -n "$prev" && $dir == r ]] && pad=" "
        [[ -n "$prev" && $dir == l ]] && out+=" "
        if [[ -z "$prev" ]]; then
            out+=$(printf '\033[%sm' "$(fgc "$c")")
        elif [[ $dir == r ]]; then
            out+=$(printf '\033[%s;%sm' "$(fgc "$prev")" "$(bgc "$c")")
        else
            out+=$(printf '\033[%s;%sm' "$(fgc "$c")" "$(bgc "$prev")")
        fi
        text=$TEXT
        [[ $c == "$BLUE" ]] && text=$(fg "$MANTLE")
        out+=$(printf '\033[%sm%s%s' "$(bgc "$c")" "$text" "$pad$body")
        prev=$c
    done
    [[ -n "$prev" ]] && out+=$(printf '\033[0;%sm' "$(fgc "$prev")")
    printf '%s\033[0m' "$out"
}

# gauge <pct> <cells> -> filled cells, dim empty cells, in the current fg
gauge() {
    local pct=$1 cells=$2 i filled
    filled=$(( (pct * cells + 99) / 100 ))       # round up, so 1% still shows a tick
    (( filled > cells )) && filled=$cells
    for (( i = 0; i < filled; i++ )); do printf '▰'; done
    printf '\033[2m'
    for (( i = filled; i < cells; i++ )); do printf '▱'; done
    printf '\033[22m'
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

# one rate-limit window: "5h 88% ↻1h12m"
limit() {
    local label=$1 pct=$2 at=$3 left=""
    if [[ -n "$at" ]]; then
        left=$(countdown "$at")
        [[ -n "$left" ]] && left=" ↻$left"
    fi
    printf '%s \033[1m%s%%\033[22m%s' "$label" "$pct" "$left"
}

# " main* ": detached HEAD shows the short sha, "*" when dirty
git_seg() {
    local dir=$1 branch out
    [[ -z "$dir" ]] && return
    branch=$(git -C "$dir" symbolic-ref --quiet --short HEAD 2>/dev/null) \
        || branch=$(git -C "$dir" rev-parse --short HEAD 2>/dev/null) \
        || return
    out=$(printf '\uf418 %s' "$branch")
    [[ -n "$(git -C "$dir" status --porcelain 2>/dev/null)" ]] \
        && out+='*'
    printf '%s' "$out"
}

# visible columns: strip SGR escapes; ⚡ is double-width
width() {
    local s=${1//$'\033'\[*([0-9;])m/}
    local w=${#s}
    [[ $s == *⚡* ]] && (( w++ ))
    printf '%s' "$w"
}

# model + effort + fast mode
seg_model=$(printf '\033[1m%s\033[22m' "$model")
[[ -n "$effort" ]] && seg_model+=" $effort"
[[ "$fast" == "true" ]] && seg_model+=" ⚡fast"

seg_git=$(git_seg "$cwd")

# diff: only once something actually changed
seg_diff=""
if (( added || removed )); then
    seg_diff=" $(fg "$GREEN")+$added"$'\033[39m'"/$(fg "$RED")-$removed"$'\033[0m'
fi

seg_cost="$(fg "$GREEN")\$$cost"$'\033[0m'" "

# rate limits: 5h, plus 7d once it is hot
seg_lim=""
[[ -n "$lim5" ]] && seg_lim=$(limit 5h "$lim5" "$reset5")
if [[ -n "$lim7" ]] && (( lim7 >= HOT )); then
    seg_lim+="${seg_lim:+ · }$(limit 7d "$lim7" "$reset7")"
fi

# context: "58k ▰▱▱▱▱▱▱▱ 6%"
seg_ctx=""
if [[ -n "$ctx_pct" ]]; then
    tokens=""
    [[ -n "$ctx_used" ]] && tokens="$(human "$ctx_used") "
    bar_pct=$ctx_pct
    [[ -n "$ctx_size" ]] && bar_pct=$(( ctx_pct * ctx_size / BAR_CAP ))
    ctx_tok=$(( ctx_pct * ${ctx_size:-0} / 100 ))
    c=$(ctx_heat "$ctx_tok")
    seg_ctx="$(fg "$c")$tokens$(gauge "$bar_pct" 8) $ctx_pct%$TEXT"
fi

left=$(bar r "$BLUE" "$seg_model" "$SURFACE0" "$seg_git")$seg_diff
right=$seg_cost$(bar l "$SURFACE0" "$seg_ctx" "$BLUE" "$seg_lim")

# pad the gap so the right group ends MARGIN columns before the edge
gap=1
if [[ -n "$COLUMNS" ]]; then
    gap=$(( COLUMNS - MARGIN - $(width "$left") - $(width "$right") ))
    (( gap < 1 )) && gap=1
fi
printf '%s%*s%s' "$left" "$gap" '' "$right"
