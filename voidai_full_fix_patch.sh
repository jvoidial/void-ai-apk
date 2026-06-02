#!/data/data/com.termux/files/usr/bin/bash
set -e

REPO_URL="https://github.com/jvoidial/void-ai-apk.git"
REPO_DIR="$HOME/void-ai-apk"

echo "[1/5] Ensure git is installed"
pkg update -y
pkg install -y git

echo "[2/5] Clone or update repo"
if [ -d "$REPO_DIR/.git" ]; then
  cd "$REPO_DIR"
  git pull --rebase
else
  cd "$HOME"
  git clone "$REPO_URL"
  cd "$REPO_DIR"
fi

cd android-app

echo "[3/5] Safe VOIDAI GPT build.gradle (keeps OkHttp/JSON if you later re-enable backend)"
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

echo "[4/5] MainActivity: VOIDAI GPT persona + local stub (no network, no crash)"
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

data class Message(
    val role: String,      // "system", "user", "assistant"
    val content: String,
    val isUser: Boolean
)

class MainActivity : AppCompatActivity() {

    private lateinit var messagesRecycler: RecyclerView
    private lateinit var inputField: TextInputEditText
    private lateinit var sendButton: MaterialButton
    private val messages = mutableListOf<Message>()
    private lateinit var adapter: MessageAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        messagesRecycler = findViewById(R.id.messagesRecycler)
        inputField = findViewById(R.id.inputField)
        sendButton = findViewById(R.id.sendButton)

        adapter = MessageAdapter(messages)
        messagesRecycler.layoutManager = LinearLayoutManager(this)
        messagesRecycler.adapter = adapter

        // System persona
        messages.add(
            Message(
                role = "system",
                content = "You are VOIDAI GPT, Jacob's technical, code-aware assistant. " +
                          "You handle scripts, tools, and long inputs with clear, high-signal answers.",
                isUser = false
            )
        )
        adapter.notifyItemInserted(messages.size - 1)

        sendButton.setOnClickListener {
            val text = inputField.text?.toString()?.trim().orEmpty()
            if (text.isNotEmpty()) {
                addUserMessage(text)
                inputField.setText("")
                addLocalStubReply(text)
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

    // Local GPT-style stub so the app never crashes while backend is not wired
    private fun addLocalStubReply(userText: String) {
        val reply = """
            VOIDAI GPT (local stub):

            I received your message and would normally send it to a model backend.

            You said:
            $userText

            Once you configure a real endpoint, this reply will come from that model instead.
        """.trimIndent()

        addAssistantMessage(reply)
    }
}
KOTLIN

echo "[4a/5] MessageAdapter with code-aware styling"
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

mkdir -p app/src/main/res/layout app/src/main/res/drawable app/src/main/res/values

echo "[4b/5] Grok/DeepSeek-style dark UI"
cat << 'XML' > app/src/main/res/layout/activity_main.xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:orientation="vertical"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#050509">

    <!-- Top bar -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="56dp"
        android:orientation="horizontal"
        android:paddingStart="16dp"
        android:paddingEnd="16dp"
        android:gravity="center_vertical"
        android:background="#050509">

        <TextView
            android:id="@+id/title"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="VOIDAI GPT"
            android:textColor="@android:color/white"
            android:textSize="18sp"
            android:textStyle="bold" />
    </LinearLayout>

    <!-- Messages -->
    <androidx.recyclerview.widget.RecyclerView
        android:id="@+id/messagesRecycler"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:padding="8dp"
        android:overScrollMode="never" />

    <!-- Input bar -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:padding="8dp"
        android:gravity="center_vertical">

        <com.google.android.material.textfield.TextInputEditText
            android:id="@+id/inputField"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:hint="Message VOIDAI..."
            android:maxLines="4"
            android:background="@drawable/bg_input"
            android:padding="10dp"
            android:textColor="@android:color/white"
            android:textColorHint="#777777" />

        <com.google.android.material.button.MaterialButton
            android:id="@+id/sendButton"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="SEND"
            android:textAllCaps="true"
            android:layout_marginStart="8dp" />
    </LinearLayout>

</LinearLayout>
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

cat << 'XML' > app/src/main/res/drawable/bg_input.xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="#111118" />
    <corners android:radius="18dp" />
</shape>
XML

cat << 'XML' > app/src/main/res/values/strings.xml
<resources>
    <string name="app_name">VOIDAI GPT</string>
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

echo "[5/5] AndroidManifest + workflow rename to VOIDAI APK"
cd "$REPO_DIR"

cat << 'MANIFEST' > android-app/app/src/main/AndroidManifest.xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.voidai.app">

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="VOIDAI GPT"
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

if [ -f ".github/workflows/android-apk.yml" ]; then
  sed -i 's/VOID-AI Odysseus APK/VOIDAI APK/g' .github/workflows/android-apk.yml || true
  sed -i 's/void-ai-odysseus-debug-apk/voidai-debug-apk/g' .github/workflows/android-apk.yml || true
fi

git add android-app/app .github/workflows/android-apk.yml || git add android-app/app
git commit -m "VOIDAI GPT: crash-safe Grok-style UI with local stub"
git push

echo "Done. GitHub Actions will now build the updated VOIDAI APK."
