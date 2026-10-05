import { useCallback, useEffect, useRef, useState } from 'react'

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

export const speechUrl = (text: string) => `/api/speak?text=${encodeURIComponent(text.normalize('NFC').trim())}`

/**
 * Returns a function that reads German aloud, or null when nothing can speak.
 * It uses the ElevenLabs voice from /api/speak and falls back to the browser's
 * German voice when that is not available (offline, not set up, out of credits).
 */
export function useGermanVoice(): ((text: string) => void) | null {
  const [browserVoice, setBrowserVoice] = useState(findGermanVoice)
  // Until a request fails, assume the natural voice is there.
  const [serverAvailable, setServerAvailable] = useState(true)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const hasSynth = 'speechSynthesis' in window
    const update = () => setBrowserVoice(findGermanVoice())
    if (hasSynth) window.speechSynthesis.addEventListener('voiceschanged', update)
    return () => {
      if (hasSynth) {
        window.speechSynthesis.removeEventListener('voiceschanged', update)
        window.speechSynthesis.cancel()
      }
      audioRef.current?.pause()
    }
  }, [])

  const speakWithBrowser = useCallback(
    (text: string) => {
      if (!browserVoice) return
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.voice = browserVoice
      utterance.lang = 'de-DE'
      utterance.rate = 0.95
      window.speechSynthesis.speak(utterance)
    },
    [browserVoice],
  )

  const speak = useCallback(
    (text: string) => {
      audioRef.current?.pause()
      if (browserVoice) window.speechSynthesis.cancel()
      if (!serverAvailable) {
        speakWithBrowser(text)
        return
      }
      const audio = new Audio(speechUrl(text))
      audioRef.current = audio
      const fallBack = () => {
        if (audioRef.current !== audio) return
        setServerAvailable(false)
        speakWithBrowser(text)
      }
      audio.addEventListener('error', fallBack, { once: true })
      audio.play().catch((error: unknown) => {
        // A blocked autoplay is not a missing voice. Anything else falls back.
        if (!(error instanceof DOMException && error.name === 'NotAllowedError')) fallBack()
      })
    },
    [browserVoice, serverAvailable, speakWithBrowser],
  )

  return serverAvailable || browserVoice ? speak : null
}
