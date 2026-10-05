import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'

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

// The browser keeps each sentence's audio for a year. Change `voice` when the server's voice changes.
export const speechUrl = (text: string) =>
  `/api/speak?text=${encodeURIComponent(text.normalize('NFC').trim())}&voice=austrian`

export interface Voice {
  /** Reads German aloud. Starts again from the beginning if something is already playing. */
  speak: (text: string) => void
  /** The text being read aloud, or null. */
  playing: string | null
}

/** One voice for the whole app, so only one sentence plays at a time. */
export const VoiceContext = createContext<Voice | null>(null)

/** The app's voice, or null when nothing can speak. */
export const useVoice = () => use(VoiceContext)

/**
 * Returns the voice, or null when nothing can speak.
 * It uses the ElevenLabs voice from /api/speak and falls back to the browser's
 * German voice when that is not available (offline, not set up, out of credits).
 */
export function useGermanVoice(): Voice | null {
  const [browserVoice, setBrowserVoice] = useState(findGermanVoice)
  // Until a request fails, assume the natural voice is there.
  const [serverAvailable, setServerAvailable] = useState(true)
  const [playing, setPlaying] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // Counts requests, so events from an earlier one are ignored.
  const requestRef = useRef(0)

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

  const finish = useCallback((request: number) => {
    if (requestRef.current === request) setPlaying(null)
  }, [])

  const speakWithBrowser = useCallback(
    (text: string, request: number) => {
      if (!browserVoice) {
        finish(request)
        return
      }
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.voice = browserVoice
      utterance.lang = 'de-DE'
      utterance.rate = 0.95
      utterance.addEventListener('end', () => finish(request))
      utterance.addEventListener('error', () => finish(request))
      window.speechSynthesis.speak(utterance)
    },
    [browserVoice, finish],
  )

  const speak = useCallback(
    (text: string) => {
      const request = ++requestRef.current
      audioRef.current?.pause()
      audioRef.current = null
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
      setPlaying(text)
      if (!serverAvailable) {
        speakWithBrowser(text, request)
        return
      }
      const audio = new Audio(speechUrl(text))
      audioRef.current = audio
      const fallBack = () => {
        if (requestRef.current !== request) return
        setServerAvailable(false)
        speakWithBrowser(text, request)
      }
      audio.addEventListener('ended', () => finish(request), { once: true })
      audio.addEventListener('error', fallBack, { once: true })
      audio.play().catch((error: unknown) => {
        // A blocked autoplay is not a missing voice. Anything else falls back.
        if (error instanceof DOMException && error.name === 'NotAllowedError') finish(request)
        else fallBack()
      })
    },
    [serverAvailable, speakWithBrowser, finish],
  )

  const canSpeak = serverAvailable || browserVoice !== null
  return useMemo(() => (canSpeak ? { speak, playing } : null), [canSpeak, speak, playing])
}
