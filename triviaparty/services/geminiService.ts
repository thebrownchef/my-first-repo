import { GoogleGenAI, Type, Schema, Modality } from "@google/genai";
import { Difficulty, TriviaQuestion } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- Persistent question history (browser localStorage) ---------------------------

const HISTORY_KEY = "trivia_question_history";
const REPEAT_WINDOW_DAYS = 90; // "a few months"

interface HistoryEntry {
  normalizedAnswer: string;
  questionText: string;
  genre: string;
  difficulty: Difficulty;
  timestamp: number;
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, " ").trim().replace(/^(the|a|an)\s+/, "");
}

function questionSimilarity(a: string, b: string): number {
  const getWords = (s: string) => s.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const wordsA = getWords(a);
  const wordsB = getWords(b);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  
  let overlap = 0;
  for (const w of setA) {
    if (setB.has(w)) overlap++;
  }
  
  return overlap / Math.min(setA.size, setB.size);
}

const DB_NAME = "trivia-db";
const STORE_NAME = "question_history";

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "timestamp" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let didMigrate = false;

async function loadHistoryAsync(): Promise<HistoryEntry[]> {
  try {
    const db = await getDB();
    
    // One-time migration
    if (!didMigrate) {
      didMigrate = true;
      try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (raw) {
          const oldEntries = JSON.parse(raw) as HistoryEntry[];
          if (oldEntries.length > 0) {
            const countReq = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).count();
            const count = await new Promise<number>((res) => { countReq.onsuccess = () => res(countReq.result); });
            if (count === 0) {
              const tx = db.transaction(STORE_NAME, "readwrite");
              const store = tx.objectStore(STORE_NAME);
              for (const entry of oldEntries) {
                store.put(entry);
              }
              await new Promise<void>((res, rej) => {
                tx.oncomplete = () => res();
                tx.onerror = () => rej(tx.error);
              });
            }
          }
        }
      } catch (e) {
        console.warn("Migration from localStorage failed:", e);
      }
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("IndexedDB failed, falling back to localStorage", err);
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
    } catch {
      return [];
    }
  }
}

async function saveHistoryAsync(entries: HistoryEntry[]): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    for (const entry of entries) {
      store.put(entry);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    } catch (e) {
      console.warn("Failed to save question history:", e);
    }
  }
}

async function getRecentHistory(genre: string): Promise<HistoryEntry[]> {
  const cutoff = Date.now() - REPEAT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const all = await loadHistoryAsync();
  return all.filter(e => e.genre === genre && e.timestamp >= cutoff);
}

async function getAllRecentHistory(): Promise<HistoryEntry[]> {
  const cutoff = Date.now() - REPEAT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const all = await loadHistoryAsync();
  return all.filter(e => e.timestamp >= cutoff);
}

async function recordHistory(entry: HistoryEntry) {
  const cutoff = Date.now() - REPEAT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const all = await loadHistoryAsync();
  const recent = all.filter(e => e.timestamp >= cutoff);
  recent.push(entry);
  await saveHistoryAsync(recent);
}

export async function exportHistory(): Promise<string> {
  const history = await loadHistoryAsync();
  return JSON.stringify(history, null, 2);
}

export async function importHistory(json: string): Promise<void> {
  const entries = JSON.parse(json) as HistoryEntry[];
  if (!Array.isArray(entries)) throw new Error("Invalid format");
  const validEntries = entries.filter(e => e.normalizedAnswer && e.questionText && e.timestamp);
  
  const existing = await loadHistoryAsync();
  const existingSet = new Set(existing.map(e => `${e.questionText}-${e.timestamp}`));
  
  for (const entry of validEntries) {
    if (!existingSet.has(`${entry.questionText}-${entry.timestamp}`)) {
      existing.push(entry);
    }
  }
  
  await saveHistoryAsync(existing);
}

// --- Question generation ----------------------------------------------------------

const questionSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    questionText: { type: Type.STRING, description: "The trivia question text sourced from a Wikipedia-style fact." },
    options: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "An array of exactly 4 multiple choice options. One MUST be the correctAnswer, and the other three must be plausible incorrect answers.",
    },
    correctAnswer: { type: Type.STRING, description: "The primary correct answer." },
    explanation: { type: Type.STRING, description: "Exactly one concise sentence containing an interesting fact explaining the answer." }
  },
  required: ["questionText", "options", "correctAnswer", "explanation"],
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Give each attempt a hard ceiling so a hung request doesn't eat the whole budget
const ATTEMPT_TIMEOUT_MS = 15000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Timeout")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

async function isSemanticDuplicate(
  candidate: { questionText: string; correctAnswer: string },
  historyEntries: HistoryEntry[]
): Promise<boolean> {
  if (historyEntries.length === 0) return false;
  
  const recentEntries = historyEntries.slice(-40);
  
  const prompt = `
    Determine if the candidate trivia question tests the SAME underlying fact as any of the recent questions in the history, even if phrased completely differently, from a reversed angle, or with a different but equivalent correct answer.
    
    Example of a match:
    - "What is Japan's flag?"
    - "Which country has a white flag with a red circle?"
    These test the same underlying fact and should be considered duplicates.
    
    Candidate Question:
    Question: ${candidate.questionText}
    Answer: ${candidate.correctAnswer}
    
    Recent Questions:
    ${recentEntries.map((e, i) => `[${i}] Question: ${e.questionText}\n    Answer: ${e.normalizedAnswer}`).join("\n")}
  `;

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      isDuplicate: { type: Type.BOOLEAN },
      matchedQuestion: { type: Type.STRING, description: "The history question it duplicates, or empty string if none." }
    },
    required: ["isDuplicate", "matchedQuestion"]
  };

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: schema,
        }
      }),
      6000
    );

    if (response.text) {
      const result = JSON.parse(response.text);
      return result.isDuplicate === true;
    }
  } catch (err) {
    console.warn("Semantic duplicate check failed, failing open", err);
  }
  
  return false;
}

async function requestQuestion(
  genre: string,
  difficulty: Difficulty,
  recentQuestionTexts: string[]
): Promise<TriviaQuestion> {
  const model = "gemini-3.5-flash";
  const randomSeed = `${Date.now()}-${Math.floor(Math.random() * 1000000)}-${difficulty}`;

  const isRandom = genre.trim().toLowerCase() === "random";
  const targetTopicDescription = isRandom
    ? `a completely random, highly diverse, and unpredictable topic of your choosing (e.g. marine biology, world history, classical music, space exploration, pop culture, culinary arts, architecture, retro video games, folklore, quantum physics, ancient civilizations, fashion history, etc.). Make sure to pick a random, highly specific sub-topic or entity to ensure excellent surprise and variety`
    : `the genre "${genre}"`;

  const prompt = `
    Generate a trivia question related to ${targetTopicDescription}, drawing on your internal knowledge.

    RANDOM ENTROPY SEED: ${randomSeed} (You MUST use this seed to pivot to a different sub-topic/entity than you usually would).

    DIFFICULTY CALIBRATION (CRITICAL):
    - EASY: "Common Knowledge" — household names, major capitals, world-famous figures, massive global milestones.
    - MEDIUM: "Enthusiast Level" — requires some specific interest in the topic.
    - HARD: "Expert/Niche Level" — obscure, technical, deep-cut facts.

    Constraints:
    - Ensure the question is phrased clearly and directly, avoiding any ambiguity.
    - Provide exactly 4 options in 'options'.
    - The explanation MUST be exactly one concise sentence long.

    ANTI-REPETITION MANDATE (CRITICAL):
    - Do NOT ask about a topic whose answer is any of these (used in the past ${REPEAT_WINDOW_DAYS} days):
    ${JSON.stringify(recentQuestionTexts)}
  `;

  const response = await withTimeout(
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: questionSchema,
        temperature: 0.7,
      },
    }),
    ATTEMPT_TIMEOUT_MS
  );

  const text = response.text;
  if (!text) throw new Error("Empty response from Gemini");

  const question = JSON.parse(text) as TriviaQuestion;

  function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  question.options = shuffle(question.options || []);

  return question;
}

async function generateWithRetries(
  genre: string,
  difficulty: Difficulty
): Promise<TriviaQuestion> {
  const recent = await getRecentHistory(genre);
  const dedupeHistory = await getAllRecentHistory();
  const recentQuestionTexts = recent.map(e => e.questionText).slice(-25);
  let currentRecentTexts = [...recentQuestionTexts];

  const MAX_ATTEMPTS = 7;
  let lastError: any;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let currentQuestion: TriviaQuestion | null = null;
    try {
      currentQuestion = await requestQuestion(genre, difficulty, currentRecentTexts);
      const question = currentQuestion;
      
      const normalizedAnswer = normalize(question.correctAnswer);
      for (const entry of dedupeHistory) {
        if (entry.normalizedAnswer === normalizedAnswer && questionSimilarity(entry.questionText, question.questionText) >= 0.3) {
          throw new Error("DUPLICATE_ANSWER");
        }
        if (questionSimilarity(entry.questionText, question.questionText) >= 0.85) {
          throw new Error("DUPLICATE_ANSWER");
        }
      }

      if (await isSemanticDuplicate({ questionText: question.questionText, correctAnswer: question.correctAnswer }, dedupeHistory)) {
        throw new Error("DUPLICATE_ANSWER");
      }

      await recordHistory({
        normalizedAnswer,
        questionText: question.questionText,
        genre,
        difficulty,
        timestamp: Date.now(),
      });
      
      // Fetch TTS question and answer audio in the background in parallel
      try {
        const questionStemText = `${question.questionText} Is it...`;
        const answerTextToSpeak = `${question.correctAnswer}. ${question.explanation}`;
        
        const optionPromises = question.options.map(opt => generateTriviaAudio(`${opt}.`));

        const [stemAudioRes, aAudioRes, ...optionAudioResList] = await Promise.all([
          generateTriviaAudio(questionStemText),
          generateTriviaAudio(answerTextToSpeak),
          ...optionPromises
        ]);

        if (stemAudioRes.data) {
          question.questionStemAudio = stemAudioRes.data;
        }
        if (aAudioRes.data) {
          question.answerAudio = aAudioRes.data;
        }
        
        question.optionAudios = {};
        question.options.forEach((opt, index) => {
          if (optionAudioResList[index].data) {
             question.optionAudios![opt] = optionAudioResList[index].data;
          }
        });

      } catch (audioErr) {
        console.warn("Failed to generate background TTS audio for question:", audioErr);
      }

      return question;
    } catch (error: any) {
      lastError = error;
      if (error?.status === 429 || error?.message?.toLowerCase().includes("quota")) {
        break; // Don't retry on quota errors
      }
      if (error?.message === "DUPLICATE_ANSWER") {
        if (currentQuestion?.questionText && !currentRecentTexts.includes(currentQuestion.questionText)) {
          currentRecentTexts.push(currentQuestion.questionText);
        }
        continue; // no backoff needed, just try again immediately
      }
      console.warn(`Attempt ${attempt} failed:`, error?.message || error);
      if (attempt < MAX_ATTEMPTS) await delay(500 * attempt); // shorter backoff than before
    }
  }

  throw lastError || new Error("Failed to generate question");
}

let cachedConnectorAudio: string | null = null;
let cachedForTheWinAudio: string | null = null;

export async function getConnectorAudio(): Promise<string | null> {
  if (cachedConnectorAudio) return cachedConnectorAudio;
  const res = await generateTriviaAudio(" or ");
  if (res.data) cachedConnectorAudio = res.data;
  return cachedConnectorAudio;
}

export async function getForTheWinAudio(): Promise<string | null> {
  if (cachedForTheWinAudio) return cachedForTheWinAudio;
  const res = await generateTriviaAudio(" for the win. ");
  if (res.data) cachedForTheWinAudio = res.data;
  return cachedForTheWinAudio;
}

// --- Prefetch queue: the actual fix for perceived load time -----------------------
// Keeps one question ready ahead of time per genre+difficulty so the player rarely
// waits on a live API call.

const prefetchCache = new Map<string, Promise<TriviaQuestion>>();

function cacheKey(genre: string, difficulty: Difficulty) {
  return `${genre}::${difficulty}`;
}

/** Call this as soon as you know which genre/difficulty is coming up next
 *  (e.g. right when the current question is shown), so it's ready before it's needed. */
export function prefetchTriviaQuestion(genre: string, difficulty: Difficulty): void {
  const key = cacheKey(genre, difficulty);
  if (!prefetchCache.has(key)) {
    prefetchCache.set(key, generateWithRetries(genre, difficulty).catch(err => {
      prefetchCache.delete(key); // don't cache a failure
      throw err;
    }));
  }
}

export const generateTriviaQuestion = async (
  genre: string,
  difficulty: Difficulty
): Promise<TriviaQuestion> => {
  const key = cacheKey(genre, difficulty);
  const pending = prefetchCache.get(key);

  if (pending) {
    prefetchCache.delete(key);
    return await pending;
  }
  return await generateWithRetries(genre, difficulty);
};

export const generateTriviaAudio = async (text: string): Promise<{ data: string | null; error?: string }> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Fenrir' },
          },
        },
      },
    });
    const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
    return { data };
  } catch (error: any) {
    const isQuotaError = error?.status === 429 || error?.message?.includes("429") || error?.message?.toLowerCase().includes("quota");
    if (!isQuotaError) {
      console.error("Audio generation failed:", error);
    }
    return {
      data: null,
      error: isQuotaError ? "QUOTA_EXCEEDED" : (error?.message || "Unknown error")
    };
  }
};

export const generateVictorySong = async (
  topic: string
): Promise<{ url: string | null; error?: string }> => {
  try {
    const prompt = `Write a very short, upbeat, and triumphant 2-line rhyming victory chant about mastering the topic of "${topic}".`;
    
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: prompt,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Puck' },
          },
        },
      },
    });

    const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!data) throw new Error("No audio data returned");

    return { url: data };
  } catch (error: any) {
    const isQuotaError = error?.status === 429 || error?.message?.includes("429") || error?.message?.toLowerCase().includes("quota");
    if (isQuotaError) return { url: null, error: "QUOTA_EXCEEDED" };
    
    console.error("Song generation failed:", error);
    return { 
      url: null, 
      error: error?.message || "Unknown error" 
    };
  }
};
