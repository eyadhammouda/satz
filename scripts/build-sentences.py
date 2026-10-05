#!/usr/bin/env python3
"""Builds the sentence list the app teaches from.

Source: Tatoeba (https://tatoeba.org), CC BY 2.0 FR. Each sentence keeps its
Tatoeba id and author for attribution. Difficulty uses the hermitdave German
frequency list (CC BY-SA 4.0), which is read here and not shipped.

Run:  python3 scripts/build-sentences.py [download-dir]
Writes public/sentences/NNN.json (CHUNK sentences each) and public/sentences/index.json.
Each sentence is [tatoeba id, german, english, author, other accepted german answers?].
"""
import bz2, csv, io, json, random, re, sys, tarfile, unicodedata, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'sentences'
CACHE = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/tatoeba')
TOTAL = 20_000
CHUNK = 500

FILES = {
    'deu_sentences_detailed.tsv.bz2': 'https://downloads.tatoeba.org/exports/per_language/deu/deu_sentences_detailed.tsv.bz2',
    'eng_sentences.tsv.bz2': 'https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2',
    'deu-eng_links.tsv.bz2': 'https://downloads.tatoeba.org/exports/per_language/deu/deu-eng_links.tsv.bz2',
    'user_languages.tar.bz2': 'https://downloads.tatoeba.org/exports/user_languages.tar.bz2',
    'de_50k.txt': 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_50k.txt',
}

# Tatoeba's recurring characters, and other names that make a sentence about someone else.
NAMES = set('''Tom Toms Maria Marias Mary Marys John Johns Jim Ken Mike Bill Jack Bob Alice Anna Ann Peter Paul
Jane Lucy Emily Mark Tim Jill Linda Meg Hans Klaus Thomas Michael Susan Sarah Kate Fred Dan Sam Ben Kevin Max
Lisa Jenny Steve Tony George Helen Nancy Laura Sally Bob Henry Jacob Taro Hanako Ken'''.split())
DARK = re.compile(r'\b(töte|tötet|getötet|umbringen|umgebracht|Mord|ermordet|Selbstmord|vergewaltig\w*|Leiche|Waffe|'
                  r'erschießen|erschossen|Krieg|Bombe|Drogen|betrunken|Hure|Scheiße|Arsch\w*|verdammt|ficken|fick\w*|'
                  r'hässlich|dumm|Idiot|Nazi\w*|Hitler|Sex\w*|nackt|Blut|sterben|starb|gestorben|tot)\b', re.I)
SHAPE = re.compile(r'^[A-ZÄÖÜ][^0-9"„“”«»()\[\]:;…/&%$€@#*_<>=+]*[^\s.!?][.!?]$')
WORD = re.compile(r"[A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*")


def fetch():
    CACHE.mkdir(parents=True, exist_ok=True)
    for name, url in FILES.items():
        path = CACHE / name
        if not path.exists():
            print('downloading', url)
            urllib.request.urlretrieve(url, path)


def tsv(name):
    with bz2.open(CACHE / name, 'rt', encoding='utf-8', newline='') as f:
        yield from csv.reader(f, delimiter='\t', quoting=csv.QUOTE_NONE)


def native_german_users():
    with tarfile.open(CACHE / 'user_languages.tar.bz2') as tar:
        member = next(m for m in tar.getmembers() if m.name.endswith('.csv'))
        text = io.TextIOWrapper(tar.extractfile(member), encoding='utf-8')
        return {row[2] for row in csv.reader(text, delimiter='\t', quoting=csv.QUOTE_NONE)
                if len(row) > 2 and row[0] == 'deu' and row[1] == '5'}


def frequency_ranks():
    ranks = {}
    for i, line in enumerate((CACHE / 'de_50k.txt').read_text(encoding='utf-8').splitlines()):
        word = line.split(' ')[0]
        ranks.setdefault(word, i + 1)
    return ranks


def clean(text):
    text = unicodedata.normalize('NFC', text).strip()
    text = text.replace('’', "'").replace('‘', "'")
    return re.sub(r'\s+', ' ', text)


def main():
    fetch()
    natives = native_german_users()
    ranks = frequency_ranks()

    german = {}
    for row in tsv('deu_sentences_detailed.tsv.bz2'):
        if len(row) < 4:
            continue
        german[row[0]] = (clean(row[2]), row[3])
    links = {}
    back = {}
    for de, en in tsv('deu-eng_links.tsv.bz2'):
        links.setdefault(de, []).append(en)
        back.setdefault(en, []).append(de)
    wanted = {en for ens in links.values() for en in ens}
    english = {row[0]: clean(row[2]) for row in tsv('eng_sentences.tsv.bz2') if len(row) > 2 and row[0] in wanted}

    candidates = []
    seen = set()
    for sid, (de, owner) in german.items():
        if owner not in natives:
            continue
        translations = [(english[e], e) for e in links.get(sid, []) if e in english]
        if not translations:
            continue
        en, en_id = min(translations, key=lambda t: len(t[0]))
        if not SHAPE.match(de) or not re.match(r'^[A-Z].*[.!?]$', en) or '"' in en:
            continue
        words = WORD.findall(de)
        if not 3 <= len(words) <= 10 or len(de) > 70 or len(en) > 80:
            continue
        if any(w in NAMES for w in words) or any(w in NAMES for w in WORD.findall(en)) or DARK.search(de):
            continue
        key = re.sub(r'[^a-zäöüß ]', '', de.lower())
        if key in seen:
            continue
        word_ranks = sorted(ranks.get(w.lower(), 10**6) for w in words)
        if word_ranks[-1] > 20_000:
            continue
        seen.add(key)
        # The second-rarest word sets the level, so one new word per sentence is allowed,
        # and the rarest word counts a little, so common words come first.
        level = (word_ranks[-2] if len(word_ranks) > 1 else 0) + word_ranks[-1] // 4
        # Other German sentences for the same English one are also right answers ("I need you": dich, euch, Sie).
        others = sorted({german[d][0] for d in back.get(en_id, []) if d != sid and d in german} - {de}, key=len)
        others = [o for o in others if SHAPE.match(o) and len(o) <= 80][:6]
        candidates.append((level + 60 * len(words), int(sid), de, en, owner, others))

    candidates.sort()
    chosen = candidates[:TOTAL]
    # Spread near-identical sentences apart: shuffle within small bands of similar difficulty.
    rng = random.Random(7)
    BAND = 60
    for start in range(0, len(chosen), BAND):
        band = chosen[start:start + BAND]
        rng.shuffle(band)
        chosen[start:start + BAND] = band
    print(f'{len(candidates)} usable pairs, keeping {len(chosen)}')

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*.json'):
        old.unlink()
    for start in range(0, len(chosen), CHUNK):
        part = [[sid, de, en, owner, *([others] if others else [])]
                for _, sid, de, en, owner, others in chosen[start:start + CHUNK]]
        (OUT / f'{start // CHUNK:03d}.json').write_text(
            json.dumps(part, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    (OUT / 'index.json').write_text(json.dumps({
        'version': 1, 'total': len(chosen), 'chunk': CHUNK,
        'source': 'Tatoeba (tatoeba.org), CC BY 2.0 FR',
    }, separators=(',', ':')), encoding='utf-8')


if __name__ == '__main__':
    main()
