"""VOIDAI command line interface.

Examples:
    voidai                          # interactive session as the OS user
    voidai "explain quicksort"      # one-shot answer
    voidai --user alice --mode deep
    voidai --print-system           # show the PHB system prompt
"""

import argparse
import json
import sys

from . import chat, config, phb
from .llm import LLMClient, LLMError

from . import __version__


def _load_history(user, disabled=False):
    if disabled:
        return []
    try:
        with open(config.history_path(user), "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, list):
            return [
                {"role": item["role"], "content": str(item["content"])}
                for item in data
                if isinstance(item, dict)
                and item.get("role") in ("user", "assistant")
                and item.get("content")
            ][-2 * chat.MAX_HISTORY:]
    except (OSError, ValueError):
        pass
    return []


def _save_history(user, history, disabled=False):
    if disabled:
        return
    path = config.history_path(user)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(history[-2 * chat.MAX_HISTORY:], handle, indent=2)
    tmp.replace(path)


def _client(args):
    return LLMClient(
        api_key=args.api_key or None,
        base_url=args.base_url or None,
        model=args.model or None,
        max_retries=args.retries,
    )


def _emit(args, reply, user, mode, model):
    if args.json:
        print(json.dumps({"reply": reply, "user": user, "mode": mode, "model": model}))
    else:
        print(reply)


def _fail(args, message, code=2):
    if args.json:
        print(json.dumps({"error": message}))
    else:
        print("error: " + message, file=sys.stderr)
    return code


def _build_parser():
    parser = argparse.ArgumentParser(
        prog="voidai",
        description="VOIDAI CLI - GPT chat with the PHB human-agent basis.",
    )
    parser.add_argument("prompt", nargs="*", help="prompt for a one-shot answer")
    parser.add_argument("-u", "--user", help="user id (default: $VOIDAI_USER or OS user)")
    parser.add_argument("-m", "--mode", default="fast", choices=sorted(phb.MODES),
                        help="answer mode (default: fast)")
    parser.add_argument("--model", help="model name (default: $OPENAI_MODEL or gpt-4o-mini)")
    parser.add_argument("--base-url", help="OpenAI-compatible base URL")
    parser.add_argument("--api-key", help="API key (default: $OPENAI_API_KEY)")
    parser.add_argument("--retries", type=int, default=1, help="retries on 429/5xx (default: 1)")
    parser.add_argument("--no-memory", action="store_true", help="do not read or write history")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--print-system", action="store_true", help="print the PHB system prompt and exit")
    parser.add_argument("--version", action="version", version="voidai " + __version__)
    return parser


def _repl(args, user, mode, client):
    history = _load_history(user, args.no_memory)
    print("VOIDAI CLI - user=%s mode=%s model=%s" % (user, mode, client.model))
    print("Type @help for commands, @quit to exit.")
    while True:
        try:
            line = input("%s@%s> " % (user, mode))
        except EOFError:
            print()
            break
        except KeyboardInterrupt:
            print()
            continue

        text = line.strip()
        if not text:
            continue
        if text in ("@quit", "@exit"):
            break
        if text == "@clear":
            history.clear()
            _save_history(user, history, args.no_memory)
            print("history cleared")
            continue
        if text == "@history":
            if not history:
                print("no history")
            for item in history[-10:]:
                print("%s: %s" % (item["role"], item["content"]))
            continue
        if text.startswith("@mode "):
            wanted = text[len("@mode "):].strip()
            if wanted not in phb.MODES:
                print("modes: " + ", ".join(sorted(phb.MODES)))
            else:
                mode = wanted
                print("mode set to %s" % mode)
            continue
        if text.startswith("@user "):
            user = config.sanitize_user(text[len("@user "):].strip())
            history = _load_history(user, args.no_memory)
            print("now user=%s" % user)
            continue

        try:
            reply = chat.answer(session_id=user, user_text=text, user_id=user,
                                history=history, mode=mode, client=client)
        except LLMError as exc:
            print("error: %s" % exc, file=sys.stderr)
            continue
        except ValueError as exc:
            print("error: %s" % exc, file=sys.stderr)
            continue
        _save_history(user, history, args.no_memory)
        print(reply)
    return 0


def main(argv=None):
    parser = _build_parser()
    args = parser.parse_args(argv)
    user = config.sanitize_user(args.user) if args.user else config.default_user()

    if args.print_system:
        print(chat.system_prompt_for(user, args.mode))
        return 0

    client = _client(args)

    if args.prompt:
        prompt = " ".join(args.prompt).strip()
        history = _load_history(user, args.no_memory)
        try:
            reply = chat.answer(session_id=user, user_text=prompt, user_id=user,
                                history=history, mode=args.mode, client=client)
        except LLMError as exc:
            return _fail(args, str(exc), 3)
        except ValueError as exc:
            return _fail(args, str(exc), 2)
        _save_history(user, history, args.no_memory)
        _emit(args, reply, user, args.mode, client.model)
        return 0

    if not client.configured():
        print("warning: no API key set; local commands (@help, @state, @memory, @map) still work.",
              file=sys.stderr)
    try:
        return _repl(args, user, args.mode, client)
    except KeyboardInterrupt:
        print()
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
