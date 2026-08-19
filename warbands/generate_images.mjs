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

const charsPath = './src/data/characters.json';
const weaponsPath = './src/data/weapons.json';
const chars = JSON.parse(fs.readFileSync(charsPath, 'utf8'));
const weapons = JSON.parse(fs.readFileSync(weaponsPath, 'utf8'));

fs.mkdirSync('./src/assets/portraits', { recursive: true });
fs.mkdirSync('./src/assets/icons', { recursive: true });
fs.mkdirSync('./src/assets/weapons', { recursive: true });
fs.mkdirSync('./src/assets/terrains', { recursive: true });
fs.mkdirSync('./src/assets/obstacles', { recursive: true });
fs.mkdirSync('./src/assets/grounds', { recursive: true });

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
  const artStyle = "Heroic, thrilling, grim dark gothic fantasy aesthetic illustration, epic and highly dynamic action framing, dramatic low-key lighting, muted earthy color palette. The central subject is engaged in combat with a maximum of two background enemies and is clearly winning the confrontation. Painterly brushwork, square aspect ratio. NO crowded scenes, NO cluttered streets, NO large armies, NO open battlefields, NO wide-scale warfare.";
  
  const subjects = {
    "fanatic": "a wild-eyed zealot in ragged robes wielding a sword and crackling flying embers",
    "spy": "a hooded rogue with a scarred face, dark leather garb, holding a sword and a sling",
    "ranger": "a weathered scout with a hood, armed with a club and a sling",
    "sentinel": "an armored guard wielding a sword and a buckler, watchful stance",
    "scout": "a lightly-armored youth with a satchel, carrying a sword and a sling, alert expression",
    "cultist": "a robed figure with arcane markings holding a spear and crackling flying embers, unsettling calm, vibrant magical effects, dark eerie glowing energy, high-fantasy atmospheric elements",
    "druid": "a nature-worn figure wielding a club and swirling flying embers, antlers or vines woven into hair, vibrant magical effects, swirling glowing natural energy, high-fantasy atmospheric elements",
    "priest": "a solemn cleric in tattered holy vestments, holding a burning fire brand and a buckler, vibrant magical effects, radiant glowing holy energy, high-fantasy atmospheric elements",
    "mage": "a hollow-eyed spellcaster casting a scorching ray, glowing runes on their hands, vibrant magical effects, bright crackling arcane energy, high-fantasy atmospheric elements",
    "berserker": "a scarred brute with wild hair and crude tattoos, wielding a battleaxe",
    "knight": "a stern armored warrior with a dented helm, holding a spear and a buckler",
    "assassin": "a masked figure holding a drawn bow, cold eyes",
    "warrior": "a hardened fighter with battle-worn armor wielding a battleaxe",
    "guard": "a stoic soldier with a club and a buckler, grim expression",
    "bulwark": "a heavyset defender in thick plate holding a tower shield, immovable stance"
  };

  const iconStyle = "Bold flat heraldic emblem icon, thick dark outline, high contrast, 2-3 color limited palette, simple symbolic silhouette, no fine detail, plain solid dark background, centered composition, square aspect ratio.";
  const iconSubjects = {
    "fanatic": "a stylized sword crossed with a flying ember emblem",
    "spy": "a sword crossed with a loaded sling emblem",
    "ranger": "a club crossed with a loaded sling emblem",
    "sentinel": "a sword crossed over a small buckler emblem",
    "scout": "a sword and sling emblem",
    "cultist": "a long spear crossed with a flying ember emblem",
    "druid": "a wooden club crossed with a flying ember emblem",
    "priest": "a burning fire brand crossed over a buckler emblem",
    "mage": "a glowing scorching ray beam emblem",
    "berserker": "a battleaxe emblem with a jagged edge",
    "knight": "a spear crossed over a buckler emblem",
    "assassin": "a drawn bow and arrow emblem",
    "warrior": "a single battleaxe emblem",
    "guard": "a wooden club crossed over a buckler emblem",
    "bulwark": "a massive rectangular tower shield emblem"
  };
  
  const wpnStyle = "Single medieval weapon rendered in isolation, dark fantasy item-icon style, dramatic rim lighting, plain dark background, slight painterly texture but clean simple silhouette, square aspect ratio.";
  const arcanaWpnStyle = "Single magical item, spell effect, or ethereal artifact rendered in isolation, glowing with magical energy, swirling ethereal effects, dark fantasy item-icon style, dramatic rim lighting, plain dark background, slight painterly texture but clean simple silhouette, square aspect ratio.";
  
  const terrainStyle = "Top-down view of a single grid square of terrain, grim dark fantasy tabletop RPG map tile, top-down perspective, high detail, muted earthy color palette, square aspect ratio, seamless blending edges.";
  const terrainSubjects = {
    "rubble": "crumbled stone blocks, broken masonry, scattered loose rocks, ruined temple floor",
    "undergrowth": "a dense tangle of bright green thorny vines, thick overgrown briars and brambles, chaotic twisted roots completely covering the ground, highly textured and difficult to traverse, visually distinct from normal ground",
    "debris": "splintered wood, broken cart wheels, muddy scattered wreckage, ruined village ground"
  };

  const obstacleStyle = "Top-down view of a solid impassable obstacle, grim dark fantasy tabletop RPG map tile, top-down perspective, high detail, muted earthy color palette, square aspect ratio.";
  const obstacleSubjects = {
    "ruined_chapel": "a massive broken stone pillar, gothic architectural ruins, impassable structure",
    "dense_forest": "a single, massive impenetrable ancient tree trunk occupying the entire square, thick solid dark wood, tall impassable barrier, towering obstacle, high contrast",
    "ruined_village": "a collapsed stone wall section, burnt wooden beams, impassable ruined house corner"
  };

  const groundStyle = "Top-down view of a seamless ground texture for a grid square, grim dark fantasy tabletop RPG map tile, top-down perspective, high detail, muted earthy color palette, square aspect ratio, seamless blending edges.";
  const groundSubjects = {
    "ruined_chapel": "smooth dark stone floor tiles, cracked cathedral paving, dusty marble",
    "dense_forest": "a plain flat dirt path in a forest, smooth brown soil, very sparse fallen leaves, flat and clear easy to walk on, no obstacles, no roots, visually empty and flat",
    "ruined_village": "muddy cobblestones, trampled dirt, scattered straw, drab town square"
  };

  const promises = [];

  for (const c of chars) {
    if (subjects[c.id]) promises.push(() => generateImage(`${artStyle} ${subjects[c.id]}`, `./src/assets/portraits/${c.id}.png`));
    if (iconSubjects[c.id]) promises.push(() => generateImage(`${iconStyle} ${iconSubjects[c.id]}`, `./src/assets/icons/${c.id}.png`));
  }
  
  for (const w of weapons) {
    const style = w.requirement === 'arcana' ? arcanaWpnStyle : wpnStyle;
    promises.push(() => generateImage(`${style} ${w.name}`, `./src/assets/weapons/${w.id}.png`));
  }

  for (const [key, prompt] of Object.entries(terrainSubjects)) {
    for (let i = 1; i <= 3; i++) {
      promises.push(() => generateImage(`${terrainStyle} ${prompt} Variation ${i}`, `./src/assets/terrains/${key}_${i}.png`));
    }
  }

  for (const [key, prompt] of Object.entries(obstacleSubjects)) {
    for (let i = 1; i <= 3; i++) {
      promises.push(() => generateImage(`${obstacleStyle} ${prompt} Variation ${i}`, `./src/assets/obstacles/${key}_${i}.png`));
    }
  }

  for (const [key, prompt] of Object.entries(groundSubjects)) {
    for (let i = 1; i <= 3; i++) {
      promises.push(() => generateImage(`${groundStyle} ${prompt} Variation ${i}`, `./src/assets/grounds/${key}_${i}.png`));
    }
  }

  console.log(`Total images to generate: ${promises.length}`);
  
  // process in batches of 5
  let index = 0;
  while (index < promises.length) {
    const batch = promises.slice(index, index + 5);
    await Promise.all(batch.map(p => typeof p === 'function' ? p() : p));
    index += 5;
    console.log(`Processed ${Math.min(index, promises.length)}/${promises.length} images...`);
  }
}
run();
