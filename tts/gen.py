# Lektor AI dla matoorqa: nagrywa streszczenia lektur darmowym, otwartym głosem neuronowym (Piper)
# i zapisuje czasy zdań, żeby apka mogła podświetlać czytane zdanie. Uruchamiane przez GitHub Actions (tts.yml).
#   python tts/gen.py <katalog_z_glosami> [limit_minut]
import json, os, sys, wave, subprocess, tempfile, time
from piper import PiperVoice, SynthesisConfig

ROOT = os.path.dirname(os.path.abspath(__file__))
VOICES = {'gosia': 'pl_PL-gosia-medium', 'darek': 'pl_PL-darkman-medium'}
GAP, HGAP = 0.32, 0.65          # cisza po zdaniu i po nagłówku (sekundy)
BATCH = 8                       # co tyle nagrań zapis do repozytorium, żeby nic nie przepadło
vdir = sys.argv[1]
limit = time.time() + 60 * float(sys.argv[2] if len(sys.argv) > 2 else 320)
man = json.load(open(os.path.join(ROOT, 'manifest.json'), encoding='utf8'))


def git_push(msg):
    subprocess.run(['git', 'add', 'tts'], check=False)
    if subprocess.run(['git', 'diff', '--cached', '--quiet']).returncode == 0:
        return
    subprocess.run(['git', 'commit', '-q', '-m', msg], check=False)
    for _ in range(4):
        subprocess.run(['git', 'pull', '--rebase', '-q'], check=False)
        if subprocess.run(['git', 'push', '-q']).returncode == 0:
            break
        time.sleep(5)
    subprocess.run(['gh', 'api', '-X', 'POST', 'repos/' + os.environ.get('GITHUB_REPOSITORY', '') + '/pages/builds'],
                   check=False, capture_output=True)


def write_index(od, key):
    have = sorted(f[:-4] for f in os.listdir(od) if f.endswith('.m4a') and os.path.exists(os.path.join(od, f[:-4] + '.json')))
    json.dump({'v': 1, 'b': have}, open(os.path.join(od, 'index.json'), 'w'), separators=(',', ':'))


for key, model in VOICES.items():
    mp = os.path.join(vdir, model + '.onnx')
    if not os.path.exists(mp):
        print('brak głosu', model)
        continue
    voice = PiperVoice.load(mp)
    sr = voice.config.sample_rate
    cfg = SynthesisConfig(length_scale=1.06, noise_scale=0.6, noise_w_scale=0.75)
    od = os.path.join(ROOT, key)
    os.makedirs(od, exist_ok=True)
    want, done = set(), 0
    for it in man['items']:
        base = f"{it['k']}-{it['m']}-{it['h']}"
        want.add(base)
        if os.path.exists(os.path.join(od, base + '.m4a')) and os.path.exists(os.path.join(od, base + '.json')):
            continue
        if time.time() > limit:
            print('koniec czasu, reszta w następnym przebiegu')
            break
        t0 = time.time()
        pcm, starts, hd = bytearray(), [], set(it.get('hd', []))
        for i, s in enumerate(it['s']):
            starts.append(round(len(pcm) / 2 / sr, 3))
            for ch in voice.synthesize(s, syn_config=cfg):
                pcm += ch.audio_int16_bytes
            pcm += b'\x00\x00' * int(sr * (HGAP if i in hd else GAP))
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tf:
            wav_path = tf.name
        with wave.open(wav_path, 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(bytes(pcm))
        out = os.path.join(od, base + '.m4a')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav_path, '-ac', '1', '-c:a', 'aac', '-b:a', '40k',
                        '-movflags', '+faststart', out], check=True)
        os.remove(wav_path)
        dur = round(len(pcm) / 2 / sr, 2)
        json.dump({'v': 1, 'd': dur, 't': starts}, open(os.path.join(od, base + '.json'), 'w'), separators=(',', ':'))
        done += 1
        print(f'{key} {base}: {dur/60:.1f} min nagrania w {time.time()-t0:.0f} s', flush=True)
        if done % BATCH == 0:
            write_index(od, key)
            git_push(f'Lektor AI ({key}): kolejne nagrania')
    # stare nagrania (po zmianie streszczenia) usuwam
    for f in os.listdir(od):
        b = f.rsplit('.', 1)[0]
        if f != 'index.json' and b not in want:
            os.remove(os.path.join(od, f))
    write_index(od, key)
    git_push(f'Lektor AI ({key}): nagrania')
print('gotowe')
