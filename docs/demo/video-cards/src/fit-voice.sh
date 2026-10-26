#!/bin/zsh
# Voice-over for the Cirujano demo: ElevenLabs Eric on eleven_multilingual_v2, one file per clip.
# Usage: zsh docs/demo/video-cards/src/fit-voice.sh [beat[=seconds] ...]   (no arguments = every beat)
# 1. Writes beat-N.txt from the Say blocks of docs/demo/recording-script.md (the only text source).
# 2. Reads each clip length from split-N.mp4 (beat 0 without a clip is the 10-second intro card).
#    `1=17` fits beat 1 to a 17-second clip instead, for a clip already trimmed in iMovie.
# 3. Generates at speed 1.0; if speech is longer than the clip, regenerates once at the speed that
#    fits (max 1.2). Never cuts words. Pads silence to the clip length minus 0.1 s.
setopt +o nomatch
repo=${0:A:h:h:h:h:h}
script=$repo/docs/demo/recording-script.md
demo="$HOME/Desktop/Cirujano Demo"
mkdir -p "$demo/voice"; cd "$demo/voice" || exit 1
awk '/^## /{on=($0 ~ /^## Script/)} on && /^### [0-9]+\./{b=$2; sub(/\./,"",b); printf "" > ("beat-" b ".txt")} on && /^> /{sub(/^> /,""); printf "%s ", $0 >> ("beat-" b ".txt")}' "$script"
VOICE=cjVigY5qzO86Huf0OWal
dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
gen() { # $1 beat, $2 speed, $3 out
  local body
  body=$(python3 -I -c 'import json,sys; print(json.dumps({"text": open(f"beat-{sys.argv[1]}.txt").read().strip(), "model_id": "eleven_multilingual_v2", "language_code": "en", "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.15, "use_speaker_boost": True, "speed": float(sys.argv[2])}}))' "$1" "$2")
  elevenlabs text-to-speech convert --voice-id $VOICE --output-format mp3_44100_128 --json "$body" -o "$3" -q 2>err-$1.txt
}
beats=(${@:-$(ls beat-*.txt | sed 's/beat-\(.*\)\.txt/\1/' | sort -n)})
for spec in $beats; do
  b=${spec%%=*}; given=${spec#*=}; [[ $given == $spec ]] && given=""
  if [[ -n $given ]]; then target=$(python3 -I -c "print(round($given - 0.1, 2))")
  elif [[ -f "$demo/split-$b.mp4" ]]; then target=$(python3 -I -c "print(round($(dur "$demo/split-$b.mp4") - 0.1, 2))")
  elif [[ $b == 0 ]]; then target=0   # intro card: no clip yet, the card is cut to the audio length
  else echo "beat $b: no split-$b.mp4 yet, skipped"; continue; fi
  if ! gen $b 1.0 raw-$b.mp3; then echo "beat $b FAILED: $(head -c 200 err-$b.txt)"; continue; fi
  v=$(dur raw-$b.mp3); speed=1.0
  [[ $target == 0 ]] && target=$(python3 -I -c "print(round($v + 0.8, 2))")
  if python3 -I -c "import sys; sys.exit(0 if $v > $target else 1)"; then
    speed=$(python3 -I -c "print(min(1.2, round($v/($target-0.25), 3)))")
    if gen $b $speed raw-$b.v2.mp3; then mv -f raw-$b.v2.mp3 raw-$b.mp3; v=$(dur raw-$b.mp3); else echo "beat $b speed retake FAILED, keeping 1.0"; speed=1.0; fi
  fi
  read lead tempo <<<"$(python3 -I -c "
v=$v; L=$target; s=L-v
if s>=0.3: print(min(1.0, round(s/2,2)), 1.0)
elif s>=0: print(0, 1.0)
else: print(0, round(v/(L-0.1),4))")"
  ms=$(python3 -I -c "print(int($lead*1000))")
  ffmpeg -v error -y -i raw-$b.mp3 -af "atempo=${tempo},adelay=${ms}|${ms},apad=whole_dur=${target}" -c:a libmp3lame -b:a 192k voice-$b.mp3 || { echo "beat $b fit FAILED, raw-$b.mp3 kept"; continue; }
  ffmpeg -v error -i voice-$b.mp3 -f null - 2>&1 | grep -q . && { echo "beat $b decode errors, raw-$b.mp3 kept"; continue; }
  printf "beat %s  speech %5.1f s | clip %5.2f | file %5.2f | speed %s | lead-in %ss | tempo %s\n" $b "$v" "$target" "$(dur voice-$b.mp3)" "$speed" "$lead" "$tempo"
  rm -f raw-$b.mp3 err-$b.txt
done
