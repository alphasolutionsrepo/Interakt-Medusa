"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * The Web Speech API isn't part of TypeScript's bundled DOM types (it's still
 * non-standard/vendor-prefixed on most browsers), so this declares just the
 * handful of members actually used here rather than pulling in a third-party
 * types package for one API.
 */
interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined
  return window.SpeechRecognition ?? window.webkitSpeechRecognition
}

/**
 * Thin wrapper around the browser's native speech-to-text so callers don't
 * each reimplement feature detection and the listening-state cleanup.
 *
 * Not supported at all in Firefox, and only partially in some Safari
 * versions — `isSupported` lets a caller hide the mic button entirely rather
 * than show one that doesn't work.
 */
export function useSpeechRecognition() {
  const [isSupported, setIsSupported] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => {
    setIsSupported(!!getSpeechRecognitionConstructor())
  }, [])

  // Release the mic if the component unmounts mid-listen (e.g. navigation).
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    setIsListening(false)
  }, [])

  const start = useCallback((onResult: (transcript: string) => void) => {
    const Ctor = getSpeechRecognitionConstructor()
    if (!Ctor) return

    const recognition = new Ctor()
    recognition.lang = navigator.language
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript
      if (transcript) onResult(transcript)
    }
    // A denied permission or silence timeout must never leave the button
    // stuck showing "listening" with no way to try again.
    recognition.onerror = () => setIsListening(false)
    recognition.onend = () => setIsListening(false)

    recognitionRef.current = recognition
    setIsListening(true)
    recognition.start()
  }, [])

  return { isSupported, isListening, start, stop }
}
