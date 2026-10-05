import { createSentence } from './schedule'
import type { Sentence } from './types'

const STARTERS: [german: string, english: string][] = [
  ['Ich werde es selbst tun', 'I will do it myself'],
  ['Ich kann es nicht tun', "I can't do it"],
  ['Ich bin mir ziemlich sicher', 'I am pretty sure'],
  ['In Linz hat es geschneit', 'It snowed in Linz'],
  ['Lass mich mal sehen', 'Let me see it'],
  ['Die Schule ist zwei Kilometer weiter', 'The school is two kilometers ahead'],
  ['Wir hatten in diesem Jahr viel Schnee', 'We had plenty of snow this year'],
  ['Sie ist dabei zu gehen', 'She is about to leave'],
  ['Es wird heute wahrscheinlich regnen', "It's likely to rain today"],
]

/** Starter sentences, all added on the first-launch study day. */
export function seedSentences(today: string): Sentence[] {
  return STARTERS.map(([german, english]) => createSentence(german, english, today))
}
