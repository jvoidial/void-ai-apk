package com.voidai.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
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
import io.github.jan.supabase.auth.FlowType
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.handleDeeplinks
import io.github.jan.supabase.auth.providers.Github
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.storage.Storage
import io.github.jan.supabase.storage.storage
import java.io.PrintWriter
import java.io.StringWriter
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

class MainActivity : AppCompatActivity() {

    companion object { private const val REQ_NATIVE_AUDIO = 7101 }

    private fun redact(value: Any?): String {
        var text = (value ?: "").toString()
        text = text.replace(Regex("(?i)([?#&](?:access_token|refresh_token|token|code|key|apikey)=)[^&\\s]+"), "${'$'}1[redacted]")
        text = text.replace(Regex("(?i)(Bearer\\s+)[A-Za-z0-9._~+/-]{8,}"), "${'$'}1[redacted]")
        text = text.replace(Regex("\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\b"), "[redacted-jwt]")
        return text.take(500)
    }

    private val SAFE_DATA_IMAGE = listOf(
        "data:image/png", "data:image/jpeg", "data:image/jpg",
        "data:image/gif", "data:image/webp"
    )

    private lateinit var webView: WebView
    private var webPageReady = false
    private var pendingAuthError: String? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingWebPermission: PermissionRequest? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var ttsToken = ""
    private var speechRecognizer: SpeechRecognizer? = null
    private var speechListening = false
    private var pendingStartListening = false

    private val webPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        val request = pendingWebPermission
        pendingWebPermission = null
        if (request == null) return@registerForActivityResult
        val allGranted = request.resources.all { resource ->
            val permission = when (resource) {
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
                    // The SDK default is IMPLICIT; force PKCE so the OAuth state
                    // is validated and callbacks cannot inject a session.
                    flowType = FlowType.PKCE
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
        initTts()

        val s: WebSettings = webView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.allowFileAccess = true
        s.allowContentAccess = true
        s.javaScriptCanOpenWindowsAutomatically = false
        s.setSupportMultipleWindows(false)

        @Suppress("DEPRECATION")
        s.allowFileAccessFromFileURLs = false

        @Suppress("DEPRECATION")
        s.allowUniversalAccessFromFileURLs = false

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
            fun isSpeechAvailable(): Boolean {
                return try { SpeechRecognizer.isRecognitionAvailable(this@MainActivity) } catch (_: Exception) { false }
            }

            @JavascriptInterface
            fun startListening(): Boolean {
                if (!isSpeechAvailable()) return false
                if (ContextCompat.checkSelfPermission(
                        this@MainActivity, Manifest.permission.RECORD_AUDIO
                    ) != PackageManager.PERMISSION_GRANTED
                ) {
                    pendingStartListening = true
                    runOnUiThread {
                        requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_NATIVE_AUDIO)
                    }
                    return true
                }
                runOnUiThread { startNativeListening() }
                return true
            }

            @JavascriptInterface
            fun stopListening() {
                pendingStartListening = false
                runOnUiThread { stopNativeListening() }
            }

            @JavascriptInterface
            fun isListening(): Boolean = speechListening

            @JavascriptInterface
            fun speak(text: String, rate: Float, pitch: Float, token: String): Boolean {
                val engine = tts ?: return false
                if (!ttsReady) return false
                val clean = text.trim()
                if (clean.isEmpty()) return false
                ttsToken = token
                val max = TextToSpeech.getMaxSpeechInputLength().coerceAtLeast(200)
                val spoken = if (clean.length <= max) clean else clean.take(max - 1)
                runOnUiThread {
                    try {
                        engine.setSpeechRate(rate.coerceIn(0.5f, 2.0f))
                        engine.setPitch(pitch.coerceIn(0.5f, 2.0f))
                        engine.speak(spoken, TextToSpeech.QUEUE_FLUSH, null, token)
                    } catch (e: Exception) {
                        Log.w("VOIDAI", "tts speak failed: ${redact(e.message)}")
                    }
                }
                return true
            }

            @JavascriptInterface
            fun stopSpeak() {
                ttsToken = ""
                runOnUiThread {
                    try { tts?.stop() } catch (_: Exception) {}
                }
            }

            @JavascriptInterface
            fun isSpeaking(): Boolean = try { tts?.isSpeaking == true } catch (_: Exception) { false }

            @JavascriptInterface
            fun uploadFile(fileName: String, base64Data: String) {
                runOnUiThread {
                    val sb = supabase ?: return@runOnUiThread
                    lifecycleScope.launch {
                        try {
                            if (base64Data.length > 16 * 1024 * 1024) {
                                sendAuthError("upload too large (max 12 MB)")
                                return@launch
                            }
                            val safeName = fileName
                                .replace('\\', '/')
                                .substringAfterLast('/')
                                .replace(Regex("[^A-Za-z0-9._-]"), "_")
                                .take(120)
                            if (safeName.isEmpty()) {
                                sendAuthError("invalid upload name")
                                return@launch
                            }
                            val bytes = Base64.decode(base64Data, Base64.DEFAULT)
                            sb.storage.from("voidai-uploads").upload(safeName, bytes) { upsert = true }
                            val fileNameJs = JSONObject.quote(safeName)
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
                    if (request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                        request.deny()
                        return@runOnUiThread
                    }
                    val needed = mutableListOf<String>()
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
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                val scheme = url.scheme?.lowercase() ?: return true
                if (scheme == "file" && url.toString().startsWith("file:///android_asset/")) {
                    return false
                }
                if (scheme == "http" || scheme == "https" || scheme == "mailto" || scheme == "tel") {
                    return try {
                        startActivity(Intent(Intent.ACTION_VIEW, url))
                        true
                    } catch (e: Exception) {
                        Log.w("VOIDAI", "external link blocked: ${redact(e.message)}")
                        true
                    }
                }
                // Keep the app's local image/builder download paths working.
                val raw = url.toString().lowercase()
                if (scheme == "blob") return false
                if (scheme == "data" && SAFE_DATA_IMAGE.any { raw.startsWith(it) }) return false
                // Never let a remote or data document inherit the native JS bridge.
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                if (url.startsWith("file:///android_asset/")) {
                    webPageReady = true
                    pendingAuthError?.let { message ->
                        pendingAuthError = null
                        sendAuthError(message)
                    }
                    restoreSignedInState()
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

    private fun createNativeRecognizer(): SpeechRecognizer {
        speechRecognizer?.destroy()
        val recognizer = SpeechRecognizer.createSpeechRecognizer(this)
        recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {
                speechListening = false
            }

            override fun onError(error: Int) {
                speechListening = false
                when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH,
                    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> notifyNativeSpeechEnd()
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
                        notifyNativeSpeechError("microphone permission denied")
                    SpeechRecognizer.ERROR_NETWORK,
                    SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
                        notifyNativeSpeechError("speech service network unavailable")
                    SpeechRecognizer.ERROR_RECOGNIZER_BUSY ->
                        notifyNativeSpeechError("speech recognizer busy")
                    else -> notifyNativeSpeechError("speech recognition error $error")
                }
            }

            override fun onResults(results: Bundle?) {
                speechListening = false
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull()?.trim().orEmpty()
                if (text.isNotEmpty()) notifyNativeSpeechResult(text, true)
                notifyNativeSpeechEnd()
            }

            override fun onPartialResults(partialResults: Bundle?) {
                val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull()?.trim().orEmpty()
                if (text.isNotEmpty()) notifyNativeSpeechResult(text, false)
            }

            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        speechRecognizer = recognizer
        return recognizer
    }

    private fun startNativeListening() {
        if (speechListening) return
        if (ContextCompat.checkSelfPermission(
                this, Manifest.permission.RECORD_AUDIO
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            pendingStartListening = true
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_NATIVE_AUDIO)
            return
        }
        try {
            val recognizer = speechRecognizer ?: createNativeRecognizer()
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.US.toLanguageTag())
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
            }
            speechListening = true
            recognizer.startListening(intent)
        } catch (e: Exception) {
            speechListening = false
            notifyNativeSpeechError(e.message ?: "speech recognizer unavailable")
        }
    }

    private fun stopNativeListening() {
        speechListening = false
        try { speechRecognizer?.cancel() } catch (_: Exception) {}
    }

    private fun notifyNativeSpeechResult(text: String, isFinal: Boolean) {
        runOnUiThread {
            webView.evaluateJavascript(
                "window.voidaiNativeSpeechResult && window.voidaiNativeSpeechResult(" +
                    JSONObject.quote(text) + ", " + isFinal + ");",
                null
            )
        }
    }

    private fun notifyNativeSpeechError(message: String) {
        runOnUiThread {
            webView.evaluateJavascript(
                "window.voidaiNativeSpeechError && window.voidaiNativeSpeechError(" +
                    JSONObject.quote(message) + ");",
                null
            )
        }
    }

    private fun notifyNativeSpeechEnd() {
        runOnUiThread {
            webView.evaluateJavascript(
                "window.voidaiNativeSpeechEnd && window.voidaiNativeSpeechEnd();",
                null
            )
        }
    }

    private fun initTts() {
        try {
            tts = TextToSpeech(this) { status ->
                if (status != TextToSpeech.SUCCESS) return@TextToSpeech
                val engine = tts ?: return@TextToSpeech
                var language = try { engine.setLanguage(Locale.US) } catch (_: Exception) { TextToSpeech.LANG_NOT_SUPPORTED }
                ttsReady = language != TextToSpeech.LANG_MISSING_DATA && language != TextToSpeech.LANG_NOT_SUPPORTED
                if (!ttsReady) {
                    language = try { engine.setLanguage(Locale.UK) } catch (_: Exception) { TextToSpeech.LANG_NOT_SUPPORTED }
                    ttsReady = language != TextToSpeech.LANG_MISSING_DATA && language != TextToSpeech.LANG_NOT_SUPPORTED
                }
                selectFemaleTtsVoice(engine)
                engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) = notifyTtsDone(utteranceId)
                    @Deprecated("Deprecated in Java")
                    override fun onError(utteranceId: String?) = notifyTtsDone(utteranceId)
                    override fun onError(utteranceId: String?, errorCode: Int) = notifyTtsDone(utteranceId)
                    override fun onStop(utteranceId: String?, interrupted: Boolean) = notifyTtsDone(utteranceId)
                })
            }
        } catch (e: Exception) {
            Log.w("VOIDAI", "tts init failed: ${redact(e.message)}")
            ttsReady = false
        }
    }

    private fun selectFemaleTtsVoice(engine: TextToSpeech) {
        try {
            val voices = engine.voices ?: return
            val maleRegex = Regex("\\b(david|mark|daniel|alex|fred|tom|aaron|adam|guy|matthew|joey|brian|russell|rishi|oliver|arthur|george|james|ryan|eric|christopher)\\b")
            val female = listOf("female", "samantha", "victoria", "karen", "moira", "tessa", "fiona", "allison", "ava", "susan", "zoe", "serena", "aria", "jenny", "zira", "alexa", "kate", "nicky", "kathy", "veena", "joanna", "salli", "kimberly", "ivy", "kendra", "emma", "amy", "olivia", "sophie", "michelle", "natasha", "clara", "hazel", "sonia", "libby", "emily")
            val young = listOf("aria", "jenny", "ava", "emma", "olivia", "samantha", "michelle", "zoe", "serena")
            val english = voices.filter { it.locale.language.equals("en", true) }
            val us = english.filter { it.locale.country.equals("US", true) }
            val pool = if (us.isNotEmpty()) us else english
            val candidates = pool.filter { voice ->
                val name = voice.name.lowercase(Locale.US)
                female.any { name.contains(it) } &&
                    !maleRegex.containsMatchIn(name) && !name.contains("#male") && !name.contains("male_1") && !name.contains("male_2")
            }
            val chosen = candidates.firstOrNull { voice ->
                val name = voice.name.lowercase(Locale.US)
                young.any { name.contains(it) }
            } ?: candidates.firstOrNull() ?: pool.firstOrNull()
            if (chosen != null) engine.voice = chosen
        } catch (e: Exception) {
            Log.w("VOIDAI", "tts voice select failed: ${redact(e.message)}")
        }
    }

    private fun notifyTtsDone(utteranceId: String?) {
        if (utteranceId == null || utteranceId != ttsToken) return
        runOnUiThread {
            try {
                webView.evaluateJavascript(
                    "window.voidaiNativeSpeechDone && window.voidaiNativeSpeechDone(" +
                        JSONObject.quote(utteranceId) + ");",
                    null
                )
            } catch (_: Exception) {}
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_NATIVE_AUDIO) {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
                if (pendingStartListening) {
                    pendingStartListening = false
                    startNativeListening()
                }
            } else {
                pendingStartListening = false
                notifyNativeSpeechError("microphone permission denied")
                notifyNativeSpeechEnd()
            }
        }
    }

    override fun onDestroy() {
        try { speechRecognizer?.destroy() } catch (_: Exception) {}
        speechRecognizer = null
        speechListening = false
        try { tts?.stop(); tts?.shutdown() } catch (_: Exception) {}
        tts = null
        ttsReady = false
        super.onDestroy()
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
            // The SDK validates the PKCE code and OAuth state. Do not import
            // tokens from the callback URL manually; that bypasses state checks.
            try {
                withTimeoutOrNull(15000) { sb.handleDeeplinks(intent) }
            } catch (e: Throwable) {
                Log.w("VOIDAI", "handleDeeplinks failed: ${redact(e.message)}")
            }

            // PKCE exchange can finish just after the callback intent is handled.
            var user = sb.auth.currentUserOrNull()
            var attempts = 0
            while (user == null && attempts < 12) {
                delay(150L)
                user = sb.auth.currentUserOrNull()
                attempts++
            }
            if (attempts > 0) Log.i("VOIDAI", "auth callback waited ${attempts * 150}ms")
            var email = user?.email ?: ""
            val name = user?.userMetadata?.let { meta ->
                meta["user_name"]?.toString()?.trim('"') ?: meta["name"]?.toString()?.trim('"')
            } ?: ""

            if (email.isEmpty()) email = user?.id ?: ""
            if (email.isEmpty()) {
                sendAuthError("sign-in did not return a user")
                return@launch
            }
            fireSignedIn(email, name)
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
