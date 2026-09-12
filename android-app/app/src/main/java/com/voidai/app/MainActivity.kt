package com.voidai.app

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.os.Bundle
import android.util.Log
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import java.io.PrintWriter
import java.io.StringWriter

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // ══════════════════════════════════════════════════════
        // CRASH HANDLER — shows errors on screen instead of dying
        // ══════════════════════════════════════════════════════
        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val sw = StringWriter()
                throwable.printStackTrace(PrintWriter(sw))
                val trace = sw.toString()

                Log.e("VOIDAI_CRASH", trace)

                runOnUiThread {
                    try {
                        AlertDialog.Builder(this)
                            .setTitle("VOIDAI crashed")
                            .setMessage(trace.take(2000))
                            .setPositiveButton("OK") { _, _ ->
                                defaultHandler?.uncaughtException(thread, throwable)
                            }
                            .setCancelable(false)
                            .show()
                    } catch (e: Throwable) {
                        defaultHandler?.uncaughtException(thread, throwable)
                    }
                }
            } catch (e: Throwable) {
                defaultHandler?.uncaughtException(thread, throwable)
            }
        }

        // ══════════════════════════════════════════════════════
        // MINIMAL APP — nothing that can crash
        // ══════════════════════════════════════════════════════
        webView = WebView(this)
        setContentView(webView)

        val s: WebSettings = webView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = true

        @Suppress("DEPRECATION")
        s.allowFileAccessFromFileURLs = true

        @Suppress("DEPRECATION")
        s.allowUniversalAccessFromFileURLs = true

        webView.webViewClient = WebViewClient()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack()
                else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        webView.loadUrl("file:///android_asset/index.html")
    }
}
