#!/usr/bin/env bash

# WorkOS Logo Spinner - Color depth shading
# Usage: spin-logo.sh [--pulse]

MODE="spin"
if [[ "$1" == "--pulse" || "$1" == "-p" ]]; then
    MODE="pulse"
fi

cleanup() {
    printf "\e[?25h"
    printf "\e[0m"
    clear
    exit 0
}

trap cleanup INT TERM EXIT HUP
printf "\e[?25l"

if [[ "$MODE" == "pulse" ]]; then
    DELAY=0.08
    NUM_FRAMES=24
else
    DELAY=0.055
    NUM_FRAMES=32
fi
TERM_WIDTH=$(tput cols)
TERM_HEIGHT=$(tput lines)

generate_all_frames() {
    awk -v num_frames="$NUM_FRAMES" -v term_width="$TERM_WIDTH" -v mode="$MODE" '
    BEGIN {
        PI = 3.14159265359

        n = 0
        logo[++n] = "         *+++++++++++++++ *+++++++*         "
        logo[++n] = "        *++++++++++++++*++++++++++++        "
        logo[++n] = "       *+++++++++++++++*+++++++++++++       "
        logo[++n] = "      *++++++++++++++* ++++++++++++++*      "
        logo[++n] = "     *+++++++++++++*    +++++++++++++++     "
        logo[++n] = "    ++++++++++++++++     *+++++++++++++*    "
        logo[++n] = "   *+++++++++++++*        +++++++++++++++*  "
        logo[++n] = "  ++++++++++++++*          +++++++++++++++++"
        logo[++n] = " *+++++++++++++++            +++++++++++++++*"
        logo[++n] = " *++++++++++++++              +++++++++++++++"
        logo[++n] = " *+++++++++++++*              *++++++++++++++"
        logo[++n] = " *++++++++++++++*            *++++++++++++++*"
        logo[++n] = "  ++++++++++++++*          *+++++++++++++++++"
        logo[++n] = "   ++++++++++++++*        +++++++++++++++*   "
        logo[++n] = "    +++++++++++++++*     +++++++++++++++     "
        logo[++n] = "     *++++++++++++++    +++++++++++++++      "
        logo[++n] = "      *++++++++++++++* +++++++++++++++       "
        logo[++n] = "       ++++++++++++++ +++++++++++++++        "
        logo[++n] = "        *++++++++++**++++++++++++++*         "
        logo[++n] = "         *+++++++*+*+++++++++++++**          "
        num_lines = n
        logo_width = length(logo[1])

        for (f = 0; f < num_frames; f++) {
            angle = (f / num_frames) * 2 * PI
            cos_a = cos(angle)

            abs_cos = (cos_a < 0) ? -cos_a : cos_a

            # Color based on angle (256 color mode for purples)
            if (mode == "pulse") {
                # Pulse: smooth sine wave through colors
                brightness = (cos_a + 1) / 2  # 0 to 1
                if (brightness > 0.85) color = "38;5;225"      # light lavender
                else if (brightness > 0.7) color = "38;5;183"  # lavender
                else if (brightness > 0.5) color = "38;5;141"  # medium purple
                else if (brightness > 0.35) color = "38;5;135" # purple
                else if (brightness > 0.2) color = "38;5;93"   # deep purple
                else color = "38;5;54"                          # dark purple
            } else {
                # Spin: color based on facing angle
                if (abs_cos > 0.9) color = "38;5;225"
                else if (abs_cos > 0.7) color = "38;5;183"
                else if (abs_cos > 0.5) color = "38;5;141"
                else if (abs_cos > 0.3) color = "38;5;135"
                else if (abs_cos > 0.15) color = "38;5;93"
                else color = "38;5;54"
            }

            print "FRAME"
            print color

            for (row = 1; row <= num_lines; row++) {
                line = logo[row]
                len = length(line)
                center_x = len / 2

                if (mode == "pulse") {
                    # Pulse: no projection, just show logo as-is
                    result = line

                    pad = int((term_width - len) / 2)
                    if (pad < 0) pad = 0
                    right_pad = term_width - pad - len
                    if (right_pad < 0) right_pad = 0

                    printf "%*s%s%*s\n", pad, "", result, right_pad, ""
                } else {
                    # Spin: project characters
                    for (col = 1; col <= len; col++) out_char[col] = " "

                    for (col = 1; col <= len; col++) {
                        ch = substr(line, col, 1)
                        if (ch == " ") continue

                        x = col - center_x
                        new_x = x * cos_a
                        screen_x = int(center_x + new_x + 0.5)

                        if (screen_x >= 1 && screen_x <= len) {
                            out_char[screen_x] = ch
                        }
                    }

                    result = ""
                    for (col = 1; col <= len; col++) {
                        result = result out_char[col]
                    }

                    pad = int((term_width - len) / 2)
                    if (pad < 0) pad = 0
                    right_pad = term_width - pad - len
                    if (right_pad < 0) right_pad = 0

                    printf "%*s%s%*s\n", pad, "", result, right_pad, ""
                }
            }
        }
    }
    '
}

echo "Generating frames..."

declare -a FRAMES
declare -a COLORS
current=""
frame_idx=0
current_color=""

while IFS= read -r line; do
    if [[ "$line" == "FRAME" ]]; then
        if [[ -n "$current" ]]; then
            FRAMES[frame_idx]="$current"
            COLORS[frame_idx]="$current_color"
            ((frame_idx++)) || true
        fi
        current=""
        read -r current_color  # Next line is color
    else
        current+="$line"$'\n'
    fi
done < <(generate_all_frames)

[[ -n "$current" ]] && { FRAMES[frame_idx]="$current"; COLORS[frame_idx]="$current_color"; }

clear

LOGO_HEIGHT=20
V_OFFSET=$(( (TERM_HEIGHT - LOGO_HEIGHT) / 2 ))
[[ $V_OFFSET -lt 1 ]] && V_OFFSET=1

frame=0
total=${#FRAMES[@]}

while true; do
    printf "\e[${V_OFFSET};1H"
    printf "\e[%sm" "${COLORS[frame]}"
    printf '%s' "${FRAMES[frame]}"
    printf "\e[0m"
    frame=$(( (frame + 1) % total ))
    sleep "$DELAY"
done
