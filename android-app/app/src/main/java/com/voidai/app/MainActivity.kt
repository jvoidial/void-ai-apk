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

    private val supabase = createSupabaseClient(
        supabaseUrl = "https://wtyksmoqeehmbcqwedkc.supabase.co",
        supabaseKey = "sb_publishable_xlfATZ6QU2ATxhWrdkfKpQ_l3a0gF4P"
    ) {
        install(Auth) {
            scheme = "voidai"
            host = "auth-callback"
        }
        install(Storage)
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
                    lifecycleScope.launch {
                        try { supabase.auth.signInWith(Github) }
                        catch (e: Exception) { sendAuthError(e.message ?: "sign-in failed") }
                    }
                }
            }
            @JavascriptInterface
            fun signOut() {
                runOnUiThread {
                    lifecycleScope.launch {
                        try {
                            supabase.auth.signOut()
                            webView.evaluateJavascript("window.onSignedOut()", null)
                        } catch (e: Exception) { sendAuthError(e.message ?: "sign-out failed") }
                    }
                }
            }
            @JavascriptInterface
            fun getCurrentUser(): String {
                val user = supabase.auth.currentUserOrNull() ?: return ""
                return user.email ?: user.id ?: ""
            }
            @JavascriptInterface
            fun getUserName(): String {
                val user = supabase.auth.currentUserOrNull() ?: return ""
                val m = user.userMetadata
                return m?.get("user_name")?.toString() ?: m?.get("name")?.toString() ?: ""
            }
            @JavascriptInterface
            fun uploadFile(fileName: String, base64Data: String) {
                runOnUiThread {
                    lifecycleScope.launch {
                        try {
                            val bytes = Base64.decode(base64Data, Base64.DEFAULT)
                            supabase.storage.from("voidai-uploads").upload(fileName, bytes) { upsert = true }
                            webView.evaluateJavascript("window.onFileUploaded('" + fileName + "')", null)
                        } catch (e: Exception) { sendAuthError("upload failed: " + (e.message ?: "unknown")) }
                    }
                }
            }
        }, "Android")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                val user = supabase.auth.currentUserOrNull()
                if (user != null) {
                    val email = user.email ?: ""
                    val m = user.userMetadata
                    val name = m?.get("user_name")?.toString() ?: m?.get("name")?.toString() ?: ""
                    webView.evaluateJavascript(
                        "window.onSignedIn('" + email.replace("'", "\\'") + "', '" + name.replace("'", "\\'") + "')",
                        null
                    )
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack()
                else { isEnabled = false; onBackPressedDispatcher.onBackPressed() }
            }
        })

        handleIntent(intent)
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
        lifecycleScope.launch {
            try {
                supabase.handleDeeplinks(intent)
                val user = supabase.auth.currentUserOrNull()
                if (user != null) {
                    val email = user.email ?: ""
                    val m = user.userMetadata
                    val name = m?.get("user_name")?.toString() ?: m?.get("name")?.toString() ?: ""
                    webView.evaluateJavascript(
                        "window.onSignedIn('" + email.replace("'", "\\'") + "', '" + name.replace("'", "\\'") + "')",
                        null
                    )
                }
            } catch (e: Exception) {
                Log.e("VOIDAI", "Deep link failed", e)
                sendAuthError(e.message ?: "deep link failed")
            }
        }
    }

    private fun sendAuthError(message: String) {
        val safe = message.replace("'", "\\'").replace("\n", " ")
        webView.evaluateJavascript("window.onAuthError('" + safe + "')", null)
    }
}
