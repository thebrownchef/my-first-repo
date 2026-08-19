const Type = {
  OBJECT: "OBJECT",
  ARRAY: "ARRAY",
  STRING: "STRING"
};
const Modality = {
  AUDIO: "AUDIO"
};
import { GoogleGenAI } from "@google/genai";
import { Player, StorySegment, ConditionUpdate } from "../types";

// The key is never bundled into the built app or committed to the repo — it's
// entered once in the browser and kept in localStorage on the player's own device.
export const API_KEY_STORAGE_KEY = "forgedfables_gemini_api_key";

export function getStoredApiKey(): string | null {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, key.trim());
  ai = new GoogleGenAI({ apiKey: key.trim() });
}

export function clearStoredApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

let ai = new GoogleGenAI({ apiKey: getStoredApiKey() || "" });

// Calls Gemini directly from the browser and normalizes the response into the
// same { text, candidates } shape the app's original Express proxy returned,
// so every call site below needed no changes beyond swapping fetch() for this.
async function callGenerateContent(body: any): Promise<{ text: string; candidates: any }> {
  const { model, ...params } = body;
  const response = await ai.models.generateContent({ model, ...params });
  let text = '';
  try { text = response.text || ''; } catch { /* text getter can throw if empty */ }
  return { text, candidates: response.candidates };
}

// Mirrors the original server's /api/generateMusic handler, but streamed
// straight from the browser instead of through a backend.
async function callGenerateMusic(prompt: string): Promise<{ audioBase64: string; lyrics: string; mimeType: string }> {
  const stream = await ai.models.generateContentStream({
    model: "lyria-3-clip-preview",
    contents: prompt,
    config: { responseModalities: ["AUDIO"] },
  });

  const audioChunks: Uint8Array[] = [];
  let lyrics = "";
  let mimeType = "audio/wav";

  for await (const chunk of stream) {
    const parts = chunk.candidates?.[0]?.content?.parts;
    if (!parts) continue;
    for (const part of parts) {
      if (part.inlineData?.data) {
        if (audioChunks.length === 0 && part.inlineData.mimeType) mimeType = part.inlineData.mimeType;
        const binary = atob(part.inlineData.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        audioChunks.push(bytes);
      }
      if (part.text) lyrics += part.text;
    }
  }

  const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of audioChunks) { combined.set(chunk, offset); offset += chunk.length; }

  let binaryStr = '';
  for (let i = 0; i < combined.length; i++) binaryStr += String.fromCharCode(combined[i]);
  const audioBase64 = combined.length > 0 ? btoa(binaryStr) : '';

  return { audioBase64, lyrics, mimeType };
}

// --- CONFIGURATION ---

// 1. TEXT MODELS
const INITIAL_TEXT_MODELS = ['gemini-3.5-flash', 'gemini-2.5-flash'];
let activeTextModels = [...INITIAL_TEXT_MODELS]; 

// 2. IMAGE MODELS
// Using only the stable ID.
const IMAGE_MODELS = ['gemini-2.5-flash-image'];

// 3. AUDIO MODELS
const TTS_MODEL = 'gemini-3.1-flash-tts-preview';

const DIALOGUE_TYPES = [
  "threat", "question", "boast", "order", "plea",
  "taunt", "confession", "observation", "warning",
  "joke", "demand", "lie", "aside"
];

// --- UTILS ---

const cleanJson = (text: string): string => {
  if (!text) return "{}";
  // Remove markdown code blocks
  let cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
  
  // Try to find the outer brace pair
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
      return cleaned.substring(firstBrace, lastBrace + 1);
  }
  
  // If no braces found, but text exists, it might be raw text. Return empty object to trigger fallback logic.
  return "{}";
};

// --- CORE FALLBACK LOGIC (TEXT) ---

async function generateWithFallback(
    params: any, 
    statusCallback?: (msg: string) => void
): Promise<any> {
    if (activeTextModels.length === 0) {
        activeTextModels = [...INITIAL_TEXT_MODELS];
    }

    let lastError: any;
    
    // RETRY STATE
    let currentModelRetries = 0;
    const MAX_MODEL_RETRIES = 3; 

    while (activeTextModels.length > 0) {
        const currentModel = activeTextModels[0];
        
        // Debug Log
        // console.log(`[Gemini Req] Model: ${currentModel} | Attempt: ${currentModelRetries + 1}`);

        try {
            const response = await callGenerateContent({
                model: currentModel,
                ...params
            });
            return response; 

        } catch (e: any) {
            lastError = e;
            const msg = e.message || JSON.stringify(e);
            const isQuota = msg.includes("429") || msg.includes("quota") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("Rate limit");
            
            // --- SCENARIO A: QUOTA ERROR (429) ---
            if (isQuota) {
                if (currentModelRetries < MAX_MODEL_RETRIES) {
                    const waitTime = 1500 * Math.pow(1.5, currentModelRetries + 1); 
                    const waitSecs = Math.round(waitTime / 1000);
                    
                    console.warn(`[Text 429] Quota hit on ${currentModel}. Waiting ${waitSecs}s (Attempt ${currentModelRetries + 1}/${MAX_MODEL_RETRIES})...`);
                    if (statusCallback) statusCallback(`Narrator is thinking... (${waitSecs}s)`);
                    
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    currentModelRetries++;
                    continue; 
                } else {
                    console.error(`[Text 429] Max retries reached for ${currentModel}. Shifting to backup model.`);
                    activeTextModels.shift();
                    currentModelRetries = 0;
                    if (activeTextModels.length > 0) {
                        if (statusCallback) statusCallback(`Switching to backup brain (${activeTextModels[0]})...`);
                        continue;
                    }
                }
            } else {
                // --- SCENARIO B: FATAL ERROR (404, 400, 500) ---
                console.error(`[Text Circuit Breaker] Abandoning ${currentModel} due to fatal error:`, msg);
                activeTextModels.shift(); 
                currentModelRetries = 0; 
                
                if (activeTextModels.length > 0) {
                    if (statusCallback) statusCallback(`Switching to backup brain (${activeTextModels[0]})...`);
                    continue;
                }
            }
        }
    }
    
    // Auto-restore pool for future requests
    activeTextModels = [...INITIAL_TEXT_MODELS];
    throw lastError || new Error("Connection to AI lost. Please reload the page.");
}

// --- IMAGE GENERATION QUEUE & FALLBACK ---

let imageGenerationQueue = Promise.resolve();
let imageCongestionLevel = 0; 

async function scheduleImageGeneration(prompt: string): Promise<string | undefined> {
    const task = imageGenerationQueue.then(async () => {
        // Dynamic delay: 5s base + penalty
        const delay = 5000 + (imageCongestionLevel * 2000);
        await new Promise(r => setTimeout(r, delay));
        return generateImageWithFallbackStrategy(prompt);
    });
    imageGenerationQueue = task.catch(() => undefined).then(() => undefined);
    return task;
}

async function generateImageWithFallbackStrategy(prompt: string): Promise<string | undefined> {
    for (const modelId of IMAGE_MODELS) {
        try {
            console.log(`[Image Gen] Trying: ${modelId}`);
            const response = await callGenerateContent({
                model: modelId,
                contents: { parts: [{ text: prompt }] },
            });

            if (response.candidates?.[0]?.content?.parts) {
                for (const part of response.candidates[0].content.parts) {
                    if (part.inlineData && part.inlineData.data) {
                        // SUCCESS LOG
                        console.log(`[Image Gen] Success with ${modelId}`);
                        if (imageCongestionLevel > 0) imageCongestionLevel--;
                        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                    }
                }
            }
        } catch (e: any) {
            const msg = e.message || "";
            console.warn(`[Image Gen] ${modelId} failed:`, msg);
            
            if (msg.includes("429") || msg.includes("quota")) {
                imageCongestionLevel = Math.min(5, imageCongestionLevel + 1);
                return undefined;
            }
        }
    }
    console.warn("[Image Gen] All models failed or returned no data.");
    return undefined;
}

// --- DECODERS ---

const decodeBase64 = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) { bytes[i] = binaryString.charCodeAt(i); }
  return bytes;
};

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

let _audioContext: AudioContext | null = null;
const getAudioContext = () => {
    if (!_audioContext) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        _audioContext = new AudioContextClass();
    }
    return _audioContext;
};

export const playRawAudio = async (base64Audio: string): Promise<void> => {
  try {
      if (!base64Audio) return;
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      const bytes = decodeBase64(base64Audio);
      const audioBuffer = await decodeAudioData(bytes, ctx, 24000, 1);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.start(0);
      return new Promise<void>((resolve) => { source.onended = () => resolve(); });
  } catch (e) {
      console.error("Error playing audio data:", e);
  }
};

// --- GENERATORS ---

export const generateDraftOptions = async (
  category: 'archetype' | 'adjective' | 'suffix' | 'name' | 'quest',
  count: number,
  scenario: string,
  players?: Player[],
  onStatusUpdate?: (msg: string) => void
): Promise<string[]> => {
  const theme = scenario || "General Fiction"; 
  let prompt = "";

  if (category === 'archetype') {
    prompt = `Analyze the scenario: "${theme}". Generate a list of ${count} distinct, diverse character roles, backgrounds, or archetypes that fit into this setting.
    RULES: Output must be 1-2 words. Absolutely never include the definite article 'The' at the beginning. Restrict options to the established conventions and native reality of this specific scenario.`;
  } else if (category === 'adjective') {
    prompt = `Analyze the scenario: "${theme}". Generate a list of ${count} distinct adjectives to describe a character. Ensure a wide variety. One word only. Bound the tone and vocabulary to the typical stakes and reality of this scenario.`;
  } else if (category === 'suffix') {
    prompt = `Analyze the scenario: "${theme}". Generate a list of ${count} distinct and varied character titles/origins. Ensure they suggest different backgrounds or origins and fit natively into this setting.
    RULES: MUST start with "of" or "from". NO hyphens. Generate high-variance options that natively align with the scenario.`;
  } else if (category === 'quest') {
    const existingCharacters = players?.map(p => `${p.draftParts?.adjective} ${p.draftParts?.archetype} ${p.draftParts?.suffix}`).filter(Boolean).join(', ') || '';
    const archetypeContext = existingCharacters ? ` The characters are rivals: ${existingCharacters}. Generate objectives that are intimately tied to their origins, classes, and traits.` : '';
    
    prompt = `Analyze the scenario: "${theme}". Generate a list of ${count} short-term, localized objectives or personal goals representing a specific state to be achieved.${archetypeContext}
    RULES:
    1. MUST be written in the PASSIVE VOICE. Do NOT start with an action verb. Instead, describe a state that is achieved.
    2. The objectives must include new characters that are not already generated. Do not use proper nouns.
    3. Keep the objective situational and local.
    4. These MUST assume the resulting state occurring, without naming who is doing it or how it is being done. Focus purely on the resulting state.
    5. Ensure a mix of good and selfish outcomes.
    6. Ensure a five word limit.`;
  } else {
    prompt = `Analyze the scenario: "${theme}". Generate a list of ${count} distinct character names.`;
  }

  if (onStatusUpdate) onStatusUpdate(`Drafting ${category} options...`);
  
  const response = await generateWithFallback({
    contents: prompt,
    config: {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: { options: { type: Type.ARRAY, items: { type: Type.STRING } } }
        }
    }
  }, onStatusUpdate);
  
  const json = JSON.parse(cleanJson(response.text || "{}"));
  let optionsList: string[] = [];
  if (json && Array.isArray(json.options)) {
    const seen = new Set<string>();
    for (const opt of json.options) {
      if (opt && typeof opt === 'string') {
        const trimmed = opt.trim();
        if (trimmed && !seen.has(trimmed.toLowerCase())) {
          seen.add(trimmed.toLowerCase());
          optionsList.push(trimmed);
        }
      }
    }
  }

  if (optionsList.length < count) {
    const categoryFallbacks: Record<string, string[]> = {
      archetype: ["Protagonist", "Specialist", "Professional", "Individual", "Figure", "Subject", "Operative"],
      adjective: ["Notable", "Distinct", "Specific", "Particular", "Certain", "Identified", "Selected", "Present"],
      suffix: ["from the area", "of the region", "from the scene", "of the environment", "from nearby", "of the vicinity", "from local origins", "of the sector"],
      quest: [`The primary objective regarding the ${theme} is resolved`, `The critical asset within the ${theme} is secured`, `The central mystery of the ${theme} is revealed`, `The unexpected situation inside the ${theme} is handled`, `The major conflict involving the ${theme} is settled`, `The main obstacle within the ${theme} is overcome`, `The final outcome of the ${theme} is determined`],
      name: ["Character A", "Character B", "Character C", "Character D", "Character E", "Character F", "Character G", "Character H"]
    };

    const fallbacks = categoryFallbacks[category] || categoryFallbacks.name;
    for (const fallback of fallbacks) {
      if (optionsList.length >= count) break;
      if (!optionsList.some(o => o.toLowerCase() === fallback.toLowerCase())) {
        optionsList.push(fallback);
      }
    }

    let index = 1;
    while (optionsList.length < count) {
      optionsList.push(`Mystery ${category} Option ${index++}`);
    }
  }

  if (optionsList.length > count) {
    optionsList = optionsList.slice(0, count);
  }

  return optionsList;
};

// --- SPLIT GAME CONTEXT PROMPTS FOR EASY EDITING ---

export const GAME_CONTEXT_BASE_PROMPT = `Setup a game session for scenario "{scenario}". Players:
{playerSummaries}

Create a starting location name, a description, an overarching thematic storyline/conflict, and a consistent visual description for each player's character.`;

export const GAME_CONTEXT_LOCATION_RULES = `1. The starting location names and features MUST match the tone and reality of the scenario.
2. 'locationDescription' MUST be exactly ONE short sentence (max 15 words) describing the physical visual look of the place.`;

export const GAME_CONTEXT_CONFLICT_RULES = `1. The conflict should be a broad, local tension (1-2 sentences).
2. It must act as a general umbrella situation where all players' diverse goals can naturally intersect.
3. 'conflict' should define a shared background crisis, event, or localized state of affairs, keeping details open-ended.`;

export const GAME_CONTEXT_APPEARANCE_RULES = `1. 'playerAppearances' MUST be an array of detailed visual descriptions (max 35 words) for each player, matching their ID order. Each description MUST explicitly specify the character's skin tone/color, hair color/style, and distinctive clothing style/color. These details are critical to ensure visual consistency in all illustrations generated throughout the game.`;

export const GAME_CONTEXT_GENDER_RULES = `1. MUST strictly enforce the defined gender/pronouns for each character in any generated text.`;

export const generateGameContext = async (
    players: Player[],
    scenario: string,
    onStatusUpdate?: (msg: string) => void
): Promise<{ locationName: string; locationDescription: string; conflict: string; playerAppearances: string[] }> => {
    const playerSummaries = players.map(p => `ID: ${p.id}, ${p.name} (Gender: ${p.gender || 'Unknown'}, Goal/Objective: ${p.goal}, Archetype/Role: ${p.draftParts?.archetype}, Adjective: ${p.draftParts?.adjective})`).join('\n');
    
    const prompt = `
    ${GAME_CONTEXT_BASE_PROMPT.replace("{scenario}", scenario).replace("{playerSummaries}", playerSummaries)}
    
    STRICT LOCATION RULES:
    ${GAME_CONTEXT_LOCATION_RULES}
    
    STRICT CONFLICT RULES:
    ${GAME_CONTEXT_CONFLICT_RULES}
    
    STRICT PLAYER APPEARANCE RULES:
    ${GAME_CONTEXT_APPEARANCE_RULES}
    
    STRICT GENDER RULES:
    ${GAME_CONTEXT_GENDER_RULES}
    `.trim();
    
    if (onStatusUpdate) onStatusUpdate("Forging the world and characters...");

    const response = await generateWithFallback({
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            maxOutputTokens: 8192, 
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    locationName: { type: Type.STRING },
                    locationDescription: { type: Type.STRING },
                    conflict: { type: Type.STRING },
                    playerAppearances: { type: Type.ARRAY, items: { type: Type.STRING } }
                }
            }
        }
    }, onStatusUpdate);

    const json = JSON.parse(cleanJson(response.text || "{}"));
    return {
        locationName: json.locationName || "Starting Venue",
        locationDescription: json.locationDescription || `The starting environment for the ${scenario} story.`,
        conflict: json.conflict || "A central challenge for the characters.",
        playerAppearances: json.playerAppearances || players.map(p => `A ${p.draftParts?.adjective} ${p.draftParts?.archetype}`)
    };
};

export const generateRoundOptions = async (
    history: StorySegment[],
    verbsCount: number,
    nounsCount: number,
    scenario: string,
    players: Player[],
    round: number,
    location: string | undefined,
    conflict: string | undefined,
    phase: string,
    usedNouns: string[],
    usedVerbs: string[],
    onStatusUpdate?: (msg: string) => void
): Promise<{ verbs: string[], nouns: string[] }> => {
    const recentHistory = history.slice(-5).map(h => h.text).join(" ");
    
    const playerPrefixesSuffixes = players.map(p => `[${p.name}: ${p.draftParts?.adjective || ''} ${p.draftParts?.archetype || ''} ${p.draftParts?.suffix || ''}]`.trim()).filter(Boolean).join(' ');
    const playerQuests = players.map(p => `[${p.name}: ${p.goal || ''}]`).join(' ');

    const deadPlayers = players.filter(p => 
        p.conditions?.some(c => 
            c && typeof c === 'string' && (
                c.toLowerCase().includes('dead') || 
                c.toLowerCase().includes('deceased') || 
                c.toLowerCase().includes('killed') || 
                c.toLowerCase().includes('slain')
            )
        )
    );
    const deadNames = deadPlayers.map(p => p.name || p.shortName).filter(Boolean);
    const deadNounsInstructions = deadNames.length > 0 
        ? `CRITICAL EXCLUSION RULE: The following characters are DEAD/KILLED: ${deadNames.join(', ')}. You MUST NOT generate these dead characters, their names, or references to them as possible nouns under any circumstance.` 
        : '';

    const risingActionQuestNounsInstructions = (phase === 'Rising Action' || round === 2)
        ? `CRITICAL REQUIREMENT FOR THE RISING ACTION ROUND: You MUST explicitly include and generate key nouns, physical items, objects, or targets directly from the characters' quests: ${playerQuests} as part of the generated nouns so players can draft and use them to progress their personal stories.`
        : '';

    const usedNounsContext = usedNouns && usedNouns.length > 0 ? `DO NOT generate any of these already used nouns: ${usedNouns.join(', ')}.` : '';
    const usedVerbsContext = usedVerbs && usedVerbs.length > 0 ? `DO NOT generate any of these already used verbs: ${usedVerbs.join(', ')}.` : '';

    const prompt = `Scenario: ${scenario}. Story Phase: "${phase}" (Round ${round} of 5). Location: ${location || "Unknown"}.
    Overarching Storyline: ${conflict || "None"}
    Recent chronicle context: ${recentHistory || "Beginning of the story."}
    ${usedNounsContext}
    ${usedVerbsContext}
    ${deadNounsInstructions}
    ${risingActionQuestNounsInstructions}

    You must generate a set of ${verbsCount} context-appropriate, thematic verbs and ${nounsCount} relevant nouns aligned with the current stage of the story.

    STRICT CUSTOM VERB GENERATION RULES (CRITICAL):
    Create a list of verbs based on the unique characters, quests, location, and the overarching storyline of this exact moment.

    1. "verbs": Must be SINGLE words, in present/infinitive tense. Avoid copying recent verbs. Intentionally bypass repetitive synonyms used in recent turns.
    Obey the following phase-specific verb generation rules:
       - Phase "Introduction" (Round 1): Verbs MUST be derived from the characters' backgrounds [${playerPrefixesSuffixes}] and the elements of the location [${location || "Unknown"}].
       - Phase "Rising Action" (Round 2): Verbs MUST be derived from the characters' backgrounds [${playerPrefixesSuffixes}] and the elements of the location [${location || "Unknown"}]].
       - Phase "The Climax" (Round 3): Verbs MUST be intense climax actions from the characters' unique quests [${playerQuests}].
       - Phases "Resolution" and "Epilogue" (Rounds 4 and 5): Verbs MUST be tailored to cleaning up, examining, or reacting to the events in the narrative history so far (see: Recent chronicle context).

    2. "nouns": Must be thematic short phrases or single words. They MUST strictly be noun phrases or nouns. CRITICAL: Nouns MUST be tangible items or people that natively exist within a "${scenario}" setting at the specified location.
    Obey the following phase-specific noun rules:
       - Phase "Introduction": Nouns MUST be tangible entities conceptually generated from the characters' prefixes (adjectives) and suffixes.
       - Phase "Rising Action": Nouns MUST explicitly be the people from the characters' unique quests [${playerQuests}]. This is the round where quest-related nouns are introduced into play.
       - Phases "The Climax", "Resolution", and "Epilogue": Nouns should be a mix of physical items or people previously mentioned in the recent chronicle context. Do not treat quest nouns as exclusive to this stage — they should now compete equally with all other established elements for inclusion.

    Return JSON matching the schema precisely:
    {
      "verbs": [...],
      "nouns": [...]
    }`;

    if (onStatusUpdate) onStatusUpdate("Preparing round options...");

    const response = await generateWithFallback({
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    verbs: { type: Type.ARRAY, items: { type: Type.STRING } },
                    nouns: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["verbs", "nouns"]
            }
        }
    }, onStatusUpdate);

    const json = JSON.parse(cleanJson(response.text || "{}"));
    let verbs = json.verbs || [];
    let nouns = json.nouns || [];

    // Ensure verbs is an array
    if (!Array.isArray(verbs)) {
        verbs = [];
    }

    // Clean and deduplicate verbs
    let cleanVerbs: string[] = [];
    const seenVerbs = new Set<string>();
    verbs.forEach((v: any) => {
        if (v && typeof v === 'string') {
            const trimmed = v.trim();
            if (trimmed && !seenVerbs.has(trimmed.toLowerCase())) {
                seenVerbs.add(trimmed.toLowerCase());
                cleanVerbs.push(trimmed);
            }
        }
    });

    // If we have fewer verbs than needed, pad with standard verbs
    if (cleanVerbs.length < verbsCount) {
        const fallbackVerbs = ["inspect", "use", "challenge", "negotiate", "explore", "defend", "investigate", "evade"];
        for (const fallback of fallbackVerbs) {
            if (cleanVerbs.length >= verbsCount) break;
            if (!cleanVerbs.some(v => v.toLowerCase() === fallback.toLowerCase())) {
                cleanVerbs.push(fallback);
            }
        }
        let index = 1;
        while (cleanVerbs.length < verbsCount) {
            cleanVerbs.push(`Action${index++}`);
        }
    }

    // If we have more verbs than needed, slice to exactly verbsCount
    if (cleanVerbs.length > verbsCount) {
        cleanVerbs = cleanVerbs.slice(0, verbsCount);
    }

    return { verbs: cleanVerbs, nouns: nouns };
};

export const generateCharacterImage = async (player: Player, scenario: string): Promise<string | undefined> => {
    const genderText = player.gender ? `Gender: ${player.gender}, ` : '';
    const prompt = `Character portrait: ${player.name}, ${genderText}${player.visualDescription || `${player.draftParts?.adjective} ${player.draftParts?.archetype}`}. Scenario: ${scenario}. Style: Digital Art, detailed, historically and logically accurate to the rules of the scenario setting. IMPORTANT: The image must NOT contain any text, words, dialogue bubbles, or lettering of any kind.`;
    return scheduleImageGeneration(prompt);
};

export const generateStoryImage = async (text: string, scenario: string, locationDescription?: string, characters?: Player[]): Promise<string | undefined> => {
    let context = "";
    
    if (characters && characters.length > 0) {
        const activeCharacters = characters.filter(p => text.includes(p.name) || (p.shortName && text.includes(p.shortName)));
        const charsToUse = activeCharacters.length > 0 ? activeCharacters : characters;
        
        context = charsToUse.map(p => {
             const baseDesc = p.visualDescription || `${p.draftParts?.adjective} ${p.draftParts?.archetype}`;
             const conditionText = p.conditions && p.conditions.length > 0 ? ` [Conditions applied: ${p.conditions.join(', ')}]` : '';
             const genderText = p.gender ? `Gender: ${p.gender}, ` : '';
             return `Character portrait: ${p.name}, ${genderText}${baseDesc}${conditionText}. Scenario: ${scenario}. Style: Digital Art, detailed, authentic to the scenario setting.`;
         }).join("\n");
    }

    const prompt = `${context}\n\nBased on the character template(s) above, generate a scene illustration for this event: "${text}"\nSetting: ${locationDescription || "Unknown"}\nCRITICAL VISUAL CONSISTENCY: The characters in this scene MUST look identical to their template descriptions above. Specifically, ensure that each character's skin tone/color, hair color/style, and clothing colors/style are perfectly matched and consistent with their character template. Visual styling must strictly inherit the native realism, environment type, and aesthetic rules of the "${scenario}". IMPORTANT: The image must NOT contain any text, words, dialogue bubbles, or lettering of any kind.`;
    return scheduleImageGeneration(prompt);
};

export const generateVictoryImage = async (winnerName: string, reason: string, scenario: string, visualDescription?: string, conditions?: string[], gender?: string): Promise<string | undefined> => {
    const conditionText = conditions && conditions.length > 0 ? ` [Conditions applied: ${conditions.join(', ')}]` : '';
    const genderText = gender ? `Gender: ${gender}, ` : '';
    const template = `Character portrait: ${winnerName}, ${genderText}${visualDescription || ''}${conditionText}. Scenario: ${scenario}. Style: Digital Art, detailed, authentic to the scenario setting.`;
    const prompt = `${template}\n\nBased on the character template above, generate a cinematic scene illustrating the resolution of the round. Reason: ${reason}. Beautiful lighting, visually consistent with the character portrait and styled appropriately for the core aesthetic of the "${scenario}". Specifically, ensure that the character's skin tone/color, hair color/style, and clothing colors/style are perfectly matched and identical to the template. IMPORTANT: The image must NOT contain any text, words, dialogue bubbles, or lettering of any kind.`;
    return scheduleImageGeneration(prompt);
};

export const generateTurnResult = async (
    history: StorySegment[],
    player: Player,
    subject: string,
    verb: string,
    object: string,
    players: Player[],
    scenario: string,
    location: string | undefined,
    conflict: string | undefined,
    phase: string,
    activeChar: string | undefined,
    prevSummary: string | undefined
): Promise<{ text: string, newEntities: string[], removedEntities: string[], conditionUpdates: ConditionUpdate[], dialogueType: string }> => {
    
    const recentHistory = history.slice(-5).map(h => h.text).join(" ");
    
    const recentDialogueTypes = history.slice(-3).map(h => h.dialogueType).filter(Boolean);
    let typePool = DIALOGUE_TYPES.filter(type => !recentDialogueTypes.includes(type));
    if (typePool.length === 0) {
        typePool = [...DIALOGUE_TYPES];
    }
    
    // Construct the narrative context clearly
    // activeChar is the name of the Character physically performing the action
    // player.name is the name of the Character owned by the User who clicked the button
    const performingCharacterName = activeChar || player.name;

    const performingCharacter = players.find(p => p.name === performingCharacterName);
    const genderContext = performingCharacter?.gender ? ` (Gender: ${performingCharacter.gender})` : '';

    const allPlayersContext = players.map(p => `- ${p.name}: ${p.gender || 'Unknown'} (Class/Role: ${p.draftParts?.archetype || 'Unknown'}, Origin: ${p.draftParts?.suffix || 'Unknown'})${p.conditions && p.conditions.length > 0 ? ` [Current Conditions: ${p.conditions.join(', ')}]` : ''}`).join('\n      ');

    const basePrompt = `
      You are the Narrator for a "${scenario}" story.

      CAST LIST (STRICT SCENARIO ENFORCEMENT):
      ${allPlayersContext}

      CRITICAL RELATIONSHIP CONTEXT: 
Characters in the CAST LIST may be RIVALS, competitors, or enemies. 
They might not help each other unless for a tactical or selfish reason.
    
      CURRENT TURN:
      - Action: "${performingCharacterName}"${genderContext} uses "${subject}" to "${verb}" "${object}".
      - Setting: ${location || "Unknown"}
      - Overarching Storyline: ${conflict || "None"}
      - Story Phase: ${phase}
      - Story So Far: ${prevSummary || "None"}
      - Recent Chronicle Context: ${recentHistory || "None"}

      STRICT NARRATIVE STAGE GUIDANCE for "${phase}":
      - "Introduction": Frame the start of the journey alongside the players' actions. Connect their actions to the overarching storyline.
      - "Rising Action": Build the stakes and tension relating the players' actions to the unfolding overarching storyline.
      - "The Climax": This is the peak of high-stakes tension! The overarching storyline reaches its fever pitch. Let actions feel epic, critical, and have direct high-stakes consequences based on the narrative built so far.
      - "Resolution": The aftermath of the overarching storyline.
      - "Epilogue": A sense of closure, final thoughts, and setting up the long-term impact on the world after the overarching storyline is resolved.

      STRICT WRITING RULES:
      1. Write a paragraph of EXACTLY three sentences. Write in the past tense. At least one of the sentences is narration describing how "${performingCharacterName}" executes this specific action.
      
      STRICT CHARACTER PRESENCE RULE:
      Dialogue must always occur between exactly two characters: "${performingCharacterName}" and one other. If no second character is already present or relevant to the scene, the narration must introduce a plausible bystander, companion, or nearby figure (e.g. a passerby, a guard, a companion already implied by the setting) for "${performingCharacterName}" to speak to or be heard by. This second character does not need to speak back within these three sentences, but their presence as the addressee or listener must be clear from the narration.

      STRICT DIALOGUE RULES:
      (a) You MUST pick exactly one dialogue type from this available pool: ${typePool.join(", ")}. You must report this chosen type in the 'dialogue_type' field.
      (b) The dialogue sentence must take the form of your chosen type:
          - threat: A menacing promise of harm or consequences.
          - question: An inquiry seeking information or challenging someone.
          - boast: A proud or arrogant statement of one's own abilities.
          - order: A direct command or instruction.
          - plea: An urgent or emotional request.
          - taunt: A mocking or insulting remark intended to provoke.
          - confession: An admission of a secret, fault, or vulnerability.
          - observation: A remark noting something about the environment or situation.
          - warning: A caution about imminent danger.
          - joke: A humorous or sarcastic comment.
          - demand: A forceful request leaving no room for refusal.
          - lie: A deliberate falsehood or deception.
          - aside: A private thought spoken aloud or muttered to oneself.
      (c) Sentence order and structural distribution between narrative prose and dialogue must be governed strictly by physical character motion and natural pacing, varying dynamically based on action density.
      
      2. TARGETING RIVALS: If the action targets another character from the CAST LIST, the outcome may be competitive, detrimental, or antagonistic to the target. The target may suffer a disadvantage, physical setback, or narrative obstacle.
      3. ADAPT TO SCENARIO: Ground all descriptions entirely within the native reality, physical laws, established logic, and typical stakes of a "${scenario}" setting. 
      4. PHYSICAL PROGRESSION: Every turn should change something in the immediate environment or force characters to shift their physical position.
      5. CRITICALLY AVOID NARRATIVE LOOPS: Look at the previous context. Do not let characters repeat the same actions or get stuck at the exact same location/obstacle. Each turn MUST move the global story line clearly and progressively forward.
      6. DO NOT write meta-commentary, game mechanics ("rolls", "turns", "players"), or conclude the final story within an early phase.
      7. NEVER use the real-life names of the players (if you happen to know them). ONLY use the character names provided in the CAST LIST.
      8. CURRENT CONDITIONS: Characters may have active conditions listed in the CAST LIST. Current conditions should effect the narrative.
      9. ENTRANCES AND EXITS: If a character is mentioned or acts for the very first time in the story (they do not appear in the Story So Far or Recent Chronicle Context), the narration MUST describe them entering the location. During the "Epilogue" phase, the narration MUST describe the acting character leaving the location to conclude their journey.
    `;

    // Strategy 1: Attempt Structured JSON Generation
    try {
        const jsonPrompt = `
            ${basePrompt}

            Generate a JSON response with:
            - 'story_text': The narrative paragraph.
            - 'new_entities': Array of strings (new items/places introduced).
            - 'removed_entities': Array of strings (items that leave play).
            - 'condition_updates': Array of objects { characterName: string, condition: string, type: 'add' | 'remove' }. EXPLICIT COMMAND: If a character targets someone, you MUST apply a concrete status condition tag. IMPORTANT: If an action logically removes, cures, or resolves an existing condition from a character, you MUST output a 'remove' update for that condition.
            - 'dialogue_type': The type of dialogue you chose (must be one of the types from the pool).
        `;

        const response = await generateWithFallback({
            contents: jsonPrompt,
            config: {
                maxOutputTokens: 8192, 
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        story_text: { type: Type.STRING },
                        new_entities: { type: Type.ARRAY, items: { type: Type.STRING } },
                        removed_entities: { type: Type.ARRAY, items: { type: Type.STRING } },
                        condition_updates: { 
                            type: Type.ARRAY, 
                            items: { 
                                type: Type.OBJECT,
                                properties: {
                                    characterName: { type: Type.STRING },
                                    condition: { type: Type.STRING },
                                    type: { type: Type.STRING, enum: ['add', 'remove'] }
                                }
                            } 
                        },
                        dialogue_type: { type: Type.STRING, enum: typePool }
                    },
                    required: ["story_text", "dialogue_type"]
                }
            }
        });

        // Robust JSON Parsing
        let json: any = {};
        try {
            const raw = response.text || "{}";
            const cleaned = cleanJson(raw);
            json = JSON.parse(cleaned);
        } catch (parseError) {
            console.warn("JSON Parse failed on turn result, trying text fallback.");
            throw new Error("JSON_PARSE_FAILED");
        }

        // Validate content
        if (!json.story_text || json.story_text.length < 10) {
            throw new Error("EMPTY_STORY_TEXT");
        }

        return {
            text: json.story_text,
            newEntities: json.new_entities || [],
            removedEntities: json.removed_entities || [],
            conditionUpdates: json.condition_updates || [],
            dialogueType: json.dialogue_type || typePool[0]
        };

    } catch (e) {
        console.warn("Structured generation failed or was empty. Falling back to Text-Only mode to save the narrative.", e);

        // Strategy 2: Text-Only Fallback (Rescue Mode)
        // If JSON fails (schema issues, hallucinations, refusal), ask for just the story.
        // This ensures the game doesn't break or show generic fallback text.
        const rescuePrompt = `
            ${basePrompt}
            
            IMPORTANT: The previous attempt to generate structured data failed. 
            TASK: Ignore all JSON requirements. Just write the story paragraph for the action above.
        `;

        try {
            const rescueResponse = await generateWithFallback({
                contents: rescuePrompt,
                config: {
                    maxOutputTokens: 8192,
                    responseMimeType: "text/plain"
                }
            });

            return {
                text: rescueResponse.text || `${performingCharacterName} acts, but the immediate outcome remains unclear.`,
                newEntities: [],
                removedEntities: [],
                conditionUpdates: [],
                dialogueType: typePool[0]
            };
        } catch (finalError) {
             // Absolute last resort
             return {
                text: `${performingCharacterName} uses ${subject} to ${verb} ${object}, but the narrator is silent.`,
                newEntities: [],
                removedEntities: [],
                conditionUpdates: [],
                dialogueType: typePool[0]
            };
        }
    }
};

export const evaluateRound = async (
    roundSegments: StorySegment[],
    players: Player[],
    scenario: string,
    phase: string,
    activeConflict: string | undefined
): Promise<{ winnerId: string | null; reason: string }> => {
    const segmentsText = roundSegments.map(s => s.text).join("\n");
    // Pass IDs explicitly to prompt so AI knows what to return
    const playersList = players.map(p => `ID: "${p.id}" | Name: "${p.name}" | Short Name: "${p.shortName || ''}" | Gender: "${p.gender || 'Unknown'}" | Class/Role: "${p.draftParts?.archetype || 'Unknown'}" | Origin/Title: "${p.draftParts?.suffix || 'Unknown'}" | Personal Quest/Goal: "${p.goal}"`).join("\n");
    
    const prompt = `Scenario: ${scenario}. Phase: ${phase}. Events: ${segmentsText}. 
    Players:
    ${playersList}
    Central Overarching Conflict (IGNORE FOR SCORING): ${activeConflict || 'None'}
    
    Task: Evaluate the story events of this round and determine which player's Personal Quest (listed under 'Personal Quest/Goal' above) was most progressed or successfully worked towards.
    If NO Personal Quest was progressed, you MUST pick the quest which now has the most potential to be progressed in the near future because of the actions in this round.

    CRITICAL RESTRICTIONS: 
    1. Score based on the OUTCOME, NOT on who performed the action. A quest can be progressed by another character's actions, environmental events, or accidents. Award the win to the player whose quest advanced the most, DESPITE who actually performed the actions in the round.
    2. PAY ATTENTION TO WHO IS WHO. Quests sometimes reference a Class/Role, item, or specific character type. You MUST carefully determine if the event satisfied THAT specific personal quest based on the details. Do NOT mistakenly credit a character simply because they performed an action; the outcome MUST match their literal quest description.
    3. The Central Overarching Conflict MUST NOT influence the adjudication, nor should it favour any one personal quest. Ignore any action that only advances the central plot in favor of actions that advance a personal quest.
    4. You MUST return the EXACT UUID string from the 'ID' field of the winning player for the 'winnerId' field. DO NOT return a name.
    5. 'reason' must be a single sentence explaining how the round's events progressed towards achieving that specific Personal Quest, or setup to potentially progress the quest in the near future. Focus purely on how the event shifted the world/narrative closer to the quest state, rather than who performed the action.
    
    Return JSON { "winnerId": "uuid-string", "reason": "..." }`;

    const response = await generateWithFallback({
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    winnerId: { type: Type.STRING },
                    reason: { type: Type.STRING }
                },
                required: ["winnerId", "reason"]
            }
        }
    });
    
    const json = JSON.parse(cleanJson(response.text || "{}"));
    
    let finalWinnerId = json.winnerId;
    let finalReason = json.reason;

    // Translate winnerId from character name/shortName/playerName to exact UUID if needed
    if (finalWinnerId) {
        const cleanedWinnerId = String(finalWinnerId).trim().toLowerCase();
        const matchedPlayer = players.find(p => {
            const pId = p.id.toLowerCase();
            const pName = p.name ? p.name.toLowerCase() : '';
            const pShort = p.shortName ? p.shortName.toLowerCase() : '';
            const pPlayName = p.playerName ? p.playerName.toLowerCase() : '';
            
            // Exact ID match is best
            if (pId === cleanedWinnerId || cleanedWinnerId.includes(pId)) return true;
            // Name matches (exact)
            if (pName && cleanedWinnerId === pName) return true;
            if (pShort && cleanedWinnerId === pShort) return true;
            if (pPlayName && cleanedWinnerId === pPlayName) return true;
            
            // Only do includes on names if the name is reasonably long to avoid false positives (e.g. 'a' matching 'adam')
            if (pName && pName.length > 3 && cleanedWinnerId.includes(pName)) return true;
            if (pShort && pShort.length > 3 && cleanedWinnerId.includes(pShort)) return true;
            
            return false;
        });

        if (matchedPlayer) {
            finalWinnerId = matchedPlayer.id;
        } else {
            finalWinnerId = null;
        }
    }

    // FALLBACK 1: AI returned nothing or invalid ID. Pick the last player who acted.
    if (!finalWinnerId && roundSegments.length > 0) {
        const lastSegment = roundSegments[roundSegments.length - 1];
        finalWinnerId = lastSegment.playerId;
        // If we have to force a winner, use their action as the reason
        finalReason = `Their action "${lastSegment.action}" resonated most with the unfolding chaos.`;
    }

    // FALLBACK 2: AI returned a Winner ID, but forgot the Reason (Fixes "The tides of fate...")
    if (finalWinnerId && !finalReason) {
        const winningSegment = roundSegments.find(s => s.playerId === finalWinnerId);
        if (winningSegment) {
            finalReason = `For their decisive move: "${winningSegment.action}".`;
        } else {
            finalReason = "For seizing the moment.";
        }
    }

    return { 
        winnerId: finalWinnerId || null, 
        reason: finalReason || "The situation develops unpredictably." 
    };
};

export const determineWinner = async (
    history: StorySegment[],
    players: Player[],
    scenario: string,
    winner: Player | undefined
): Promise<{ title: string; reason: string }> => {
    const storyChronicle = history.map((s, idx) => {
        const player = players.find(p => p.id === s.playerId);
        const name = s.characterName || (player ? player.name : 'Narrator');
        return `Segment ${idx+1} [${name}]: ${s.text}`;
    }).join("\n\n");
    const prompt = `Scenario: ${scenario}.
Winner Character Name: ${winner?.name}
Winner Character Gender: ${winner?.gender || 'Unknown'}
Winner Character Class/Role: ${winner?.draftParts?.archetype || 'Unknown'}
Winner Character Origin: ${winner?.draftParts?.suffix || 'Unknown'}
Winner Character Goal/Quest: ${winner?.goal}

Below is the complete chronicle of all story segments generated during the game:
================================================================================
${storyChronicle}
================================================================================

Your task is to write:
1. A short, thematic, final title for this complete story (maximum 6 words). DO NOT write meta-commentary.
2. A definitive, in-universe conclusion of EXACTLY one sentence that weaves together the story events, explaining exactly how the victor, ${winner?.name || 'the character'}, completed their personal quest ("${winner?.goal}") and established their grand legacy. Write this as a satisfying, narrative finish to the tale. Do not use wordy meta-commentary.

Return JSON matching the schema precisely:
{
  "title": "...",
  "reason": "..."
}`;
    
    const response = await generateWithFallback({
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING },
                    reason: { type: Type.STRING }
                },
                required: ["title", "reason"]
            }
        }
    });
    const json = JSON.parse(cleanJson(response.text || "{}"));
    return { title: json.title || "The Forgotten Tale", reason: json.reason || "And so it ends." };
};

export const generateRoundSummary = async (
    roundSegments: StorySegment[],
    scenario: string
): Promise<string> => {
     const text = roundSegments.map(s => s.text).join(" ");
     const prompt = `Summarize these events in one concise paragraph. Scenario: ${scenario}. Events: ${text}`;
     const response = await generateWithFallback({ contents: prompt });
     return response.text || "Events unfolded.";
};

export const generateSpeech = async (text: string): Promise<string | undefined> => {
    try {
        const response = await callGenerateContent({
            model: TTS_MODEL,
            contents: [{ parts: [{ text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } }
                }
            }
        });
        const audioPart = response.candidates?.[0]?.content?.parts?.[0];
        if (audioPart && audioPart.inlineData) {
            return audioPart.inlineData.data;
        }
        return undefined;
    } catch (e) {
        console.error("TTS failed", e);
        return undefined;
    }
};

export const generateBallad = async (
    scenario: string,
    history: StorySegment[],
    winner?: Player | null
): Promise<{ audioUrl: string, lyrics: string } | undefined> => {
    try {
        const text = history.map((s) => s.text).join(" ");
        const winnerFocus = winner 
            ? ` CRITICAL REQUIREMENT: The ballad lyrics, theme, and praise MUST focus entirely on the victor/winner, ${winner.name} (${winner.draftParts?.adjective || ''} ${winner.draftParts?.archetype || ''} ${winner.draftParts?.suffix || ''}). Even if their personal quest ("${winner.goal}") involved elevating or helping another character, the ballad MUST praise ${winner.name} as the hero for accomplishing it, not the other character.` 
            : '';
        const prompt = `Scenario: ${scenario}.${winnerFocus} Create a 30-second thematic audio track summarizing the following narrative sequence. Ensure the music style matches the scenario: ${text}`;
        
        const data = await callGenerateMusic(prompt);

        if (!data.audioBase64 && !data.lyrics) {
            return undefined;
        }
        
        let audioUrl = "";
        if (data.audioBase64) {
            const binary = atob(data.audioBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: data.mimeType || 'audio/wav' });
            audioUrl = URL.createObjectURL(blob);
        }
        
        return { audioUrl, lyrics: data.lyrics };
    } catch (e) {
        console.error("Ballad generation failed", e);
        return undefined;
    }
};