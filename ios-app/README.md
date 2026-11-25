# VOIDAI iOS (unsigned IPA clone)

This is a WKWebView wrapper around the same chat UI used by the Android APK.
The HTML is not duplicated: the build copies
`android-app/app/src/main/assets/index.html` into the app bundle.

## Build

Requirements: macOS, Xcode, and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
brew install xcodegen
cd ios-app
./build-unsigned-ipa.sh
```

Output: `ios-app/build/VOIDAI-unsigned.ipa`

The GitHub Actions workflow `.github/workflows/ios-unsigned.yml` runs the same
script on a macOS runner and uploads the IPA as an artifact, so a Mac is not
required to produce the build.

## What is included

- WKWebView with the shared VOIDAI chat UI, JavaScript enabled, and local asset
  access for `index.html`.
- Native image attachment through `PHPickerViewController`, plus a still-photo
  `UIImagePickerController` camera path, wired to the WebView file input. The
  camera is never used for live video on iOS. The web layer still downscales
  before sending to `/vision`.
- GitHub sign-in through Supabase OAuth using `ASWebAuthenticationSession` and
  the `voidai://auth-callback` redirect scheme.
- Native bridge exposed as `window.VoidAI`, alongside the existing
  `window.Android` bridge.

## Signing

The IPA is intentionally unsigned. Stock iOS will not install it until it is
signed with a development, ad-hoc, or enterprise certificate (for example with
AltStore, Sideloadly, or Xcode). Signing is deliberately left out of this repo.

## Auth notes

The Supabase project must allow `voidai://auth-callback` as a redirect URL, the
same requirement as the Android app. The iOS flow uses Supabase's implicit
callback and stores the display identity (email/name) plus tokens in
`UserDefaults`. It does not change the Worker's `X-VOID-KEY` auth, Supabase
tables, or Cloudflare configuration.

## Camera and voice

The shared `index.html` includes the Astra layer, but iOS deliberately blocks
live `getUserMedia` video. The camera opens only for a still photo: the `PHOTO`
control and `SNAP PHOTO` action show **Take Photo** and **Choose Photo**. The
`CAMERA / VISION` live action is hidden on iOS.

`VOICE` and `LISTEN` start a two-way voice conversation when the iOS runtime
exposes `SpeechRecognition`: the user speaks, the message is sent, the assistant
reply is spoken, and listening resumes. The toolbar and capabilities panel list
the system voices, and the chosen voice plus speed persist locally. Microphone
and speech-recognition usage strings live in `Info.plist`. If the runtime does
not expose those web APIs, the photo picker and typed chat still work.

## Files

- `VOIDAI/AppDelegate.swift` — app entry point.
- `VOIDAI/ViewController.swift` — WKWebView, file picker, JS bridge.
- `VOIDAI/AuthManager.swift` — Supabase GitHub OAuth.
- `VOIDAI/Info.plist` — URL scheme, camera/microphone/photo permissions, launch screen.
- `project.yml` — XcodeGen project definition.
- `build-unsigned-ipa.sh` — build and package script.
