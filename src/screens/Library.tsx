import { useDeferredValue, useMemo, useRef, useState, type FormEvent } from 'react'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { normalise } from '@/lib/check'
import { daysBetween } from '@/lib/schedule'
import { exportBackup, readBackup } from '@/lib/storage'
import type { Sentence } from '@/lib/types'

interface Props {
  sentences: Sentence[]
  today: string
  onUpdate: (id: string, changes: Partial<Sentence>) => void
  onDelete: (id: string) => void
  onImport: (records: Sentence[]) => void
}

function dueLabel(dueDay: string, today: string): string {
  const days = daysBetween(today, dueDay)
  if (days <= 0) return 'Due today'
  if (days === 1) return 'Tomorrow'
  return `In ${days} days`
}

const fold = (text: string) => text.toLocaleLowerCase('de')

export default function Library({ sentences, today, onUpdate, onDelete, onImport }: Props) {
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const deferredQuery = useDeferredValue(query)

  // Newest first: by study day, then by position (new sentences are added to the front).
  const ordered = useMemo(
    () =>
      sentences
        .map((s, index) => ({ s, index }))
        .sort((a, b) => b.s.createdDay.localeCompare(a.s.createdDay) || a.index - b.index)
        .map(({ s }) => s),
    [sentences],
  )

  const results = useMemo(() => {
    const q = fold(deferredQuery.trim())
    if (!q) return ordered
    return ordered.filter((s) => fold(s.german).includes(q) || fold(s.english).includes(q))
  }, [ordered, deferredQuery])

  const editing = sentences.find((s) => s.id === editingId) ?? null

  const importFile = async (file: File) => {
    try {
      const records = await readBackup(file)
      onImport(records)
      toast(`${records.length} ${records.length === 1 ? 'sentence' : 'sentences'} imported`)
    } catch {
      toast('This file is not a Satz backup')
    }
  }

  return (
    <section className="flex flex-1 flex-col">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Search"
          placeholder="Search"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      <p className="mt-6 text-[13px] text-muted-foreground tabular-nums" aria-live="polite">
        {query.trim()
          ? `${results.length} of ${sentences.length}`
          : `${sentences.length} ${sentences.length === 1 ? 'sentence' : 'sentences'}`}
      </p>

      {results.length > 0 ? (
        <ul className="mt-2 -mx-3">
          {results.map((s) => (
            <li key={s.id} className="row">
              <button
                type="button"
                onClick={() => setEditingId(s.id)}
                className="flex w-full items-center gap-4 rounded-lg px-3 py-3 text-left outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 [@media(hover:hover)]:hover:bg-muted/60"
              >
                <span className="min-w-0 flex-1">
                  <span lang="de" className="block text-[15px] break-words">
                    {s.german}
                  </span>
                  <span className="block text-[13px] break-words text-muted-foreground">{s.english}</span>
                </span>
                <span className="shrink-0 text-[13px] whitespace-nowrap text-muted-foreground tabular-nums">
                  {dueLabel(s.dueDay, today)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-10 text-center text-[15px] text-muted-foreground">
          {sentences.length === 0 ? 'No sentences yet' : 'No matches'}
        </p>
      )}

      <div className="mt-auto flex justify-center gap-2 pt-12">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => exportBackup(sentences, today)}>
          Export
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => fileRef.current?.click()}>
          Import
        </Button>
        <form method="post" action="/api/auth/logout">
          <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
            Sign out
          </Button>
        </form>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importFile(file)
          }}
        />
      </div>

      <EditDialog
        sentence={editing}
        sentences={sentences}
        onClose={() => setEditingId(null)}
        onSave={(changes) => {
          if (editing) onUpdate(editing.id, changes)
          setEditingId(null)
        }}
        onDelete={() => {
          if (editing) onDelete(editing.id)
          setEditingId(null)
        }}
      />
    </section>
  )
}

interface EditProps {
  sentence: Sentence | null
  sentences: Sentence[]
  onClose: () => void
  onSave: (changes: Pick<Sentence, 'german' | 'english'>) => void
  onDelete: () => void
}

function EditDialog({ sentence, sentences, onClose, onSave, onDelete }: EditProps) {
  // Keep the last sentence while the dialog animates out.
  const [shown, setShown] = useState(sentence)
  if (sentence && sentence !== shown) setShown(sentence)

  return (
    <Dialog open={sentence !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        {shown && (
          <EditForm key={shown.id} sentence={shown} sentences={sentences} onSave={onSave} onDelete={onDelete} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function EditForm({
  sentence,
  sentences,
  onSave,
  onDelete,
}: Pick<EditProps, 'sentences' | 'onSave' | 'onDelete'> & { sentence: Sentence }) {
  const [german, setGerman] = useState(sentence.german)
  const [english, setEnglish] = useState(sentence.english)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!german.trim() || !english.trim()) return
    const key = normalise(german)
    if (sentences.some((s) => s.id !== sentence.id && normalise(s.german) === key)) {
      toast('Already in your library')
      return
    }
    onSave({ german: german.trim(), english: english.trim() })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <DialogHeader>
        <DialogTitle>Edit sentence</DialogTitle>
        <DialogDescription className="sr-only">Change the German or English text.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <Label htmlFor="edit-german">German</Label>
        <Input
          id="edit-german"
          lang="de"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={german}
          aria-invalid={!german.trim() || undefined}
          onChange={(e) => setGerman(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="edit-english">English</Label>
        <Input
          id="edit-english"
          lang="en"
          autoComplete="off"
          value={english}
          aria-invalid={!english.trim() || undefined}
          onChange={(e) => setEnglish(e.target.value)}
        />
      </div>
      <DialogFooter className="flex-row justify-between sm:justify-between">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="ghost" className="-ml-3 text-destructive hover:text-destructive">
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this sentence?</AlertDialogTitle>
              <AlertDialogDescription>Its review history is deleted too.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button type="submit" disabled={!german.trim() || !english.trim()}>
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}
