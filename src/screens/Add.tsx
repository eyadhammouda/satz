import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { ListenButton } from '@/components/ListenButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AddResult } from '@/hooks/useSentences'
import type { Sentence } from '@/lib/types'

interface Props {
  sentences: Sentence[]
  today: string
  onAdd: (german: string, english: string) => AddResult
  onDelete: (id: string) => void
}

export default function Add({ sentences, today, onAdd, onDelete }: Props) {
  const [german, setGerman] = useState('')
  const [english, setEnglish] = useState('')
  const [invalid, setInvalid] = useState<'german' | 'english' | null>(null)
  const germanRef = useRef<HTMLInputElement>(null)
  const englishRef = useRef<HTMLInputElement>(null)

  // Focus German when the tab opens. The tab switches on mousedown, and the browser
  // then focuses the tab itself, so wait a frame.
  useEffect(() => {
    const frame = requestAnimationFrame(() => germanRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  const addedToday = useMemo(() => sentences.filter((s) => s.createdDay === today), [sentences, today])

  const save = (event?: FormEvent) => {
    event?.preventDefault()
    if (!german.trim()) {
      setInvalid('german')
      germanRef.current?.focus()
      return
    }
    if (!english.trim()) {
      setInvalid('english')
      englishRef.current?.focus()
      return
    }
    const result = onAdd(german, english)
    if (result === 'duplicate') {
      toast('Already in your library')
      germanRef.current?.focus()
      return
    }
    setGerman('')
    setEnglish('')
    setInvalid(null)
    germanRef.current?.focus()
  }

  const onGermanKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (!german.trim()) {
      setInvalid('german')
      return
    }
    englishRef.current?.focus()
  }

  return (
    <section>
      <form onSubmit={save} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="add-german">German</Label>
          <div className="relative">
            <Input
              ref={germanRef}
              id="add-german"
              lang="de"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="sentences"
              spellCheck={false}
              enterKeyHint="next"
              value={german}
              aria-invalid={invalid === 'german' || undefined}
              onChange={(e) => {
                setGerman(e.target.value)
                if (invalid === 'german') setInvalid(null)
              }}
              onKeyDown={onGermanKeyDown}
              className="pr-11"
            />
            <ListenButton text={german} className="absolute top-1/2 right-1.5 -translate-y-1/2" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="add-english">English</Label>
          <Input
            ref={englishRef}
            id="add-english"
            lang="en"
            autoComplete="off"
            enterKeyHint="done"
            value={english}
            aria-invalid={invalid === 'english' || undefined}
            onChange={(e) => {
              setEnglish(e.target.value)
              if (invalid === 'english') setInvalid(null)
            }}
          />
        </div>
        <Button type="submit" size="lg" className="mt-1">
          Add
        </Button>
      </form>

      {addedToday.length > 0 && (
        <div className="mt-12">
          <h2 className="text-[13px] text-muted-foreground">Added today ({addedToday.length})</h2>
          <ul className="mt-2 divide-y">
            {addedToday.map((s) => (
              <li key={s.id} className="row flex items-center gap-1 py-3">
                <div className="min-w-0 flex-1 pr-2">
                  <p lang="de" className="text-[15px] break-words">
                    {s.german}
                  </p>
                  <p className="text-[13px] break-words text-muted-foreground">{s.english}</p>
                </div>
                <ListenButton text={s.german} />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Delete "${s.german}"`}
                  onClick={() => onDelete(s.id)}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
