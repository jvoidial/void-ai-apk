#!/data/data/com.termux/files/usr/bin/bash
set -e

# Paths
APP_REPO_URL="https://github.com/jvoidial/void-ai-apk.git"
APP_REPO_DIR="$HOME/void-ai-apk"
GODCODE_REPO_URL="https://github.com/jvoidial/phb-godcode-vortex.git"
GODCODE_REPO_DIR="$HOME/phb-godcode-vortex"
BACKEND_DIR="$HOME/voidai-backend"

echo "[1/6] Install Python + FastAPI backend deps"
pkg update -y
pkg install -y python git
pip install --upgrade pip
pip install fastapi uvicorn

echo "[2/6] Clone/update godcode repo"
if [ -d "$GODCODE_REPO_DIR/.git" ]; then
  cd "$GODCODE_REPO_DIR"
  git pull --rebase
else
  cd "$HOME"
  git clone "$GODCODE_REPO_URL"
fi

echo "[3/6] Create VOIDAI backend server (FastAPI on :11435)"
mkdir -p "$BACKEND_DIR"
cd "$BACKEND_DIR"

cat << 'PY' > server.py
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List

# Import your godcode engine here.
# You implement generate_reply(messages) inside phb_godcode_vortex.
try:
    from phb_godcode_vortex.engine import generate_reply  # you create this
except ImportError:
    generate_reply = None

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]

app = FastAPI(title="VOIDAI Godcode LLM")

@app.post("/chat")
def chat(req: ChatRequest):
    # If your engine is wired, use it
    if generate_reply is not None:
        return {"reply": generate_reply(req.messages)}

    # Fallback: echo stub so nothing breaks
    last_user = ""
    for m in reversed(req.messages):
        if m.role == "user":
            last_user = m.content
            break

    reply = (
        "VOIDAI Godcode (stub):\n"
        "Backend is reachable, but generate_reply() is not implemented yet.\n\n"
        f"Last user message:\n{last_user}"
    )
    return {"reply": reply}
PY

cat << 'SH' > run_voidai_backend.sh
#!/data/data/com.termux/files/usr/bin/bash
cd "$HOME/voidai-backend"
uvicorn server:app --host 0.0.0.0 --port 11435
SH
chmod +x run_voidai_backend.sh

echo "[4/6] Clone/update Android app repo"
if [ -d "$APP_REPO_DIR/.git" ]; then
  cd "$APP_REPO_DIR"
  git pull --rebase
else
  cd "$HOME"
  git clone "$APP_REPO_URL"
  cd "$APP_REPO_DIR"
fi

cd android-app

echo "[5/6] Wire MainActivity to local Termux backend http://127.0.0.1:11435/chat"
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
                    val obj = JSONObject(raw)
                    obj.optString("reply", raw)
                } catch (e: Exception) {
                    raw
                }

                runOnUiThread {
                    addAssistantMessage(
                        replyText.ifEmpty {
                            "VOIDAI backend returned empty response."
                        }
                    )
                }
            }
        })
    }
}
KOTLIN

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

echo "[6/6] Commit + push Android changes"
cd "$APP_REPO_DIR"
git add android-app/app
git commit -m "Wire VOIDAI GPT Android client to local Godcode backend"
git push

echo
echo "======================================="
echo "Backend:"
echo "  cd $HOME"
echo "  ./voidai-backend/run_voidai_backend.sh"
echo
echo "App:"
echo "  GitHub Actions will build new APK (voidai-debug-apk)."
echo "  Install it, then chat with VOIDAI GPT (now hitting /chat)."
echo "======================================="
