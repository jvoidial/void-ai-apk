#!/data/data/com.termux/files/usr/bin/bash
set -e

APP_REPO_URL="https://github.com/jvoidial/void-ai-apk.git"
APP_REPO_DIR="$HOME/void-ai-apk"

GODCODE_REPO_URL="https://github.com/jvoidial/phb-godcode-vortex.git"
GODCODE_REPO_DIR="$HOME/phb-godcode-vortex"

BACKEND_DIR="$HOME/voidai-backend"

echo "[1/6] Install Python + FastAPI (Termux-safe)"
pkg update -y
pkg install -y python git

# Termux-safe pip install
pip install fastapi uvicorn pydantic

echo "[2/6] Clone/update godcode repo"
if [ -d "$GODCODE_REPO_DIR/.git" ]; then
  cd "$GODCODE_REPO_DIR"
  git pull --rebase
else
  cd "$HOME"
  git clone "$GODCODE_REPO_URL"
fi

echo "[3/6] Create backend folder"
mkdir -p "$BACKEND_DIR"
cd "$BACKEND_DIR"

echo "[4/6] Write FastAPI server"
cat << 'PY' > server.py
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List

# Try to import your godcode engine
try:
    from phb_godcode_vortex.engine import generate_reply
except:
    generate_reply = None

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]

app = FastAPI(title="VOIDAI Godcode LLM")

@app.post("/chat")
def chat(req: ChatRequest):
    if generate_reply:
        return {"reply": generate_reply(req.messages)}

    # fallback stub
    last = next((m.content for m in reversed(req.messages) if m.role == "user"), "")
    return {
        "reply": f"VOIDAI Godcode stub:\nBackend reachable.\nUser said:\n{last}"
    }
PY

echo "[4b/6] Write backend runner"
cat << 'SH' > run_backend.sh
#!/data/data/com.termux/files/usr/bin/bash
cd "$HOME/voidai-backend"
uvicorn server:app --host 0.0.0.0 --port 11435
SH
chmod +x run_backend.sh

echo "[5/6] Clone/update Android app repo"
if [ -d "$APP_REPO_DIR/.git" ]; then
  cd "$APP_REPO_DIR"
  git pull --rebase
else
  cd "$HOME"
  git clone "$APP_REPO_URL"
  cd "$APP_REPO_DIR"
fi

cd android-app

echo "[5b/6] Patch MainActivity to use backend http://127.0.0.1:11435/chat"
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
    val role: String,
    val content: String,
    val isUser: Boolean
)

class MainActivity : AppCompatActivity() {

    companion object {
        private const val BASE_URL = "http://127.0.0.1:11435/chat"
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

        messages.add(
            Message(
                role = "system",
                content = "You are VOIDAI GPT, Jacob's technical, code-aware assistant.",
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
        messages.add(Message("user", text, true))
        adapter.notifyItemInserted(messages.size - 1)
        messagesRecycler.scrollToPosition(messages.size - 1)
    }

    private fun addAssistantMessage(text: String) {
        messages.add(Message("assistant", text, false))
        adapter.notifyItemInserted(messages.size - 1)
        messagesRecycler.scrollToPosition(messages.size - 1)
    }

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

        val request = Request.Builder()
            .url(BASE_URL)
            .post(body)
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread {
                    addAssistantMessage("VOIDAI backend error: ${e.message}")
                }
            }

            override fun onResponse(call: Call, response: Response) {
                val raw = response.body?.string().orEmpty()
                val replyText = try {
                    JSONObject(raw).optString("reply", raw)
                } catch (e: Exception) {
                    raw
                }

                runOnUiThread {
                    addAssistantMessage(replyText)
                }
            }
        })
    }
}
KOTLIN

echo "[6/6] Commit + push Android changes"
cd "$APP_REPO_DIR"
git add android-app/app
git commit -m "VOIDAI GPT wired to Termux Godcode backend"
git push

echo
echo "======================================="
echo "Backend installed!"
echo "Start it with:"
echo "   cd ~/voidai-backend"
echo "   ./run_backend.sh"
echo
echo "Then install the new APK from GitHub Actions."
echo "======================================="
