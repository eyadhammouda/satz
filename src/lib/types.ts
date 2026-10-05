export interface Sentence {
  id: string
  german: string
  english: string
  /** Study day it was added, YYYY-MM-DD */
  createdDay: string
  /** 0 to 5, position in the review schedule */
  box: number
  /** Study day it is next due, YYYY-MM-DD */
  dueDay: string
  lastReviewedDay: string | null
  /** First-try correct reviews */
  correct: number
  missed: number
}

export interface StoredData {
  version: 1
  sentences: Sentence[]
}
