package com.voidai.app

import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        web = WebView(this).apply {
            val s = settings
            s.javaScriptEnabled = true
            s.domStorageEnabled = true
            s.allowFileAccess = true
            s.allowContentAccess = true
            s.allowFileAccessFromFileURLs = true
            s.allowUniversalAccessFromFileURLs = true
            s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            s.loadsImagesAutomatically = true

            webViewClient = WebViewClient()
            webChromeClient = WebChromeClient()

            loadUrl("file:///android_asset/index.html")
        }

        setContentView(web)
    }

    override fun onBackPressed() {
        if (this::web.isInitialized && web.canGoBack()) web.goBack()
        else super.onBackPressed()
    }
}
