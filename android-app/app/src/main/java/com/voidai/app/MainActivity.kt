package com.voidai.app

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.handleDeeplinks
import io.github.jan.supabase.auth.providers.Github
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.storage.Storage
import io.github.jan.supabase.storage.storage
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    // Null-safe lazy Supabase. If init fails, `supabase` is null and
    // the app keeps working — login page just shows "unavailable".
    private val supabase: SupabaseClient? by lazy {
        try {
            createSupabaseClient(
                supabaseUrl = "https://wtyksmoqeehmbcqwedkc.supabase.co",
                supabaseKey = "sb_publishable_xlfATZ6QU2ATxhWrdkfKpQ_l3a0gF4P"
            ) {
                install(Auth) {
                    scheme = "voidai"
                    host = "auth-callback"
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

        webView.addJavascriptInterface(object {

            @JavascriptInterface
            fun signInWithGitHub() {
                runOnUiThread {
                    val sb = supabase
                    if (sb == null) {
                        sendAuthError("Supabase unavailable")
                        return@runOnUiThread
                    }
                    lifecycleScope.launch {
                        try {
                            sb.auth.signInWith(Github)
                        } catch (e: Exception) {
                            sendAuthError(e.message ?: "sign-in failed")
                        }
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
                        } catch (e: Exception) {
                            sendAuthError(e.message ?: "sign-out failed")
                        }
                    }
                }
            }

            @JavascriptInterface
            fun getCurrentUser(): String {
                val sb = supabase ?: return ""
                val user = sb.auth.currentUserOrNull() ?: return ""
                return user.email ?: user.id ?: ""
            }

            @JavascriptInterface
            fun getUserName(): String {
                val sb = supabase ?: return ""
                val user = sb.auth.currentUserOrNull() ?: return ""
                val m = user.userMetadata
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
                        } catch (e: Exception) {
                            sendAuthError("upload failed: " + (e.message ?: "unknown"))
                        }
                    }
                }
            }
        }, "Android")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                val sb = supabase ?: return
                val user = sb.auth.currentUserOrNull() ?: return
                val email = user.email ?: ""
                val m = user.userMetadata
                val name = m?.get("user_name")?.toString()
                    ?: m?.get("name")?.toString()
                    ?: ""
                val safeEmail = email.replace("'", "\\'")
                val safeName = name.replace("'", "\\'")
                val js = "if (window.onSignedIn) { window.onSignedIn('" + safeEmail + "', '" + safeName + "') }"
                webView.evaluateJavascript(js, null)
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack()
                else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        handleIntent(intent)

        // Show login page first
        webView.loadUrl("file:///android_asset/login.html")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent) {
        val data = intent.data?.toString() ?: return
        if (!data.startsWith("voidai://auth-callback")) return
        val sb = supabase ?: return
        lifecycleScope.launch {
            try {
                sb.handleDeeplinks(intent)
                val user = sb.auth.currentUserOrNull()
                if (user != null) {
                    val email = user.email ?: ""
                    val m = user.userMetadata
                    val name = m?.get("user_name")?.toString()
                        ?: m?.get("name")?.toString()
                        ?: ""
                    val safeEmail = email.replace("'", "\\'")
                    val safeName = name.replace("'", "\\'")
                    val js = "if (window.onSignedIn) { window.onSignedIn('" + safeEmail + "', '" + safeName + "') }"
                    webView.evaluateJavascript(js, null)
                }
            } catch (e: Exception) {
                Log.e("VOIDAI", "Deep link failed", e)
                sendAuthError(e.message ?: "deep link failed")
            }
        }
    }

    private fun sendAuthError(message: String) {
        val safe = message.replace("'", "\\'").replace("\n", " ")
        val js = "if (window.onAuthError) { window.onAuthError('" + safe + "') }"
        webView.evaluateJavascript(js, null)
    }
}
