import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY is not defined in the environment.");
  } else {
    console.log("Found API Key, starts with:", apiKey.substring(0, 4), "length:", apiKey.length);
  }
  const ai = new GoogleGenAI({
    apiKey: apiKey || '',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  app.post("/api/generateContent", async (req, res) => {
    try {
      const response = await ai.models.generateContent(req.body);
      
      // Serialize response parts (sometimes complex objects inside response)
      // The response from GoogleGenAI is typically plain objects, but to ensure
      // it serializes back properties like `text` we can map them.
      let text = '';
      try {
        text = response.text || '';
      } catch (e) {
        // text getter might throw if empty
      }
      res.json({
        text,
        candidates: response.candidates,
      });
    } catch (error: any) {
      let statusCode = 500;
      if (error && error.status === 429) statusCode = 429;
      if (error && error.message && (error.message.includes("429") || error.message.includes("quota") || error.message.includes("RESOURCE_EXHAUSTED"))) statusCode = 429;
      
      if (statusCode === 429) {
        console.warn("[generateContent] Warn: Quota exceeded (429).");
      } else {
        console.error("[generateContent] Error:", error.message || error);
      }
      
      res.status(statusCode).json({ error: error.message || "Internal Server Error", details: error });
    }
  });

  app.post("/api/generateMusic", async (req, res) => {
    try {
      const responseStream = await ai.models.generateContentStream({
        model: "lyria-3-clip-preview",
        contents: req.body.prompt,
        config: {
          responseModalities: ["AUDIO"],
        }
      });

      let audioBuffers: Buffer[] = [];
      let lyrics = "";
      let mimeType = "audio/wav";

      for await (const chunk of responseStream) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;

        for (const part of parts) {
          if (part.inlineData && part.inlineData.data) {
            if (audioBuffers.length === 0 && part.inlineData.mimeType) {
              mimeType = part.inlineData.mimeType;
            }
            audioBuffers.push(Buffer.from(part.inlineData.data, "base64"));
          }
          if (part.text) {
            lyrics += part.text;
          }
        }
      }

      const audioBase64 = audioBuffers.length > 0 ? Buffer.concat(audioBuffers).toString("base64") : "";

      res.json({
        audioBase64,
        lyrics,
        mimeType
      });
    } catch (error: any) {
      console.error("[generateMusic] Error:", error.message || error);
      res.status(500).json({ error: error.message || "Internal Server Error", details: error });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
