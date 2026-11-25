import AuthenticationServices
import PhotosUI
import UIKit
import WebKit

final class ViewController: UIViewController {
    private var webView: WKWebView!
    private var filePickerCompletion: (([URL]?) -> Void)?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "voidai")
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.userContentController.addUserScript(
            WKUserScript(
                source: bridgeSource(),
                injectionTime: .atDocumentStart,
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
          }
        };
        """
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
        default:
            break
        }
    }
}

extension ViewController: WKUIDelegate {
    @available(iOS 18.4, *)
    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        filePickerCompletion = completionHandler
        var config = PHPickerConfiguration(photoLibrary: .shared())
        config.selectionLimit = 1
        config.filter = .images
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        present(picker, animated: true)
    }
}

extension ViewController: PHPickerViewControllerDelegate {
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)

        guard
            let provider = results.first?.itemProvider,
            provider.canLoadObject(ofClass: UIImage.self)
        else {
            filePickerCompletion?(nil)
            filePickerCompletion = nil
            return
        }

        provider.loadObject(ofClass: UIImage.self) { [weak self] object, _ in
            guard let self = self else { return }
            guard
                let image = object as? UIImage,
                let data = image.jpegData(compressionQuality: 0.85)
            else {
                DispatchQueue.main.async {
                    self.filePickerCompletion?(nil)
                    self.filePickerCompletion = nil
                }
                return
            }

            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension("jpg")
            do {
                try data.write(to: url, options: .atomic)
                DispatchQueue.main.async {
                    self.filePickerCompletion?([url])
                    self.filePickerCompletion = nil
                }
            } catch {
                DispatchQueue.main.async {
                    self.filePickerCompletion?(nil)
                    self.filePickerCompletion = nil
                }
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
