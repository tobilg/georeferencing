#!/usr/bin/env bash
# Reproducible trimmed OpenCV build. Requires Emscripten 6.0.8, CMake, Python 3 and make.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
build="$root/artifacts/matching/build"
mkdir -p "$build"
source_archive="$build/opencv-4.12.0.tar.gz"
if [ ! -f "$source_archive" ]; then
  curl -fsSL https://codeload.github.com/opencv/opencv/tar.gz/refs/tags/4.12.0 -o "$source_archive"
fi
printf '%s  %s\n' 44c106d5bb47efec04e531fd93008b3fcd1d27138985c5baf4eafac0e1ec9e9d "$source_archive" | shasum -a 256 -c -
emcc --version | head -1 | rg '6\.0\.8'
tar -xzf "$source_archive" -C "$build"
python3 - "$build/opencv-4.12.0/modules/js/CMakeLists.txt" <<'PY'
import sys
from pathlib import Path
p=Path(sys.argv[1]);s=p.read_text().replace('-std=c++11','-std=c++17').replace('-s TOTAL_MEMORY=128MB -s WASM_MEM_MAX=1GB','-s INITIAL_MEMORY=32MB -s MAXIMUM_MEMORY=512MB').replace('-s DEMANGLE_SUPPORT=1','-s EXPORT_ES6=1 -s ENVIRONMENT=web,worker,node');p.write_text(s)
PY
export EM_CACHE="$root/artifacts/matching/em-cache"
export CCACHE_DIR="$root/artifacts/matching/ccache"
emscripten_dir="${EMSCRIPTEN:-$(em-config EMSCRIPTEN_ROOT | tr -d "'")}"
python3 "$build/opencv-4.12.0/platforms/js/build_js.py" "$build/wasm" \
 --emscripten_dir "$emscripten_dir" --disable_single_file --enable_exception \
 --config "$root/scripts/matching/opencv.config.py" \
 --cmake_option=-DCMAKE_CXX_STANDARD=17 --cmake_option=-DENABLE_CCACHE=OFF \
 --cmake_option=-DBUILD_LIST=core,imgproc,features2d,flann,calib3d,js \
 --cmake_option=-DBUILD_opencv_dnn=OFF --cmake_option=-DBUILD_opencv_objdetect=OFF \
 --cmake_option=-DBUILD_opencv_photo=OFF --cmake_option=-DBUILD_opencv_video=OFF \
 --build_flags='-s MAXIMUM_MEMORY=536870912 -s DYNAMIC_EXECUTION=0'
node "$root/scripts/matching/install-artifact.mjs"
