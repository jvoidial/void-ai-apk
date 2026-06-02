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
