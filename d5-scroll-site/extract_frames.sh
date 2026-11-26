#!/usr/bin/env bash
# Tách video D5 thành chuỗi ảnh JPG cho web.
# Cách dùng: ./extract_frames.sh video_d5.mp4 [số_frame=120] [rộng=1920]
set -e
IN="$1"; N="${2:-120}"; W="${3:-1920}"
[ -f "$IN" ] || { echo "Không thấy file video: $IN"; exit 1; }
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
FPS=$(python3 -c "print($N/$DUR)")
mkdir -p frames && rm -f frames/*.jpg
ffmpeg -loglevel error -i "$IN" -vf "fps=$FPS,scale=$W:-2" -q:v 4 frames/%04d.jpg
echo "Đã tạo $(ls frames/*.jpg | wc -l) ảnh trong frames/. Nhớ sửa FRAME_COUNT trong index.html cho khớp."
