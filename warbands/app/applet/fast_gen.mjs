import { GoogleGenAI } from "@google/genai";
import fs from "fs";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

async function generateImage(prompt, outPath, aspectRatio = "1:1") {
  if (fs.existsSync(outPath)) {
    console.log(`Already exists: ${outPath}`);
    return;
  }
  
  console.log(`Generating: ${outPath} ...`);
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image',
      contents: {
        parts: [
          { text: `${prompt} Aspect ratio: ${aspectRatio}` },
        ],
      },
      config: {
        responseModalities: ["IMAGE"]
      }
    });
    
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        const base64EncodeString = part.inlineData.data;
        fs.writeFileSync(outPath, Buffer.from(base64EncodeString, 'base64'));
        console.log(`Saved ${outPath}`);
        return;
      }
    }
    console.log(`No image returned for ${outPath}`);
  } catch(e) {
    console.error(`Error generating ${outPath}:`, e.message);
  }
}

async function run() {
  fs.mkdirSync('./public/assets/terrains', { recursive: true });
  fs.mkdirSync('./public/assets/obstacles', { recursive: true });
  fs.mkdirSync('./public/assets/grounds', { recursive: true });

  const terrainStyle = "Top-down view of a single grid square of terrain, grim dark fantasy tabletop RPG map tile, top-down perspective, high detail, muted earthy color palette, square aspect ratio, seamless blending edges.";
  const terrainSubjects = {
    "rubble": "crumbled stone blocks, broken masonry, scattered loose rocks, ruined temple floor",
    "undergrowth": "dense tangled roots, thorny vines, dark green moss, shadowy forest floor",
    "debris": "splintered wood, broken cart wheels, muddy scattered wreckage, ruined village ground"
  };

  const obstacleStyle = "Top-down view of a solid impassable obstacle, grim dark fantasy tabletop RPG map tile, top-down perspective, high detail, muted earthy color palette, square aspect ratio.";
  const obstacleSubjects = {
    "ruined_chapel": "a massive broken stone pillar, gothic architectural ruins, impassable structure",
    "dense_forest": "a huge gnarled ancient tree trunk, thick impenetrable roots, dense dark wood",
    "ruined_village": "a collapsed stone wall section, burnt wooden beams, impassable ruined house corner"
  };

  const groundStyle = "Top-down view of a seamless ground texture for a grid square, grim dark fantasy tabletop RPG map tile, top-down perspective, high detail, muted earthy color palette, square aspect ratio, seamless blending edges.";
  const groundSubjects = {
    "ruined_chapel": "smooth dark stone floor tiles, cracked cathedral paving, dusty marble",
    "dense_forest": "dark soil, fallen brown leaves, patchy moss, dirt path",
    "ruined_village": "muddy cobblestones, trampled dirt, scattered straw, drab town square"
  };

  const promises = [];

  for (const [key, prompt] of Object.entries(terrainSubjects)) {
    for (let i = 1; i <= 3; i++) {
      promises.push(generateImage(`${terrainStyle} ${prompt} Variation ${i}`, `./public/assets/terrains/${key}_${i}.png`));
    }
  }

  for (const [key, prompt] of Object.entries(obstacleSubjects)) {
    for (let i = 1; i <= 3; i++) {
      promises.push(generateImage(`${obstacleStyle} ${prompt} Variation ${i}`, `./public/assets/obstacles/${key}_${i}.png`));
    }
  }

  for (const [key, prompt] of Object.entries(groundSubjects)) {
    for (let i = 1; i <= 3; i++) {
      promises.push(generateImage(`${groundStyle} ${prompt} Variation ${i}`, `./public/assets/grounds/${key}_${i}.png`));
    }
  }
  
  // process in batches of 5
  while (promises.length > 0) {
    const batch = promises.splice(0, 5);
    await Promise.all(batch);
  }
}
run();
