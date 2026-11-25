# VOIDAI local Whisper STT

Small speech-to-text service for the optional Whisper listening mode in VOIDAI.

## Run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r local-media/requirements-stt.txt

# ffmpeg is required for browser WebM/M4A audio
sudo apt install ffmpeg        # Debian/Ubuntu
# brew install ffmpeg          # macOS

python local-media/stt_server.py
```

The service listens on `0.0.0.0:8002`.

```bash
curl --data-binary @sample.wav \
  -H 'Content-Type: audio/wav' \
  http://localhost:8002/listen
```

Response:

```json
{"text":"hello from voidai","language":"en","model":"tiny"}
```

## Connect VOIDAI

1. Open **TOOLS → AI VOICE**.
2. Set the Whisper URL to the phone-reachable address, for example:
   `http://192.168.1.10:8002/listen`
3. Save. The VOICE / LISTEN button now records a clip and uploads it to Whisper.

The phone must be on the same LAN. Use the computer's LAN IP, not `localhost`.

For a remote phone, expose the service over HTTPS instead:

```bash
cloudflared tunnel --url http://localhost:8002
```

Then paste `https://<tunnel-host>/listen` into the app. HTTPS avoids Android/iOS
cleartext restrictions and keeps audio encrypted in transit.

## Optional token

Set `VOIDAI_STT_TOKEN` on the server and send `X-VOIDAI-TOKEN` from a trusted
client. The VOIDAI settings panel does not currently store a token, so leave it
unset for the built-in app flow.

## Docker

```bash
docker build -f local-media/Dockerfile.stt -t voidai-stt local-media
docker run --rm -p 8002:8002 voidai-stt
```

## Notes

- `VOIDAI_WHISPER_MODEL=tiny` by default. `base` or `small` improves accuracy.
- `VOIDAI_WHISPER_DEVICE=cpu` by default. Use `cuda` if PyTorch has GPU support.
- First request downloads/loads the model and is slower.
- Audio is written to a temporary file, transcribed, and deleted immediately.
