import AuthenticationServices
import CryptoKit
import Foundation
import Security

final class AuthManager: NSObject {
    static let shared = AuthManager()

    private let defaults = UserDefaults.standard
    private let supabaseURL = "https://wtyksmoqeehmbcqwedkc.supabase.co"
    private let anonKey = "sb_publishable_xlfATZ6QU2ATxhWrdkfKpQ_l3a0gF4P"
    private var session: ASWebAuthenticationSession?
    private var pendingVerifier: String?
    private var pendingState: String?

    var lastError: String?
    var email: String { defaults.string(forKey: "voidai.email") ?? "" }
    var name: String { defaults.string(forKey: "voidai.name") ?? "" }
    var userId: String { defaults.string(forKey: "voidai.userId") ?? "" }
    var isSignedIn: Bool { !email.isEmpty }

    var accessToken: String { token(for: "voidai.accessToken") }
    var refreshToken: String { token(for: "voidai.refreshToken") }

    func signIn(
        presentationContextProvider: ASWebAuthenticationPresentationContextProviding,
        completion: @escaping (Bool) -> Void
    ) {
        lastError = nil
        guard let verifier = Self.randomURLSafe(byteCount: 48) else {
            lastError = "could not create a secure sign-in request"
            completion(false)
            return
        }
        let state = Self.randomURLSafe(byteCount: 24) ?? UUID().uuidString
        pendingVerifier = verifier
        pendingState = state

        var components = URLComponents(string: "\(supabaseURL)/auth/v1/authorize")
        components?.queryItems = [
            URLQueryItem(name: "apikey", value: anonKey),
            URLQueryItem(name: "provider", value: "github"),
            URLQueryItem(name: "redirect_to", value: "voidai://auth-callback"),
            URLQueryItem(name: "flow_type", value: "pkce"),
            URLQueryItem(name: "code_challenge", value: Self.sha256Base64URL(verifier)),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state)
        ]
        guard let url = components?.url else {
            clearPending()
            lastError = "could not build the sign-in URL"
            completion(false)
            return
        }

        let session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: "voidai"
        ) { [weak self] callbackURL, error in
            guard let self = self else { return }
            guard let callbackURL = callbackURL, error == nil else {
                self.lastError = error?.localizedDescription ?? "sign-in was cancelled"
                self.clearPending()
                DispatchQueue.main.async { completion(false) }
                return
            }

            let params = Self.params(from: callbackURL)
            if let providerError = params["error_description"] ?? params["error"], !providerError.isEmpty {
                self.lastError = providerError
                self.clearPending()
                DispatchQueue.main.async { completion(false) }
                return
            }
            guard let expected = self.pendingState, !expected.isEmpty,
                  params["state"] == expected else {
                self.lastError = "sign-in state did not match"
                self.clearPending()
                DispatchQueue.main.async { completion(false) }
                return
            }
            guard let code = params["code"], let verifier = self.pendingVerifier else {
                self.lastError = "sign-in did not return a PKCE code"
                self.clearPending()
                DispatchQueue.main.async { completion(false) }
                return
            }
            self.exchange(code: code, verifier: verifier) { ok in
                self.clearPending()
                DispatchQueue.main.async { completion(ok) }
            }
        }
        session.presentationContextProvider = presentationContextProvider
        session.prefersEphemeralWebBrowserSession = false
        self.session = session
        if !session.start() {
            self.session = nil
            clearPending()
            lastError = "could not open the sign-in browser"
            completion(false)
        }
    }

    func signOut() {
        let token = accessToken
        defaults.removeObject(forKey: "voidai.email")
        defaults.removeObject(forKey: "voidai.name")
        defaults.removeObject(forKey: "voidai.userId")
        for key in ["voidai.accessToken", "voidai.refreshToken"] {
            Keychain.delete(key)
            defaults.removeObject(forKey: key)
        }
        lastError = nil
        defaults.synchronize()
        revoke(token)
    }

    private func clearPending() {
        pendingVerifier = nil
        pendingState = nil
        session = nil
    }

    private func exchange(code: String, verifier: String, completion: @escaping (Bool) -> Void) {
        exchangeAttempt(code: code, verifier: verifier, attempt: 0, completion: completion)
    }

    private func exchangeAttempt(code: String, verifier: String, attempt: Int,
                                 completion: @escaping (Bool) -> Void) {
        guard let url = URL(string: "\(supabaseURL)/auth/v1/token?grant_type=pkce") else {
            lastError = "could not build the token exchange URL"
            completion(false)
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "auth_code": code,
            "code_verifier": verifier
        ])

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0

            if (status == 429 || (500...599).contains(status)) && attempt < 1 {
                DispatchQueue.global().asyncAfter(deadline: .now() + 1.2) {
                    self.exchangeAttempt(code: code, verifier: verifier,
                                         attempt: attempt + 1, completion: completion)
                }
                return
            }

            guard error == nil,
                  let data = data,
                  (200..<300).contains(status),
                  let object = try? JSONSerialization.jsonObject(with: data),
                  let json = object as? [String: Any],
                  let access = json["access_token"] as? String
            else {
                self.lastError = Self.authError(status: status, data: data, error: error)
                completion(false)
                return
            }
            let user = json["user"] as? [String: Any]
            let fallbackEmail = user?["email"] as? String
            completion(self.persist(accessToken: access,
                                    refreshToken: json["refresh_token"] as? String,
                                    fallbackEmail: fallbackEmail))
        }.resume()
    }

    private static func authError(status: Int, data: Data?, error: Error?) -> String {
        if let error = error { return error.localizedDescription }
        if let data = data,
           let object = try? JSONSerialization.jsonObject(with: data),
           let json = object as? [String: Any] {
            if let detail = (json["error_description"] as? String) ?? (json["msg"] as? String) ??
                (json["message"] as? String), !detail.isEmpty {
                return status > 0 ? "HTTP \(status): \(detail)" : detail
            }
        }
        return status > 0 ? "token exchange failed (HTTP \(status))" : "the sign-in provider rejected the token exchange"
    }

    private func persist(accessToken: String, refreshToken: String?, fallbackEmail: String?) -> Bool {
        let (jwtEmail, jwtName, jwtSub) = Self.decodeJWT(accessToken)
        let resolvedEmail = jwtEmail.isEmpty ? (fallbackEmail ?? "") : jwtEmail
        let identity = resolvedEmail.isEmpty ? jwtSub : resolvedEmail
        guard !identity.isEmpty else { return false }

        defaults.set(identity, forKey: "voidai.email")
        defaults.set(jwtName, forKey: "voidai.name")
        defaults.set(jwtSub, forKey: "voidai.userId")
        Keychain.set(accessToken, for: "voidai.accessToken")
        if let refreshToken = refreshToken, !refreshToken.isEmpty {
            Keychain.set(refreshToken, for: "voidai.refreshToken")
        } else {
            Keychain.delete("voidai.refreshToken")
        }
        defaults.removeObject(forKey: "voidai.accessToken")
        defaults.removeObject(forKey: "voidai.refreshToken")
        defaults.synchronize()
        lastError = nil
        return true
    }

    private func token(for key: String) -> String {
        if let value = Keychain.get(key), !value.isEmpty { return value }
        if let legacy = defaults.string(forKey: key), !legacy.isEmpty {
            Keychain.set(legacy, for: key)
            defaults.removeObject(forKey: key)
            return legacy
        }
        return ""
    }

    private func revoke(_ token: String) {
        guard !token.isEmpty, let url = URL(string: "\(supabaseURL)/auth/v1/logout") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: request).resume()
    }

    private static func params(from url: URL) -> [String: String] {
        let raw: String
        if let fragment = url.fragment, !fragment.isEmpty {
            raw = fragment
        } else {
            raw = url.query ?? ""
        }
        var params: [String: String] = [:]
        for pair in raw.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if parts.count == 2 {
                params[parts[0]] = parts[1].removingPercentEncoding ?? parts[1]
            }
        }
        return params
    }

    static func decodeJWT(_ token: String) -> (String, String, String) {
        let segments = token.split(separator: ".")
        guard segments.count > 1 else { return ("", "", "") }
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
            return ("", "", "")
        }
        let email = (json["email"] as? String) ?? ""
        let sub = (json["sub"] as? String) ?? ""
        let metadata = json["user_metadata"] as? [String: Any]
        let name = (metadata?["user_name"] as? String) ?? (metadata?["name"] as? String) ?? ""
        return (email, name, sub)
    }

    private static func randomURLSafe(byteCount: Int) -> String? {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        guard SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes) == errSecSuccess else {
            return nil
        }
        return base64URL(Data(bytes))
    }

    private static func sha256Base64URL(_ value: String) -> String {
        let digest = SHA256.hash(data: Data(value.utf8))
        return base64URL(Data(digest))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private enum Keychain {
        static let service = "com.voidai.app.auth"

        static func set(_ value: String, for account: String) {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account
            ]
            SecItemDelete(query as CFDictionary)
            var add = query
            add[kSecValueData as String] = Data(value.utf8)
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(add as CFDictionary, nil)
        }

        static func get(_ account: String) -> String? {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne
            ]
            var result: CFTypeRef?
            guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
                  let data = result as? Data
            else { return nil }
            return String(data: data, encoding: .utf8)
        }

        static func delete(_ account: String) {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account
            ]
            SecItemDelete(query as CFDictionary)
        }
    }
}
