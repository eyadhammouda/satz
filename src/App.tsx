import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toaster } from '@/components/ui/sonner'
import { useSentences, useStudyDay } from '@/hooks/useSentences'
import { isDue, shuffle } from '@/lib/schedule'
import Add from '@/screens/Add'
import Library from '@/screens/Library'
import Review, { type ReviewMode } from '@/screens/Review'
import Today from '@/screens/Today'

type Tab = 'today' | 'add' | 'library'

interface ReviewSession {
  mode: ReviewMode
  ids: string[]
}

export default function App() {
  const store = useSentences()
  const today = useStudyDay()
  const [tab, setTab] = useState<Tab>('today')
  const [review, setReview] = useState<ReviewSession | null>(null)

  const startReview = () => {
    const due = store.sentences
      .filter((s) => isDue(s, today))
      .sort((a, b) => a.dueDay.localeCompare(b.dueDay) || a.createdDay.localeCompare(b.createdDay))
    setReview({ mode: 'review', ids: due.map((s) => s.id) })
  }

  const startPractice = () => {
    const added = store.sentences.filter((s) => s.createdDay === today)
    setReview({ mode: 'practice', ids: shuffle(added).map((s) => s.id) })
  }

  return (
    <>
      {review ? (
        <Review
          key={review.ids.join()}
          mode={review.mode}
          ids={review.ids}
          sentences={store.sentences}
          onGrade={store.update}
          onClose={() => setReview(null)}
        />
      ) : (
        <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col px-6 pt-[max(env(safe-area-inset-top),2rem)] pb-[max(env(safe-area-inset-bottom),2rem)]">
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as Tab)}
            activationMode="manual"
            className="items-center"
          >
            <TabsList aria-label="Sections" className="h-9! w-full max-w-[300px]">
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="add">Add</TabsTrigger>
              <TabsTrigger value="library">Library</TabsTrigger>
            </TabsList>
          </Tabs>

          <main className="flex flex-1 flex-col pt-10">
            {tab === 'today' && (
              <Today
                sentences={store.sentences}
                today={today}
                onStartReview={startReview}
                onPractise={startPractice}
                onAdd={() => setTab('add')}
              />
            )}
            {tab === 'add' && <Add sentences={store.sentences} today={today} onAdd={store.add} onDelete={store.remove} />}
            {tab === 'library' && (
              <Library
                sentences={store.sentences}
                today={today}
                onUpdate={store.update}
                onDelete={store.remove}
                onImport={store.importRecords}
              />
            )}
          </main>
        </div>
      )}
      <Toaster />
    </>
  )
}
