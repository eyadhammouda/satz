import { Volume2 } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { useVoice } from '@/hooks/useGermanVoice'

interface Props {
  text: string
  size?: 'icon' | 'icon-sm'
  className?: string
}

/** Reads a German sentence aloud in one click. Hidden when there is nothing to read or nothing can speak. */
export function ListenButton({ text, size = 'icon-sm', className }: Props) {
  const voice = useVoice()
  if (!voice || !text.trim()) return null
  const active = voice.playing === text

  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      aria-label="Listen"
      title="Listen"
      data-playing={active || undefined}
      className={cn('text-muted-foreground data-playing:text-foreground', className)}
      // Keep focus where it is, so typing can carry on after listening.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => voice.speak(text)}
    >
      <Volume2 className={size === 'icon' ? 'size-5' : undefined} />
    </Button>
  )
}
