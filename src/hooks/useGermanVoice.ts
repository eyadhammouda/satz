import { useCallback, useEffect, useState } from 'react'

function findGermanVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null
  const voices = window.speechSynthesis.getVoices()
  return (
    voices.find((v) => v.lang.replace('_', '-') === 'de-DE' && v.localService) ??
    voices.find((v) => v.lang.replace('_', '-') === 'de-DE') ??
    voices.find((v) => v.lang.toLowerCase().startsWith('de')) ??
    null
  )
}

/** Returns a function that reads German aloud, or null when no German voice exists. */
export function useGermanVoice(): ((text: string) => void) | null {
  const [voice, setVoice] = useState(findGermanVoice)

  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const update = () => setVoice(findGermanVoice())
    window.speechSynthesis.addEventListener('voiceschanged', update)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', update)
      window.speechSynthesis.cancel()
    }
  }, [])

  const speak = useCallback(
    (text: string) => {
      if (!voice) return
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.voice = voice
      utterance.lang = 'de-DE'
      utterance.rate = 0.95
      window.speechSynthesis.speak(utterance)
    },
    [voice],
  )

  return voice ? speak : null
}
