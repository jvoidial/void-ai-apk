#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "error: xcodegen is required (brew install xcodegen)" >&2
  exit 1
fi
if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "error: xcodebuild is required (run this on macOS with Xcode)" >&2
  exit 1
fi

rm -rf build VOIDAI.xcodeproj
xcodegen generate --spec project.yml

xcodebuild \
  -project VOIDAI.xcodeproj \
  -scheme VOIDAI \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath build \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGN_ENTITLEMENTS="" \
  build

APP="build/Build/Products/Release-iphoneos/VOIDAI.app"
if [ ! -d "$APP" ]; then
  echo "error: build produced no app at $APP" >&2
  exit 1
fi

rm -rf build/Payload
mkdir -p build/Payload
cp -R "$APP" build/Payload/
(
  cd build
  rm -f VOIDAI-unsigned.ipa
  zip -qry VOIDAI-unsigned.ipa Payload
)

echo "unsigned IPA: $(pwd)/build/VOIDAI-unsigned.ipa"
