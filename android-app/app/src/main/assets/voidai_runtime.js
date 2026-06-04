window.VOIDAI = {
  energy: 1.0,
  state: { turns: 0 },
  process(input) {
    this.state.turns += 1;
    return window.VOIDAI_CORTEX.reason(input, this.state);
  }
};


// Copilot-style responsiveness wrapper
async function sendMessageResponsive() {
    var input = document.getElementById("message").value;

    VOIDAI_RESPONSIVE.detectCommand(input);
    VOIDAI_RESPONSIVE.startThinking();

    var reply = await VOIDAI.process(input);

    VOIDAI_RESPONSIVE.stopThinking();
    appendMessage("VOIDAI", reply);
}
