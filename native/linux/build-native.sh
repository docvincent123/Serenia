#!/usr/bin/env bash
set -Eeuo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
build_dir=${SOLVIA_NATIVE_BUILD_DIR:-"$root/build/native-linux"}
cmake -S "$root/native/linux" -B "$build_dir" -DCMAKE_BUILD_TYPE=Release
cmake --build "$build_dir" --parallel "${SOLVIA_BUILD_JOBS:-2}"
echo "Native SOLVIA: $build_dir/solvia-native"
