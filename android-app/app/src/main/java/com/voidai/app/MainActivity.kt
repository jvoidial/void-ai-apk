package com.voidai.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

class MainActivity : AppCompatActivity() {

    private fun redact(value: Any?): String {
        var text = (value ?: "").toString()
        text = text.replace(Regex("(?i)([?#&](?:access_token|refresh_token|token|code|key|apikey)=)[^&\\s]+"), "${'$'}1[redacted]")
        text = text.replace(Regex("(?i)(Bearer\\s+)[A-Za-z0-9._~+/-]{8,}"), "${'$'}1[redacted]")
        text = text.replace(Regex("\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\b"), "[redacted-jwt]")
        return text.take(500)
    }

    private lateinit var webView: WebView
    private var webPageReady = false
    private var pendingAuthError: String? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingWebPermission: PermissionRequest? = null

    private val webPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        val request = pendingWebPermission
        pendingWebPermission = null
        if (request == null) return@registerForActivityResult
        val allGranted = request.resources.all { resource ->
            val permission = when (resource) {
                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
                else -> null
            }
            permission == null || grants[permission] == true
        }
        if (allGranted) request.grant(request.resources) else request.deny()
    }

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
            Log.e("VOIDAI", "Supabase init failed: ${redact(e.message)}")
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
                val crash = redact(sw.toString())
                Log.e("VOIDAI_CRASH", crash)
                runOnUiThread {
                    try {
                        AlertDialog.Builder(this)
                            .setTitle("VOIDAI error")
                            .setMessage(crash.take(1500))
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
        s.mediaPlaybackRequiresUserGesture = false

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
            fun getUserId(): String {
                val sb = supabase ?: return ""
                return sb.auth.currentUserOrNull()?.id ?: ""
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
            override fun onPermissionRequest(request: PermissionRequest?) {
                if (request == null) return
                runOnUiThread {
                    val needed = mutableListOf<String>()
                    if (request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE) &&
                        ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                        needed.add(Manifest.permission.CAMERA)
                    }
                    if (request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE) &&
                        ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                        needed.add(Manifest.permission.RECORD_AUDIO)
                    }
                    if (needed.isEmpty()) {
                        request.grant(request.resources)
                    } else {
                        pendingWebPermission = request
                        webPermissionLauncher.launch(needed.toTypedArray())
                    }
                }
            }

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
                webPageReady = true
                pendingAuthError?.let { message ->
                    pendingAuthError = null
                    sendAuthError(message)
                }
                restoreSignedInState()
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

    override fun onResume() {
        super.onResume()
        // A Custom Tab or a process restart can finish after the page is ready.
        // Re-check the persisted Supabase session so the signed-in state survives
        // home/launcher round trips and cold starts.
        restoreSignedInState()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun restoreSignedInState() {
        if (!webPageReady) return
        val sb = supabase ?: return
        lifecycleScope.launch {
            // Auth storage loading is asynchronous in supabase-kt. Waiting for
            // initialization avoids showing the signed-out state on a cold start.
            try {
                withTimeoutOrNull(5000) { sb.auth.awaitInitialization() }
            } catch (e: Exception) {
                Log.w("VOIDAI", "auth initialization failed: ${redact(e.message)}")
            }
            repeat(3) { attempt ->
                val user = sb.auth.currentUserOrNull()
                if (user != null) {
                    val email = user.email ?: user.id ?: ""
                    if (email.isNotEmpty()) {
                        val meta = user.userMetadata
                        val name = meta?.get("user_name")?.toString()?.trim('"')
                            ?: meta?.get("name")?.toString()?.trim('"')
                            ?: ""
                        fireSignedIn(email, name)
                        return@launch
                    }
                }
                if (attempt < 2) delay(100L)
            }
        }
    }

    private fun handleIntent(intent: Intent) {
        val data = intent.data?.toString() ?: return
        if (!data.startsWith("voidai://auth-callback")) return
        Log.i("VOIDAI", "handleIntent len=${data.length}")

        if (data.contains("error=")) {
            val detail = redact(data)
            Log.e("VOIDAI", "oauth error: $detail")
            sendAuthError(detail)
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
                Log.w("VOIDAI", "handleDeeplinks failed: ${redact(e.message)}")
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
                        Log.e("VOIDAI", "importSession failed: ${redact(e.message)}")
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
            Log.e("VOIDAI", "jwt decode failed: ${redact(e.message)}")
            Triple("", "", "")
        }
    }

    private fun fireSignedIn(email: String, name: String) {
        if (!webPageReady) return
        val emailJs = JSONObject.quote(email)
        val nameJs = JSONObject.quote(name)
        webView.evaluateJavascript(
            "window.onSignedIn && window.onSignedIn($emailJs, $nameJs)", null
        )
        Log.i("VOIDAI", "onSignedIn fired")
    }

    private fun sendAuthError(message: String) {
        if (!webPageReady) {
            pendingAuthError = message
            return
        }
        val safe = JSONObject.quote(redact(message.replace("\n", " ")))
        webView.evaluateJavascript(
            "window.onAuthError && window.onAuthError($safe)", null
        )
    }
}
