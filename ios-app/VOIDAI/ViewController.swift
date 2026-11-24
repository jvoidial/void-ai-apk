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
        config.userContentController.add(self, name: "voidai")
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

    private func bridgeSource() -> String {
        """
        window.VoidAI = {
          platform: 'ios',
          getCurrentUser: function() { return \(jsString(AuthManager.shared.email)); },
          getUserName: function() { return \(jsString(AuthManager.shared.name)); },
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
                    let message = self.jsString("sign-in cancelled or failed")
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
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        sendSignedInState()
    }
}

extension ViewController: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        view.window ?? UIWindow(frame: .zero)
    }
}
