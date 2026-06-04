window.VOIDAI_RESPONSIVE = {
    state: {
        mode: "chat",
        thinking: false,
        lastCommand: null
    },

    setMode: function(mode) {
        this.state.mode = mode;
        this.renderStatus("Mode: " + mode);
    },

    startThinking: function() {
        this.state.thinking = true;
        this.renderStatus("Thinking...");
    },

    stopThinking: function() {
        this.state.thinking = false;
        this.renderStatus("");
    },

    detectCommand: function(text) {
        if (text.startsWith("@")) {
            var cmd = text.split(" ")[0];
            this.state.lastCommand = cmd;
            this.renderStatus("Command: " + cmd);
        }
    },

    renderStatus: function(msg) {
        var el = document.getElementById("voidai-status");
        if (el) el.innerText = msg;
    }
};
