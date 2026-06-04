from textwrap import dedent

def think_steps(question: str):
    steps = [
        "1) Understand the question.",
        "2) Recall relevant knowledge and patterns.",
        "3) Propose a rough answer.",
        "4) Check for mistakes or gaps.",
        "5) Refine the answer."
    ]
    return dedent(f\"\"\"\
Human-style reasoning about: {question}

Thinking steps:
{chr(10).join(steps)}
\"\"\")

def self_reflect(last_answer: str):
    return dedent(f\"\"\"\
Reflection on previous answer:

- Did it address the question directly?
- Was any important detail missing?
- Could it be clearer or more structured?

Previous answer (for review):
{last_answer}
\"\"\")
