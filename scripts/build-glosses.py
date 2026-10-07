#!/usr/bin/env python3
"""Adds a short dictionary note for each course sentence's new word.

Source: English Wiktionary via kaikki.org (https://kaikki.org), CC BY-SA 4.0 and GFDL.
Only the short notes are kept, in public/sentences/glosses.json:
  { "<new word>": ["<base form with article>", "<what this form is>", "<meaning>"] }
for example "witze": ["der Witz", "plural", "joke"].

Run after scripts/build-sentences.py:  python3 scripts/build-glosses.py [download-dir]
"""
import gzip, json, re, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'sentences'
CACHE = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/tatoeba')
SOURCE = 'https://kaikki.org/dictionary/German/kaikki.org-dictionary-German.jsonl.gz'
FILE = CACHE / 'kaikki-de.jsonl.gz'

ARTICLE = {'m': 'der', 'f': 'die', 'n': 'das'}
# Parts of speech worth a note. Proper names and abbreviations are skipped.
POS = {'noun', 'verb', 'adj', 'adv', 'pron', 'det', 'prep', 'conj', 'num', 'intj', 'particle', 'article'}
# How a form relates to its dictionary word, checked in order.
FORM_TAGS = [
    ({'participle', 'past'}, 'past participle'),
    ({'imperative'}, 'command'),
    ({'subjunctive-ii'}, 'subjunctive'),
    ({'preterite'}, 'past tense'),
    ({'comparative'}, 'comparative'),
    ({'superlative'}, 'superlative'),
    ({'noun', 'plural'}, 'plural'),
    ({'present'}, 'present'),
]
# Senses that describe grammar rather than meaning.
GRAMMAR = re.compile(r'^(forms? the|used (to|as|with|in|for)|refers to|indicates|auxiliary|expresses|introduces|'
                     r'denotes|serves|a (grammatical|modal)|placed|with the)', re.I)
# The commonest words, where Wiktionary's first sense is a grammar note or an unusual use.
COMMON = {
    'sein': 'to be', 'haben': 'to have', 'werden': 'to become; will', 'ja': 'yes', 'es': 'it', 'das': 'the; that',
    'der': 'the', 'die': 'the', 'ein': 'a, an', 'nicht': 'not', 'zu': 'to; too; closed', 'so': 'so, like this',
    'man': 'one, you (people in general)', 'doch': 'but; yes (contradicting)', 'mal': 'just; once', 'denn': 'then; because',
    'schon': 'already', 'noch': 'still, yet', 'auch': 'also, too', 'wie': 'how; like', 'was': 'what', 'wo': 'where',
    'können': 'can, to be able to', 'müssen': 'must, to have to', 'wollen': 'to want', 'sollen': 'should, to be supposed to',
    'dürfen': 'may, to be allowed to', 'mögen': 'to like', 'lassen': 'to let; to leave', 'machen': 'to do, to make',
    'geben': 'to give', 'es gibt': 'there is', 'gehen': 'to go', 'kommen': 'to come', 'sagen': 'to say',
}
NOUN_FIRST = 'noun'


def clean_gloss(text):
    text = re.sub(r'\s*\([^)]*\)', '', text)
    text = text.split(';')[0].strip()
    return text[:60]


def gender(entry):
    for head in entry.get('head_templates', []):
        g = (head.get('args') or {}).get('1', '')
        if g[:1] in ARTICLE:
            return g[:1]
    for tag in entry.get('senses', [{}])[0].get('tags', []) or []:
        if tag in ('masculine', 'feminine', 'neuter'):
            return tag[0]
    return None


def main():
    if not FILE.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        print('downloading', SOURCE)
        urllib.request.urlretrieve(SOURCE, FILE)

    # Each new word as it is written in its sentence, so Verbrechen (noun) is not read as verbrechen (verb).
    wanted = {}
    for path in sorted(OUT.glob('[0-9]*.json')):
        for row in json.loads(path.read_text(encoding='utf-8')):
            written = next((t for t in re.findall(r"[A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*", row[1]) if t.lower() == row[4]), row[4])
            # The first word of a sentence is capitalised anyway; look it up in lower case unless it is a noun.
            wanted[row[4]] = written if not row[1].startswith(written) else row[4]

    lemmas = {}   # (lemma, is noun) -> (pos, gender, meaning)
    forms = {}    # form -> list of (lemma, what, meaning hint)
    with gzip.open(FILE, 'rt', encoding='utf-8') as f:
        for line in f:
            e = json.loads(line)
            word, pos = e.get('word', ''), e.get('pos', '')
            if pos not in POS or not word:
                continue
            meaning = None
            for sense in e.get('senses', []):
                tags = set(sense.get('tags') or [])
                glosses = sense.get('glosses') or []
                if not glosses:
                    continue
                if 'form-of' in tags and sense.get('form_of'):
                    if word.lower() in wanted or word in wanted.values():
                        target = sense['form_of'][0]
                        what = next((label for need, label in FORM_TAGS if need <= tags | {pos}), '')
                        forms.setdefault(word, []).append((target.get('word', ''), what, target.get('extra', '')))
                    continue
                if tags & {'obsolete', 'archaic', 'rare', 'dialectal', 'colloquial', 'vulgar'}:
                    continue
                gloss = clean_gloss(glosses[-1] if len(glosses) > 1 else glosses[0])
                if gloss and not GRAMMAR.match(gloss):
                    meaning = gloss
                    break
            if meaning:
                lemmas.setdefault((word, pos == 'noun'), (pos, gender(e) if pos == 'noun' else None, meaning))

    def entry(lemma):
        # A capitalised word is a noun if Wiktionary has it as one.
        return lemmas.get((lemma, True)) if lemma[:1].isupper() else lemmas.get((lemma, False)) or lemmas.get((lemma, True))

    def label(lemma):
        info = entry(lemma)
        if info and info[0] == 'noun' and info[1]:
            return f'{ARTICLE[info[1]]} {lemma}'
        return lemma

    notes = {}
    for w, form in sorted(wanted.items()):
        info = entry(form)
        if form.lower() in COMMON or (info is None and form in COMMON):
            notes[w] = [form, '', COMMON[form.lower()]]
            continue
        if info:
            notes[w] = [label(form), '', info[2]]
            continue
        # Otherwise a form of another word, for example Witze (plural of der Witz).
        for lemma, what, hint in forms.get(form, []) + forms.get(form.lower(), []):
            base = entry(lemma)
            meaning = COMMON.get(lemma) or (clean_gloss(hint) if hint else (base[2] if base else ''))
            if lemma and meaning:
                notes[w] = [label(lemma), what, meaning]
                break

    (OUT / 'glosses.json').write_text(json.dumps(notes, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'notes for {len(notes)} of {len(wanted)} new words')


if __name__ == '__main__':
    main()
