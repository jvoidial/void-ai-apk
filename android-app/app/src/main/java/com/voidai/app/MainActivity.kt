package com.voidai.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
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
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val callback = filePathCallback
        filePathCallback = null
        if (callback == null) return@registerForActivityResult
        if (result.resultCode == Activity.RESULT_OK) {
            callback.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            )
        } else {
            callback.onReceiveValue(null)
        }
    }

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
                return m?.get("user_name")?.toString()?.trim('"')
                    ?: m?.get("name")?.toString()?.trim('"')
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
                            val fileNameJs = JSONObject.quote(fileName)
                            webView.evaluateJavascript(
                                "window.onFileUploaded && window.onFileUploaded($fileNameJs)", null
                            )
                        } catch (e: Exception) { sendAuthError("upload failed: " + (e.message ?: "unknown")) }
                    }
                }
            }
        }, "Android")

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: WebChromeClient.FileChooserParams?
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                return try {
                    val intent = params?.createIntent() ?: return false
                    fileChooserLauncher.launch(intent)
                    true
                } catch (e: Exception) {
                    Log.e("VOIDAI", "file chooser failed", e)
                    filePathCallback = null
                    false
                }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                val sb = supabase ?: return
                val u = sb.auth.currentUserOrNull() ?: return
                val email = u.email ?: u.id ?: ""
                val m = u.userMetadata
                val name = m?.get("user_name")?.toString()?.trim('"') ?: m?.get("name")?.toString()?.trim('"') ?: ""
                if (email.isNotEmpty()) fireSignedIn(email, name)
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
        if (!data.startsWith("voidai://auth-callback")) return
        Log.i("VOIDAI", "handleIntent len=${data.length}")

        if (data.contains("error=")) {
            Log.e("VOIDAI", "oauth error: ${data.take(200)}")
            sendAuthError(data.take(200))
            return
        }

        val sb = supabase ?: run {
            sendAuthError("Supabase unavailable")
            return
        }

        lifecycleScope.launch {
            // The SDK handles both PKCE (?code=) and implicit (#access_token=)
            // callbacks. Importing manually is only a fallback.
            try {
                sb.handleDeeplinks(intent)
            } catch (e: Throwable) {
                Log.w("VOIDAI", "handleDeeplinks failed: ${e.message}")
            }

            var user = sb.auth.currentUserOrNull()
            var email = user?.email ?: ""
            var name = user?.userMetadata?.let { meta ->
                meta["user_name"]?.toString()?.trim('"') ?: meta["name"]?.toString()?.trim('"')
            } ?: ""

            if (user == null) {
                val session = sessionFromUrl(data)
                if (session != null) {
                    try {
                        sb.auth.importSession(session)
                        user = sb.auth.currentUserOrNull()
                        email = user?.email ?: email
                        if (name.isEmpty()) {
                            name = user?.userMetadata?.let { meta ->
                                meta["user_name"]?.toString()?.trim('"') ?: meta["name"]?.toString()?.trim('"')
                            } ?: ""
                        }
                        if (email.isEmpty()) {
                            val (jwtEmail, jwtName, jwtSub) = decodeJwt(session.accessToken)
                            email = jwtEmail.ifEmpty { jwtSub }
                            if (name.isEmpty()) name = jwtName
                        }
                    } catch (e: Throwable) {
                        Log.e("VOIDAI", "importSession failed", e)
                    }
                }
            }

            if (email.isEmpty()) email = user?.id ?: ""
            if (email.isEmpty()) {
                sendAuthError("sign-in did not return a user")
                return@launch
            }
            fireSignedIn(email, name)
        }
    }

    private fun sessionFromUrl(data: String): UserSession? {
        val fragment = if (data.contains("#")) data.substringAfter("#") else data.substringAfter("?", "")
        if (fragment.isEmpty()) return null
        val params = fragment.split("&").mapNotNull { kv ->
            val i = kv.indexOf("=")
            if (i > 0) kv.substring(0, i) to Uri.decode(kv.substring(i + 1)) else null
        }.toMap()
        val accessToken = params["access_token"] ?: return null
        val refreshToken = params["refresh_token"] ?: return null
        return UserSession(
            accessToken = accessToken,
            refreshToken = refreshToken,
            expiresIn = (params["expires_in"]?.toLongOrNull() ?: 3600L),
            tokenType = params["token_type"] ?: "bearer",
            user = null,
            providerToken = params["provider_token"],
            providerRefreshToken = params["provider_refresh_token"]
        )
    }

    private fun decodeJwt(token: String): Triple<String, String, String> {
        return try {
            val seg = token.split(".").getOrNull(1) ?: return Triple("", "", "")
            val padded = seg + "=".repeat((4 - seg.length % 4) % 4)
            val b64 = padded.replace('-', '+').replace('_', '/')
            val json = JSONObject(String(Base64.decode(b64, Base64.DEFAULT), Charsets.UTF_8))
            val meta = json.optJSONObject("user_metadata")
            val name = meta?.optString("user_name").orEmpty()
                .ifEmpty { meta?.optString("name").orEmpty() }
            Triple(json.optString("email"), name, json.optString("sub"))
        } catch (e: Throwable) {
            Log.e("VOIDAI", "jwt decode failed", e)
            Triple("", "", "")
        }
    }

    private fun fireSignedIn(email: String, name: String) {
        val emailJs = JSONObject.quote(email)
        val nameJs = JSONObject.quote(name)
        webView.evaluateJavascript(
            "window.onSignedIn && window.onSignedIn($emailJs, $nameJs)", null
        )
        Log.i("VOIDAI", "onSignedIn fired: $email")
    }

    private fun sendAuthError(message: String) {
        val safe = JSONObject.quote(message.replace("\n", " ").take(500))
        webView.evaluateJavascript(
            "window.onAuthError && window.onAuthError($safe)", null
        )
    }
}
