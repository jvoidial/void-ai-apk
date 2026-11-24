import AuthenticationServices
import Foundation

final class AuthManager: NSObject {
    static let shared = AuthManager()

    private let defaults = UserDefaults.standard
    private let supabaseURL = "https://wtyksmoqeehmbcqwedkc.supabase.co"
    private let anonKey = "sb_publishable_xlfATZ6QU2ATxhWrdkfKpQ_l3a0gF4P"
    private var session: ASWebAuthenticationSession?

    var email: String { defaults.string(forKey: "voidai.email") ?? "" }
    var name: String { defaults.string(forKey: "voidai.name") ?? "" }
    var isSignedIn: Bool { !email.isEmpty }

    func signIn(
        presentationContextProvider: ASWebAuthenticationPresentationContextProviding,
        completion: @escaping (Bool) -> Void
    ) {
        var components = URLComponents(string: "\(supabaseURL)/auth/v1/authorize")
        components?.queryItems = [
            URLQueryItem(name: "apikey", value: anonKey),
            URLQueryItem(name: "provider", value: "github"),
            URLQueryItem(name: "redirect_to", value: "voidai://auth-callback")
        ]
        guard let url = components?.url else {
            completion(false)
            return
        }

        let session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: "voidai"
        ) { [weak self] callbackURL, error in
            guard let callbackURL = callbackURL, error == nil else {
                completion(false)
                return
            }
            let imported = self?.importSession(from: callbackURL) ?? false
            self?.session = nil
            DispatchQueue.main.async { completion(imported) }
        }
        session.presentationContextProvider = presentationContextProvider
        session.prefersEphemeralWebBrowserSession = false
        self.session = session
        if !session.start() {
            self.session = nil
            completion(false)
        }
    }

    func signOut() {
        defaults.removeObject(forKey: "voidai.email")
        defaults.removeObject(forKey: "voidai.name")
        defaults.removeObject(forKey: "voidai.accessToken")
        defaults.removeObject(forKey: "voidai.refreshToken")
    }

    private func importSession(from url: URL) -> Bool {
        guard let fragment = url.fragment ?? url.query else { return false }
        var params: [String: String] = [:]
        for pair in fragment.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if parts.count == 2 {
                params[parts[0]] = parts[1].removingPercentEncoding ?? parts[1]
            }
        }
        guard let accessToken = params["access_token"] else { return false }
        let (email, name) = Self.decodeJWT(accessToken)
        guard !email.isEmpty else { return false }

        defaults.set(email, forKey: "voidai.email")
        defaults.set(name, forKey: "voidai.name")
        defaults.set(accessToken, forKey: "voidai.accessToken")
        if let refresh = params["refresh_token"] {
            defaults.set(refresh, forKey: "voidai.refreshToken")
        }
        return true
    }

    static func decodeJWT(_ token: String) -> (String, String) {
        let segments = token.split(separator: ".")
        guard segments.count > 1 else { return ("", "") }
        var payload = String(segments[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while payload.count % 4 != 0 {
            payload += "="
        }
        guard
            let data = Data(base64Encoded: payload),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return ("", "")
        }
        let email = (json["email"] as? String) ?? (json["sub"] as? String) ?? ""
        let metadata = json["user_metadata"] as? [String: Any]
        let name = (metadata?["user_name"] as? String) ?? (metadata?["name"] as? String) ?? ""
        return (email, name)
    }
}
