"""Tarçın için çevrimdışı Pocket TTS işçisi. Standart çıktıda yalnız JSON satırları vardır."""

import contextlib
import json
import os
from pathlib import Path
import subprocess
import sys
import wave


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "data" / "pocket-tts"
VOICES = ("female_2", "male_2")
PREVIEWS = (
    ("female_2", "sakin", "Bir ipucu vereyim mi? Bu şehrin plakası otuz dört."),
    ("male_2", "mutlu", "Bildin! Hadi, sıradaki soruya geçelim."),
)


def load_model():
    from pocket_tts_turkish import TurkishTTS
    return TurkishTTS.from_pretrained(device="cpu")


def synthesize(model, text, voice, emotion, filename):
    import numpy as np
    if voice not in VOICES:
        raise ValueError("Geçersiz Pocket sesi")
    audio = np.asarray(model.generate(text, voice=voice, emotion=emotion), dtype=np.float32).reshape(-1)
    if not audio.size or not np.isfinite(audio).all() or np.max(np.abs(audio)) < 0.0001:
        raise ValueError("Model boş veya sessiz ses üretti")
    pcm = np.rint(np.clip(audio, -1, 1) * 32767).astype("<i2")
    with wave.open(str(filename), "wb") as wav:
        wav.setparams((1, 2, int(model.sample_rate), 0, "NONE", "not compressed"))
        wav.writeframes(pcm.tobytes())


def setup():
    import venv
    python = RUNTIME / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    RUNTIME.mkdir(parents=True, exist_ok=True)
    if not python.is_file():
        print("Pocket için Python ortamı hazırlanıyor…", flush=True)
        venv.create(str(RUNTIME / "venv"), with_pip=True)
    env = dict(os.environ, HF_HOME=str(RUNTIME / "hf"), PYTHONUTF8="1", HF_HUB_DISABLE_TELEMETRY="1")
    subprocess.run([str(python), "-m", "pip", "install", "--disable-pip-version-check", "pocket-tts-turkish==0.1.0"], check=True, env=env)
    print("Türkçe model ve iki ses indiriliyor…", flush=True)
    subprocess.run([str(python), __file__, "--samples"], check=True, env=dict(env, HF_HUB_OFFLINE="0"))
    print("Model çevrimdışı deneniyor…", flush=True)
    subprocess.run([str(python), __file__, "--samples"], check=True, env=dict(env, HF_HUB_OFFLINE="1"))
    (RUNTIME / "ready-v1").touch()
    print("Pocket hazır. Tarçın'ın varsayılan sesi: female_2.", flush=True)


def samples():
    model = load_model()
    for voice, emotion, text in PREVIEWS:
        synthesize(model, text, voice, emotion, RUNTIME / (voice + ".wav"))


def report(data):
    print(json.dumps(data, ensure_ascii=True), flush=True)


def serve():
    try:
        with contextlib.redirect_stdout(sys.stderr):
            model = load_model()
    except Exception as error:
        report({"ready": False, "err": str(error)})
        return 1
    report({"ready": True, "voice": "Pocket TTS Turkish"})
    for line in sys.stdin:
        job = {}
        try:
            job = json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                synthesize(model, job["text"], job["voice"], job["emotion"], job["file"])
            report({"id": job["id"], "ok": True})
        except Exception as error:
            report({"id": job.get("id"), "ok": False, "err": str(error)})
    return 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--install"]:
        try:
            setup()
        except subprocess.CalledProcessError as error:
            sys.exit(error.returncode)
    elif sys.argv[1:] == ["--samples"]:
        samples()
    else:
        sys.exit(serve())
