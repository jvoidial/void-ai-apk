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
