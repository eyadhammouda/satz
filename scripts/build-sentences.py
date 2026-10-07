#!/usr/bin/env python3
"""Builds the sentence course the app teaches from.

Source: Tatoeba (https://tatoeba.org), CC BY 2.0 FR. Each sentence keeps its
Tatoeba id and author for attribution. Word frequency comes from the hermitdave
German list (CC BY-SA 4.0), which is read here and not shipped.

Order: each sentence brings exactly one word the learner has not met yet, the
most common such word first (the "i+1" ordering). The first sentences, which have
no known words to build on, are the shortest and most common ones. Near-identical
sentences are kept apart.

Run:  python3 scripts/build-sentences.py [download-dir]
Writes public/sentences/NNN.json (CHUNK sentences each) and public/sentences/index.json.
Each sentence is [tatoeba id, german, english, author, new word, other accepted german answers?].
"""
import bz2, csv, heapq, io, json, re, sys, tarfile, unicodedata, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'sentences'
CACHE = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/tatoeba')
TOTAL = 20_000
CHUNK = 500
# The course version. Bump it whenever the order changes, and add a migration in src/lib/progress.ts.
VERSION = 2
# Version 1 positions kept for migrating saved progress. Far more than one day of lessons on version 1 could reach.
LEGACY_ROWS = 5000

FILES = {
    'deu_sentences_detailed.tsv.bz2': 'https://downloads.tatoeba.org/exports/per_language/deu/deu_sentences_detailed.tsv.bz2',
    'eng_sentences_detailed.tsv.bz2': 'https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences_detailed.tsv.bz2',
    'deu-eng_links.tsv.bz2': 'https://downloads.tatoeba.org/exports/per_language/deu/deu-eng_links.tsv.bz2',
    'user_languages.tar.bz2': 'https://downloads.tatoeba.org/exports/user_languages.tar.bz2',
    'de_50k.txt': 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_50k.txt',
}

# Tatoeba's recurring characters, and other names that make a sentence about someone else.
NAMES = set('''Tom Toms Maria Marias Mary Marys John Johns Jim Ken Mike Bill Jack Bob Alice Anna Ann Peter Paul
Jane Lucy Emily Mark Tim Jill Linda Meg Hans Klaus Thomas Michael Susan Sarah Kate Fred Dan Sam Ben Kevin Max
Lisa Jenny Steve Tony George Helen Nancy Laura Sally Henry Jacob Taro Hanako Ken'''.split())
DARK = re.compile(r'\b(töte|tötet|getötet|umbringen|umgebracht|Mord|ermordet|Selbstmord|vergewaltig\w*|Leiche|Waffe|'
                  r'erschießen|erschossen|Krieg|Bombe|Drogen|betrunken|Hure|Scheiße|Arsch\w*|verdammt|ficken|fick\w*|'
                  r'hässlich|dumm|Idiot|Nazi\w*|Hitler|Sex\w*|nackt|Blut|sterben|starb|gestorben|tot)\b', re.I)
# Common mistakes in volunteer sentences: "dass" where "das" belongs, "seid" for "seit", and similar.
MISTAKES = re.compile(r'\b[Dd]ass (ist|war|sind|wird|kann|hat|habe|muss|soll|geht|stimmt|macht)\b|'
                      r'\b[Ss]eit (ihr|nett|froh|bereit|still|ruhig)\b|\bwiederspr|\bstandart\b|\bwiedersehen\b(?<!Auf )', re.I)
SHAPE = re.compile(r'^[A-ZÄÖÜ][^0-9"„“”«»()\[\]:;…/&%$€@#*_<>=+]*[^\s.!?][.!?]$')
ARCHAIC = re.compile(r'\b(morrow|thee|thou|thy|thine|whilst|devoid|ere|hath|shan\'t|mum)\b', re.I)
WORD = re.compile(r"[A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*")
# Words rarer than this are never taught.
MAX_RANK = 20_000
# The opening sentences may use only words this common, and all of them count as new.
OPENING_RANK = 60
OPENING = 12


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


def native_users(language):
    with tarfile.open(CACHE / 'user_languages.tar.bz2') as tar:
        member = next(m for m in tar.getmembers() if m.name.endswith('.csv'))
        text = io.TextIOWrapper(tar.extractfile(member), encoding='utf-8')
        return {row[2] for row in csv.reader(text, delimiter='\t', quoting=csv.QUOTE_NONE)
                if len(row) > 2 and row[0] == language and row[1] == '5'}


def frequency_ranks():
    ranks = {}
    for i, line in enumerate((CACHE / 'de_50k.txt').read_text(encoding='utf-8').splitlines()):
        ranks.setdefault(line.split(' ')[0], i + 1)
    return ranks


def clean(text):
    text = unicodedata.normalize('NFC', text).strip()
    text = text.replace('’', "'").replace('‘', "'")
    return re.sub(r'\s+', ' ', text)


def words_of(german):
    return [w.lower() for w in WORD.findall(german)]


def candidates():
    """Every usable German sentence with its best English translation."""
    german_natives = native_users('deu')
    english_natives = native_users('eng')
    ranks = frequency_ranks()

    german = {}
    for row in tsv('deu_sentences_detailed.tsv.bz2'):
        if len(row) >= 4:
            german[row[0]] = (clean(row[2]), row[3])
    links, back = {}, {}
    for de, en in tsv('deu-eng_links.tsv.bz2'):
        links.setdefault(de, []).append(en)
        back.setdefault(en, []).append(de)
    wanted = {en for ens in links.values() for en in ens}
    english = {row[0]: (clean(row[2]), row[3]) for row in tsv('eng_sentences_detailed.tsv.bz2')
               if len(row) > 3 and row[0] in wanted}

    pool, seen = [], set()
    for sid, (de, owner) in german.items():
        if owner not in german_natives or not SHAPE.match(de) or MISTAKES.search(de):
            continue
        translations = [(english[e][0], e, english[e][1]) for e in links.get(sid, []) if e in english]
        translations = [t for t in translations if re.match(r'^[A-Z].*[.!?]$', t[0]) and '"' not in t[0] and len(t[0]) <= 80]
        if not translations:
            continue
        # Prefer plain modern English by a native speaker, then the shortest.
        en, en_id, _ = min(translations, key=lambda t: (bool(ARCHAIC.search(t[0])), t[2] not in english_natives, len(t[0])))
        tokens = WORD.findall(de)
        if not 3 <= len(tokens) <= 10 or len(de) > 70:
            continue
        if any(w in NAMES for w in tokens) or any(w in NAMES for w in WORD.findall(en)) or DARK.search(de):
            continue
        words = words_of(de)
        if any(ranks.get(w, 10**6) > MAX_RANK for w in words):
            continue
        key = re.sub(r'[^a-zäöüß ]', '', de.lower())
        if key in seen:
            continue
        seen.add(key)
        others = sorted({german[d][0] for d in back.get(en_id, []) if d != sid and d in german} - {de}, key=len)
        others = [o for o in others if SHAPE.match(o) and len(o) <= 80][:6]
        pool.append({'id': int(sid), 'de': de, 'en': en, 'owner': owner, 'words': set(words), 'others': others})
    return pool, ranks


def skeleton(sentence):
    """The sentence with its new word blanked out, to spot near-identical neighbours."""
    return ' '.join(w if w != sentence['new'] else '_' for w in words_of(sentence['de']))


def order(pool, ranks):
    """Greedy i+1 ordering: always teach the most common word that can be taught with only one unknown."""
    rank = lambda w: ranks.get(w, 10**6)
    unknown = [set(s['words']) for s in pool]
    by_word = {}
    for i, s in enumerate(pool):
        for w in s['words']:
            by_word.setdefault(w, []).append(i)
    known, used, course = set(), [False] * len(pool), []

    def learn(i, new):
        used[i] = True
        pool[i]['new'] = new
        course.append(pool[i])
        for w in list(unknown[i]):
            known.add(w)
            for j in by_word[w]:
                if not used[j] and w in unknown[j]:
                    unknown[j].discard(w)
                    if len(unknown[j]) == 1:
                        push(j)
        unknown[i] = set()

    heap = []

    def push(j):
        (w,) = unknown[j]
        # Most common new word first, then shorter sentences, then those using more known words.
        heapq.heappush(heap, (rank(w), len(pool[j]['words']), j))

    # Opening: short sentences made only of the very commonest words.
    opening = sorted((i for i, s in enumerate(pool) if len(s['words']) == 3 and all(rank(w) <= OPENING_RANK for w in s['words'])),
                     key=lambda i: sum(rank(w) for w in pool[i]['words']))
    for i in opening:
        if len(course) >= OPENING:
            break
        if used[i] or len(unknown[i]) == 0:
            continue
        new = max(unknown[i], key=rank)
        learn(i, new)
    for j, u in enumerate(unknown):
        if not used[j] and len(u) == 1:
            push(j)

    # Each word is introduced once. Further sentences that only reuse known words are added later as practice.
    recent = []
    while len(course) < TOTAL and heap:
        _, _, j = heapq.heappop(heap)
        if used[j] or len(unknown[j]) != 1:
            continue
        (new,) = unknown[j]
        if new in known:
            continue
        candidate = dict(pool[j], new=new)
        # Keep near-identical sentences apart: skip one whose shape matches a recent sentence.
        shape = skeleton(candidate)
        if shape in recent:
            continue
        learn(j, new)
        recent = (recent + [shape])[-20:]
    return course


def legacy_v1(course):
    """Maps the first course (version 1, ordered by difficulty) onto this one, so saved progress carries over.

    Reads the version 1 chunks from LEGACY_DIR (git show <commit>:public/sentences/NNN.json) when present.
    Writes public/sentences/legacy-v1.json: one row per version 1 position,
    [new position or -1, tatoeba id, german, english, alternatives?].
    """
    old_dir = Path(__import__('os').environ.get('LEGACY_DIR', '/tmp/satz-v1'))
    old_files = sorted(old_dir.glob('[0-9]*.json'))
    if not old_files:
        print('no version 1 chunks found, keeping the existing legacy-v1.json')
        return
    position = {s['id']: i for i, s in enumerate(course)}
    rows = [r for f in old_files for r in json.loads(f.read_text(encoding='utf-8'))][:LEGACY_ROWS]
    out = [[position.get(r[0], -1), r[0], r[1], r[2], *([r[4]] if len(r) > 4 and r[4] else [])] for r in rows]
    (OUT / 'legacy-v1.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'legacy-v1: {len(out)} rows, {sum(r[0] >= 0 for r in out)} found in this course')


def main():
    fetch()
    pool, ranks = candidates()
    print(f'{len(pool)} usable sentences')
    course = order(pool, ranks)
    words = len({s['new'] for s in course})
    print(f'course: {len(course)} sentences, {words} words taught')

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('[0-9]*.json'):
        old.unlink()
    for start in range(0, len(course), CHUNK):
        part = [[s['id'], s['de'], s['en'], s['owner'], s['new'], *([s['others']] if s['others'] else [])]
                for s in course[start:start + CHUNK]]
        (OUT / f'{start // CHUNK:03d}.json').write_text(
            json.dumps(part, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    legacy_v1(course)
    (OUT / 'index.json').write_text(json.dumps({
        'version': VERSION, 'total': len(course), 'chunk': CHUNK,
        'source': 'Tatoeba (tatoeba.org), CC BY 2.0 FR',
    }, separators=(',', ':')), encoding='utf-8')


if __name__ == '__main__':
    main()
