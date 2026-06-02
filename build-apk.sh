#!/data/data/com.termux/files/usr/bin/bash
set -e

cd ~/void-ai-apk/android-app

./gradlew assembleDebug

APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
DEST="/sdcard/Download/VOID-AI-Odysseus.apk"

if [ -f "$APK_PATH" ]; then
  cp "$APK_PATH" "$DEST"
  echo "APK built and copied to: $DEST"
else
  echo "APK build failed or APK not found."
  exit 1
fi
