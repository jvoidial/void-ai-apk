package com.voidai.app

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import androidx.core.net.toUri
import android.os.Bundle
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.ExternalAuthAction
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.handleDeeplinks
import io.github.jan.supabase.auth.user.UserSession
import io.github.jan.supabase.auth.providers.Github
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.storage.Storage
import io.github.jan.supabase.storage.storage
import java.io.PrintWriter
import java.io.StringWriter
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    // Lazy + safe: returns null if anything fails; app never crashes
    private val supabase: SupabaseClient? by lazy {
        try {
            createSupabaseClient(
                supabaseUrl = BuildConfig.SUPABASE_URL,
                supabaseKey = BuildConfig.SUPABASE_ANON_KEY
            ) {
                install(Auth) {
                    scheme = "voidai"
                    host = "auth-callback"
                    defaultExternalAuthAction = ExternalAuthAction.CustomTabs()
                }
                install(Storage)
            }.also { Log.i("VOIDAI", "Supabase ready") }
        } catch (e: Throwable) {
            Log.e("VOIDAI", "Supabase init failed", e)
            null
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Global crash handler — shows error popup if app crashes
        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val sw = StringWriter()
                throwable.printStackTrace(PrintWriter(sw))
                Log.e("VOIDAI_CRASH", sw.toString())
                runOnUiThread {
                    try {
                        AlertDialog.Builder(this)
                            .setTitle("VOIDAI error")
                            .setMessage(sw.toString().take(1500))
                            .setPositiveButton("OK") { _, _ ->
                                defaultHandler?.uncaughtException(thread, throwable)
                            }
                            .setCancelable(false)
                            .show()
                    } catch (_: Throwable) {
                        defaultHandler?.uncaughtException(thread, throwable)
                    }
                }
            } catch (_: Throwable) {
                defaultHandler?.uncaughtException(thread, throwable)
            }
        }

        webView = WebView(this)
        setContentView(webView)

        val s: WebSettings = webView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.allowFileAccess = true
        s.allowContentAccess = true

        @Suppress("DEPRECATION")
        s.allowFileAccessFromFileURLs = true

        @Suppress("DEPRECATION")
        s.allowUniversalAccessFromFileURLs = true

        s.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        s.cacheMode = WebSettings.LOAD_DEFAULT

        // ─── JS bridge ───
        webView.addJavascriptInterface(object {

            @JavascriptInterface
            fun signInWithGitHub() {
                runOnUiThread {
                    val sb = supabase
                    if (sb == null) { sendAuthError("Supabase unavailable"); return@runOnUiThread }
                    lifecycleScope.launch {
                        try { sb.auth.signInWith(Github) }
                        catch (e: Exception) { sendAuthError(e.message ?: "sign-in failed") }
                    }
                }
            }

            @JavascriptInterface
            fun signOut() {
                runOnUiThread {
                    val sb = supabase ?: return@runOnUiThread
                    lifecycleScope.launch {
                        try {
                            sb.auth.signOut()
                            webView.evaluateJavascript("window.onSignedOut && window.onSignedOut()", null)
                        } catch (e: Exception) { sendAuthError(e.message ?: "sign-out failed") }
                    }
                }
            }

            @JavascriptInterface
            fun getCurrentUser(): String {
                val sb = supabase ?: return ""
                val u = sb.auth.currentUserOrNull() ?: return ""
                return u.email ?: u.id ?: ""
            }

            @JavascriptInterface
            fun getUserName(): String {
                val sb = supabase ?: return ""
                val u = sb.auth.currentUserOrNull() ?: return ""
                val m = u.userMetadata
                return m?.get("user_name")?.toString()
                    ?: m?.get("name")?.toString()
                    ?: ""
            }

            @JavascriptInterface
            fun uploadFile(fileName: String, base64Data: String) {
                runOnUiThread {
                    val sb = supabase ?: return@runOnUiThread
                    lifecycleScope.launch {
                        try {
                            val bytes = Base64.decode(base64Data, Base64.DEFAULT)
                            sb.storage.from("voidai-uploads").upload(fileName, bytes) { upsert = true }
                            webView.evaluateJavascript("window.onFileUploaded && window.onFileUploaded('" + fileName + "')", null)
                        } catch (e: Exception) { sendAuthError("upload failed: " + (e.message ?: "unknown")) }
                    }
                }
            }
        }, "Android")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                val sb = supabase ?: return
                val u = sb.auth.currentUserOrNull() ?: return
                val email = u.email ?: ""
                val m = u.userMetadata
                val name = m?.get("user_name")?.toString() ?: m?.get("name")?.toString() ?: ""
                val safeE = email.replace("'", "\\'")
                val safeN = name.replace("'", "\\'")
                webView.evaluateJavascript(
                    "if (window.onSignedIn) { window.onSignedIn('" + safeE + "', '" + safeN + "') }", null
                )
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack()
                else { isEnabled = false; onBackPressedDispatcher.onBackPressed() }
            }
        })

        handleIntent(intent)

        // Load the chat page directly (login button lives inside it now)
        webView.loadUrl("file:///android_asset/index.html")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent) {
        val data = intent.data?.toString() ?: return
        Log.i("VOIDAI", "handleIntent len=${data.length}")

        if (!data.startsWith("voidai://auth-callback")) return

        if (data.contains("error=")) {
            Log.e("VOIDAI", "oauth error: ${data.take(200)}")
            sendAuthError(data.take(200))
            return
        }

        val sb = supabase ?: return

        val parts = data.split("#", limit = 2)
        val fragment = if (parts.size > 1) parts[1] else data.substringAfter("?", "")

        val params = fragment.split("&").mapNotNull { kv ->
            val i = kv.indexOf("=")
            if (i > 0) kv.substring(0, i) to kv.substring(i + 1) else null
        }.toMap()

        val accessToken = params["access_token"]
        val refreshToken = params["refresh_token"]

        if (accessToken.isNullOrBlank() || refreshToken.isNullOrBlank()) {
            Log.e("VOIDAI", "missing tokens")
            return
        }

        lifecycleScope.launch {
            try {
                sb.auth.importSession(
                    UserSession(
                        accessToken = accessToken,
                        refreshToken = refreshToken,
                        expiresIn = (params["expires_in"]?.toLongOrNull() ?: 3600L),
                        tokenType = params["token_type"] ?: "bearer",
                        user = null,
                        providerToken = params["provider_token"],
                        providerRefreshToken = params["provider_refresh_token"]
                    )
                )
                Log.i("VOIDAI", "session imported")

                // Decode JWT payload for user info — SDK cache is empty after importSession
                var email = ""
                var name = ""
                try {
                    val seg = accessToken.split(".").getOrNull(1) ?: ""
                    val padded = seg + "=".repeat((4 - seg.length % 4) % 4)
                    val b64 = padded.replace('-', '+').replace('_', '/')
                    val decoded = Base64.decode(b64, Base64.DEFAULT)
                    val json = JSONObject(String(decoded, Charsets.UTF_8))
                    email = json.optString("email", "")
                    val meta = json.optJSONObject("user_metadata")
                    name = meta?.optString("user_name") ?: meta?.optString("name") ?: ""
                    Log.i("VOIDAI", "jwt decoded: $email / $name")
                } catch (e: Throwable) {
                    Log.e("VOIDAI", "jwt decode failed", e)
                }

                // Fallback to SDK
                if (email.isEmpty()) {
                    val u = sb.auth.currentUserOrNull()
                    if (u != null) {
                        email = u.email ?: ""
                        val m = u.userMetadata
                        name = m?.get("user_name")?.toString()
                            ?: m?.get("name")?.toString() ?: ""
                    }
                }

                if (email.isNotEmpty()) {
                    val safeE = email.replace("'", "\\'")
                    val safeN = name.replace("'", "\\'")
                    runOnUiThread {
                        webView.evaluateJavascript(
                            "window.onSignedIn && window.onSignedIn('$safeE', '$safeN')",
                            null
                        )
                    }
                    Log.i("VOIDAI", "onSignedIn fired: $email")
                }
            } catch (e: Throwable) {
                Log.e("VOIDAI", "importSession failed", e)
                sendAuthError(e.message ?: "auth failed")
            }
        }
    }

    private fun sendAuthError(message: String) {
        val safe = message.replace("'", "\\'").replace("\n", " ")
        webView.evaluateJavascript(
            "if (window.onAuthError) { window.onAuthError('" + safe + "') }", null
        )
    }
}
