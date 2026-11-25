import AuthenticationServices
import AVFoundation
import PhotosUI
import UIKit
import WebKit

final class ViewController: UIViewController {
    private var webView: WKWebView!
    private var filePickerCompletion: (([URL]?) -> Void)?
    private let speechSynth = AVSpeechSynthesizer()
    private var speechToken = ""

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "voidai")
        speechSynth.delegate = self
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.userContentController.addUserScript(
            WKUserScript(
                source: bridgeSource(),
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        config.userContentController.addUserScript(
            WKUserScript(
                source: photoOnlySource(),
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            )
        )

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.uiDelegate = self
        webView.navigationDelegate = self
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidBecomeActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        view.addSubview(webView)

        guard let url = Bundle.main.url(forResource: "index", withExtension: "html") else {
            assertionFailure("index.html is missing from the app bundle")
            return
        }
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private func bridgeSource() -> String {
        """
        window.VoidAI = {
          platform: 'ios',
          getCurrentUser: function() { return \(jsString(AuthManager.shared.email)); },
          getUserName: function() { return \(jsString(AuthManager.shared.name)); },
          getUserId: function() { return \(jsString(AuthManager.shared.userId)); },
          signInWithGitHub: function() {
            window.webkit.messageHandlers.voidai.postMessage({action: 'signIn'});
          },
          signOut: function() {
            window.webkit.messageHandlers.voidai.postMessage({action: 'signOut'});
          },
          speak: function(text, rate, pitch, token) {
            window.webkit.messageHandlers.voidai.postMessage({
              action: 'speak',
              text: text,
              rate: rate,
              pitch: pitch,
              token: token
            });
            return true;
          },
          stopSpeak: function() {
            window.webkit.messageHandlers.voidai.postMessage({action: 'stopSpeak'});
          },
          isSpeaking: function() { return false; }
        };
        """
    }

    private func photoOnlySource() -> String {
        """
        (function () {
          if (!window.VoidAI || window.VoidAI.platform !== 'ios') return;
          try {
            var media = navigator.mediaDevices;
            if (media && typeof media.getUserMedia === 'function') {
              var original = media.getUserMedia.bind(media);
              media.getUserMedia = function (constraints) {
                if (constraints && constraints.video) {
                  return Promise.reject(new DOMException(
                    'Live camera is disabled on iOS. Choose a photo from the gallery.',
                    'NotAllowedError'
                  ));
                }
                return original(constraints);
              };
            }
          } catch (e) {}
          function usePhotoPicker(prompt) {
            if (typeof window.voidaiAttachImage !== 'function') return false;
            var text = prompt == null ? '' : String(prompt).trim();
            if (text && window.voidaiApp && window.voidaiApp.els && window.voidaiApp.els.input) {
              window.voidaiApp.els.input.value = text;
            }
            window.voidaiAttachImage(false);
            return true;
          }
          window.addEventListener('click', function (event) {
            var node = event.target;
            while (node && node !== document) {
              if (node.getAttribute) {
                var tool = node.getAttribute('data-va-tool');
                var action = node.getAttribute('data-va-action');
                if (tool === 'camera' || action === 'camera' || action === 'live') {
                  event.preventDefault();
                  event.stopPropagation();
                  usePhotoPicker();
                  return;
                }
              }
              node = node.parentNode;
            }
          }, true);
          var originalCapture = window.voidaiCaptureCamera;
          window.voidaiCaptureCamera = function () {
            if (usePhotoPicker()) return true;
            if (typeof originalCapture === 'function') return originalCapture.apply(this, arguments);
            return false;
          };
          var originalLive = window.voidaiOpenLive;
          window.voidaiOpenLive = function () {
            if (usePhotoPicker()) return true;
            if (typeof originalLive === 'function') return originalLive.apply(this, arguments);
            return false;
          };
          var originalLook = window.voidaiLook;
          window.voidaiLook = function (prompt) {
            if (usePhotoPicker(prompt)) return true;
            if (typeof originalLook === 'function') return originalLook.apply(this, arguments);
            return false;
          };
          function adjust() {
            var cam = document.querySelector('[data-va-tool="camera"]');
            if (cam && cam.textContent !== 'PHOTO') {
              cam.textContent = 'PHOTO';
              cam.title = 'Choose a photo from the gallery';
            }
            var live = document.querySelector('[data-va-action="live"]');
            if (live) live.style.display = 'none';
          }
          if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', adjust);
          else adjust();
          setTimeout(adjust, 500);
          setTimeout(adjust, 1500);
          try {
            new MutationObserver(adjust).observe(document.body, { childList: true, subtree: true });
          } catch (e) {}
        })();
        """
    }

    private func speakNative(text: String, rate: Double, pitch: Double, token: String) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else {
            notifySpeechDone(token: token)
            return
        }
        speechToken = token
        speechSynth.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: String(clean.prefix(4000)))
        utterance.voice = preferredSpeechVoice()
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * Float(max(0.5, min(2.0, rate)))
        utterance.pitchMultiplier = Float(max(0.5, min(2.0, pitch)))
        utterance.volume = 1.0
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .spokenAudio,
                                    options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
        } catch {
            // The system voice still speaks; this only makes sure it uses the speaker.
        }
        speechSynth.speak(utterance)
    }

    private func preferredSpeechVoice() -> AVSpeechSynthesisVoice? {
        let male = ["david", "mark", "daniel", "alex", "fred", "tom", "aaron", "adam", "guy",
                    "matthew", "joey", "brian", "russell", "rishi", "oliver", "arthur",
                    "george", "james", "ryan", "eric", "christopher"]
        let female = ["samantha", "victoria", "karen", "moira", "tessa", "fiona", "allison",
                      "ava", "susan", "zoe", "serena", "aria", "jenny", "zira", "alexa",
                      "kate", "nicky", "kathy", "veena", "joanna", "salli", "kimberly",
                      "ivy", "kendra", "emma", "amy", "olivia", "sophie", "michelle",
                      "natasha", "clara", "hazel", "sonia", "libby", "emily"]
        let young = ["aria", "jenny", "ava", "emma", "olivia", "samantha", "michelle", "zoe", "serena"]
        let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("en") }
        guard !voices.isEmpty else {
            return AVSpeechSynthesisVoice(language: "en-US")
        }
        let us = voices.filter { $0.language == "en-US" }
        let pool = us.isEmpty ? voices : us
        let candidates = pool.filter { voice in
            let name = voice.name.lowercased()
            return female.contains(where: { name.contains($0) }) &&
                !male.contains(where: { name.contains($0) })
        }
        if let youngVoice = candidates.first(where: { voice in
            let name = voice.name.lowercased()
            return young.contains(where: { name.contains($0) })
        }) {
            return youngVoice
        }
        return candidates.first ?? pool.first ?? AVSpeechSynthesisVoice(language: "en-US")
    }

    private func notifySpeechDone(token: String? = nil) {
        let finished = token ?? speechToken
        speechToken = ""
        guard !finished.isEmpty else { return }
        let quoted = jsString(finished)
        webView.evaluateJavaScript(
            "window.voidaiNativeSpeechDone && window.voidaiNativeSpeechDone(\(quoted));",
            completionHandler: nil
        )
    }

    private func jsString(_ value: String) -> String {
        guard
            let data = try? JSONSerialization.data(withJSONObject: [value]),
            let encoded = String(data: data, encoding: .utf8)
        else {
            return "\"\""
        }
        // JSONSerialization wraps the string in an array: ["value"].
        return String(encoded.dropFirst().dropLast())
    }

    @objc private func appDidBecomeActive() {
        // The web view can survive in the background while the app is suspended.
        // Replay the persisted auth state when the user returns from the home screen.
        sendSignedInState()
    }

    private func sendSignedInState() {
        guard AuthManager.shared.isSignedIn else { return }
        let email = jsString(AuthManager.shared.email)
        let name = jsString(AuthManager.shared.name)
        webView.evaluateJavaScript("window.onSignedIn && window.onSignedIn(\(email), \(name));", completionHandler: nil)
    }

    private func finishFilePicker(_ urls: [URL]?) {
        let completion = filePickerCompletion
        filePickerCompletion = nil
        completion?(urls)
    }

    private func presentPhotoPicker() {
        var config = PHPickerConfiguration(photoLibrary: .shared())
        config.selectionLimit = 1
        config.filter = .images
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        present(picker, animated: true)
    }

    private func writeTemporaryImage(_ image: UIImage) -> URL? {
        guard let data = image.jpegData(compressionQuality: 0.85) else { return nil }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("jpg")
        do {
            try data.write(to: url, options: .atomic)
            scheduleTemporaryFileCleanup(url)
            return url
        } catch {
            return nil
        }
    }

    private func scheduleTemporaryFileCleanup(_ url: URL) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 600) {
            try? FileManager.default.removeItem(at: url)
        }
    }
}

extension ViewController: AVSpeechSynthesizerDelegate {
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer,
                           didFinish utterance: AVSpeechUtterance) {
        notifySpeechDone()
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer,
                           didCancel utterance: AVSpeechUtterance) {
        notifySpeechDone()
    }
}

extension ViewController: WKScriptMessageHandler {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard
            let body = message.body as? [String: Any],
            let action = body["action"] as? String
        else {
            return
        }

        switch action {
        case "signIn":
            AuthManager.shared.signIn(presentationContextProvider: self) { [weak self] ok in
                guard let self = self else { return }
                if ok {
                    self.sendSignedInState()
                } else {
                    let detail = AuthManager.shared.lastError ?? "sign-in cancelled or failed"
                    let message = self.jsString(detail)
                    self.webView.evaluateJavaScript(
                        "window.onAuthError && window.onAuthError(\(message));",
                        completionHandler: nil
                    )
                }
            }
        case "signOut":
            AuthManager.shared.signOut()
            webView.evaluateJavaScript("window.onSignedOut && window.onSignedOut();", completionHandler: nil)
        case "speak":
            let text = body["text"] as? String ?? ""
            let rate = (body["rate"] as? NSNumber)?.doubleValue ?? 1.03
            let pitch = (body["pitch"] as? NSNumber)?.doubleValue ?? 1.12
            let token = body["token"] as? String ?? ""
            speakNative(text: text, rate: rate, pitch: pitch, token: token)
        case "stopSpeak":
            speechToken = ""
            speechSynth.stopSpeaking(at: .immediate)
        default:
            break
        }
    }
}

extension ViewController: WKUIDelegate {
    @available(iOS 15.0, *)
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        if type == .microphone {
            decisionHandler(.grant)
        } else {
            decisionHandler(.deny)
        }
    }

    @available(iOS 18.4, *)
    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        filePickerCompletion = completionHandler
        presentPhotoPicker()
    }
}

extension ViewController: PHPickerViewControllerDelegate {
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)

        guard
            let provider = results.first?.itemProvider,
            provider.canLoadObject(ofClass: UIImage.self)
        else {
            finishFilePicker(nil)
            return
        }

        provider.loadObject(ofClass: UIImage.self) { [weak self] object, _ in
            guard let self = self else { return }
            let url = (object as? UIImage).flatMap { self.writeTemporaryImage($0) }
            DispatchQueue.main.async {
                self.finishFilePicker(url.map { [$0] })
            }
        }
    }
}

extension ViewController: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if url.isFileURL {
            decisionHandler(.allow)
            return
        }
        if url.scheme == "about" {
            decisionHandler(.allow)
            return
        }
        if navigationAction.shouldPerformDownload {
            decisionHandler(.allow)
            return
        }
        let raw = url.absoluteString.lowercased()
        if url.scheme == "blob" { decisionHandler(.allow); return }
        if url.scheme == "data" &&
            ["data:image/png", "data:image/jpeg", "data:image/jpg",
             "data:image/gif", "data:image/webp"].contains(where: { raw.hasPrefix($0) }) {
            decisionHandler(.allow)
            return
        }
        if url.scheme == "data" || url.scheme == "blob" {
            decisionHandler(.cancel)
            return
        }
        // Open remote links in the system browser so an untrusted page never
        // receives the VoidAI JavaScript bridge.
        if url.scheme == "http" || url.scheme == "https" ||
            url.scheme == "mailto" || url.scheme == "tel" {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView.url?.isFileURL == true else { return }
        sendSignedInState()
    }
}

extension ViewController: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        view.window ?? UIWindow(frame: .zero)
    }
}
