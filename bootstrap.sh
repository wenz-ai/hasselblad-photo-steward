#!/bin/sh
# Bootstrap with utilities supplied by macOS. Keep tools and photos outside the checkout.
set -eu
umask 077
export UV_NATIVE_TLS=true
base="${XDG_DATA_HOME:-$HOME/Library/Application Support}/PhotoSteward"
export UV_PYTHON_INSTALL_DIR="$base/runtime/python"
export UV_CACHE_DIR="$base/runtime/cache"
export UV_NO_CONFIG=1
if [ "$(uname -s)" != Darwin ]; then echo '本版需要 macOS。' >&2; exit 1; fi
case "$(uname -m)" in
 arm64)
  wheel='https://files.pythonhosted.org/packages/d7/ca/bf37d86af6e16e45fa2b1a03300784ff3297aa9252a23dfbeaf6e391e72e/uv-0.8.22-py3-none-macosx_11_0_arm64.whl'
  sha=6706b782ad75662df794e186d16b9ffa4946d57c88f21d0eadfd43425794d1b0 ;;
 x86_64)
  wheel='https://files.pythonhosted.org/packages/28/e9/813f7eb9fb9694c4024362782c8933e37887b5195e189f80dc40f2da5958/uv-0.8.22-py3-none-macosx_10_12_x86_64.whl'
  sha=89944e99b04cc8542cb5931306f1c593f00c9d6f2b652fffc4d84d12b915f911 ;;
 *) echo '当前处理器尚未支持。' >&2; exit 1 ;;
esac
cd "$(dirname "$0")"
uv="$base/runtime/uv-0.8.22"
if [ ! -x "$uv" ]; then
 mkdir -p "$base/runtime"
 scratch=$(mktemp -d "$base/runtime/setup.XXXXXXXX")
 trap 'rm -rf "$scratch"' EXIT
 /usr/bin/curl -fLsS --retry 3 "$wheel" -o "$scratch/uv.whl"
 printf '%s  %s\n' "$sha" "$scratch/uv.whl" | /usr/bin/shasum -a 256 -c - >/dev/null
 /usr/bin/unzip -p "$scratch/uv.whl" '*/scripts/uv' > "$scratch/uv"
 chmod 755 "$scratch/uv"
 mv "$scratch/uv" "$uv"
fi
export UV_PROJECT_ENVIRONMENT="$base/runtime/env-v1"
"$uv" sync --no-build --frozen --no-dev --no-install-project --python 3.13 --managed-python
exec "$UV_PROJECT_ENVIRONMENT/bin/python" start.py "$@"
