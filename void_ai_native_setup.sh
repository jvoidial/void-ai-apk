#!/data/data/com.termux/files/usr/bin/bash
set -e

REPO_URL="https://github.com/jvoidial/void-ai-apk.git"
REPO_DIR="$HOME/void-ai-apk"

echo "[1/6] Ensure git is installed"
pkg update -y
pkg install -y git

echo "[2/6] Clone or update repo"
if [ -d "$REPO_DIR/.git" ]; then
  cd "$REPO_DIR"
  git pull --rebase
else
  cd "$HOME"
  git clone "$REPO_URL"
  cd "$REPO_DIR"
fi

cd android-app

echo "[3/6] Write native VOID-AI build.gradle (with OkHttp + JSON)"
cat << 'GRADLE' > app/build.gradle
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace "com.voidai.app"
    compileSdk 34

    defaultConfig {
        applicationId "com.voidai.app"
        minSdk 24
        targetSdk 34
        versionCode 1
        versionName "1.0"
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }

    buildTypes {
        release {
            minifyEnabled false
            shrinkResources false
        }
        debug {
            minifyEnabled false
            shrinkResources false
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.recyclerview:recyclerview:1.3.2")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.json:json:20231013")
}
GRADLE

echo "[4/6] Write AndroidManifest with native VOID-AI MainActivity"
cat << 'MANIFEST' > app/src/main/AndroidManifest.xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.voidai.app">

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="VOID AI"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.VoidAI">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>
MANIFEST

echo "[5/6] Write persona-based MainActivity (GPT-style, remote backend)"
mkdir -p app/src/main/java/com/voidai/app
cat << 'KOTLIN' > app/src/main/java/com/voidai/app/MainActivity.kt
package com.voidai.app

import android.graphics.Typeface
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.button.MaterialButton
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

data class Message(
    val role: String,      // "system", "user", "assistant"
    val content: String,
    val isUser: Boolean
)

class MainActivity : AppCompatActivity() {

    companion object {
        // TODO: set these to your chosen free/open LLM provider
        private const val BASE_URL = "https://your-llm-endpoint.example.com/chat"
        private const val API_KEY = "YOUR_API_KEY_HERE"
    }

    private lateinit var messagesRecycler: RecyclerView
    private lateinit var inputField: TextInputEditText
    private lateinit var sendButton: MaterialButton
    private val messages = mutableListOf<Message>()
    private lateinit var adapter: MessageAdapter
    private val client = OkHttpClient()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        messagesRecycler = findViewById(R.id.messagesRecycler)
        inputField = findViewById(R.id.inputField)
        sendButton = findViewById(R.id.sendButton)

        adapter = MessageAdapter(messages)
        messagesRecycler.layoutManager = LinearLayoutManager(this)
        messagesRecycler.adapter = adapter

        // System persona message
        messages.add(
            Message(
                role = "system",
                content = "You are VOID-AI, Jacob's system persona. " +
                          "You can reason about code, scripts, tools, and deep technical workflows. " +
                          "You respond clearly, can handle long inputs, and may call tools on the backend.",
                isUser = false
            )
        )
        adapter.notifyItemInserted(messages.size - 1)

        sendButton.setOnClickListener {
            val text = inputField.text?.toString()?.trim().orEmpty()
            if (text.isNotEmpty()) {
                addUserMessage(text)
                inputField.setText("")
                sendToBackend()
            }
        }
    }

    private fun addUserMessage(text: String) {
        messages.add(Message(role = "user", content = text, isUser = true))
        adapter.notifyItemInserted(messages.size - 1)
        messagesRecycler.scrollToPosition(messages.size - 1)
    }

    private fun addAssistantMessage(text: String) {
        messages.add(Message(role = "assistant", content = text, isUser = false))
        adapter.notifyItemInserted(messages.size - 1)
        messagesRecycler.scrollToPosition(messages.size - 1)
    }

    // Send full conversation to your chosen GPT-like backend
    private fun sendToBackend() {
        val jsonMessages = JSONArray()
        messages.forEach { msg ->
            val obj = JSONObject()
            obj.put("role", msg.role)
            obj.put("content", msg.content)
            jsonMessages.put(obj)
        }

        val root = JSONObject()
        root.put("messages", jsonMessages)

        val body = RequestBody.create(
            "application/json; charset=utf-8".toMediaTypeOrNull(),
            root.toString()
        )

        val requestBuilder = Request.Builder()
            .url(BASE_URL)
            .post(body)

        if (API_KEY.isNotEmpty()) {
            requestBuilder.addHeader("Authorization", "Bearer $API_KEY")
        }

        val request = requestBuilder.build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread {
                    addAssistantMessage("VOID-AI backend error: ${e.message}")
                }
            }

            override fun onResponse(call: Call, response: Response) {
                val raw = response.body?.string().orEmpty()
                val replyText = try {
                    // If backend returns JSON like { "reply": "..." }
                    val obj = JSONObject(raw)
                    obj.optString("reply", raw)
                } catch (e: Exception) {
                    raw
                }

                runOnUiThread {
                    addAssistantMessage(
                        replyText.ifEmpty {
                            "VOID-AI backend returned empty response."
                        }
                    )
                }
            }
        })
    }
}
KOTLIN

echo "[5a/6] RecyclerView adapter + layouts (code-aware styling)"
cat << 'KOTLIN' > app/src/main/java/com/voidai/app/MessageAdapter.kt
package com.voidai.app

import android.graphics.Typeface
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

class MessageAdapter(private val items: List<Message>) :
    RecyclerView.Adapter<MessageAdapter.MessageViewHolder>() {

    override fun getItemViewType(position: Int): Int {
        return if (items[position].isUser) 1 else 0
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MessageViewHolder {
        val layout = if (viewType == 1) {
            R.layout.item_message_user
        } else {
            R.layout.item_message_bot
        }
        val view = LayoutInflater.from(parent.context).inflate(layout, parent, false)
        return MessageViewHolder(view)
    }

    override fun onBindViewHolder(holder: MessageViewHolder, position: Int) {
        holder.bind(items[position])
    }

    override fun getItemCount(): Int = items.size

    class MessageViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val messageText: TextView = itemView.findViewById(R.id.messageText)
        fun bind(message: Message) {
            messageText.text = message.content
            if (message.content.contains("```") ||
                (message.content.contains("{") && message.content.contains("}")) ||
                message.content.contains("class ") ||
                message.content.contains("def ") ||
                message.content.contains("fun ")
            ) {
                messageText.typeface = Typeface.MONOSPACE
            } else {
                messageText.typeface = Typeface.DEFAULT
            }
        }
    }
}
KOTLIN

mkdir -p app/src/main/res/layout

cat << 'XML' > app/src/main/res/layout/activity_main.xml
<?xml version="1.0" encoding="utf-8"?>
<androidx.coordinatorlayout.widget.CoordinatorLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#000000">

    <androidx.recyclerview.widget.RecyclerView
        android:id="@+id/messagesRecycler"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_margin="8dp"
        android:overScrollMode="never"
        app:layout_behavior="@string/appbar_scrolling_view_behavior"
        android:layout_weight="1" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_gravity="bottom"
        android:orientation="horizontal"
        android:padding="8dp">

        <com.google.android.material.textfield.TextInputEditText
            android:id="@+id/inputField"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:hint="Message VOID-AI..."
            android:maxLines="6"
            android:textColor="@android:color/white"
            android:textColorHint="#888888" />

        <com.google.android.material.button.MaterialButton
            android:id="@+id/sendButton"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="SEND"
            android:textAllCaps="true"
            android:layout_marginStart="8dp" />
    </LinearLayout>

</androidx.coordinatorlayout.widget.CoordinatorLayout>
XML

cat << 'XML' > app/src/main/res/layout/item_message_user.xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:gravity="end"
    android:padding="4dp">

    <TextView
        android:id="@+id/messageText"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:background="@drawable/bg_user_bubble"
        android:padding="8dp"
        android:textColor="@android:color/white" />
</LinearLayout>
XML

cat << 'XML' > app/src/main/res/layout/item_message_bot.xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:gravity="start"
    android:padding="4dp">

    <TextView
        android:id="@+id/messageText"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:background="@drawable/bg_bot_bubble"
        android:padding="8dp"
        android:textColor="@android:color/black" />
</LinearLayout>
XML

mkdir -p app/src/main/res/drawable

cat << 'XML' > app/src/main/res/drawable/bg_user_bubble.xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="#222244" />
    <corners android:radius="16dp" />
</shape>
XML

cat << 'XML' > app/src/main/res/drawable/bg_bot_bubble.xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="#EEEEEE" />
    <corners android:radius="16dp" />
</shape>
XML

echo "[5b/6] Basic strings, colors, theme"
mkdir -p app/src/main/res/values

cat << 'XML' > app/src/main/res/values/strings.xml
<resources>
    <string name="app_name">VOID AI</string>
</resources>
XML

cat << 'XML' > app/src/main/res/values/colors.xml
<resources>
    <color name="purple_500">#6200EE</color>
    <color name="purple_700">#3700B3</color>
    <color name="teal_200">#03DAC5</color>
    <color name="black">#000000</color>
    <color name="white">#FFFFFF</color>
</resources>
XML

cat << 'XML' > app/src/main/res/values/themes.xml
<resources xmlns:tools="http://schemas.android.com/tools">
    <style name="Theme.VoidAI" parent="Theme.MaterialComponents.DayNight.NoActionBar">
        <item name="colorPrimary">@color/purple_500</item>
        <item name="colorPrimaryVariant">@color/purple_700</item>
        <item name="colorOnPrimary">@color/white</item>
        <item name="android:statusBarColor" tools:targetApi="l">@color/black</item>
    </style>
</resources>
XML

echo "[6/6] Commit and push changes"
cd "$REPO_DIR"
git add android-app/app
git commit -m "VOID-AI native GPT-style client with remote LLM backend"
git push

echo "Done. GitHub Actions will now build the updated VOID-AI GPT-style APK."
