const fs = require('fs');

let content = fs.readFileSync('services/geminiService.ts', 'utf8');

content = content.replace(
/            \.\.\.\(useSearch && \{ tools: \[\{ googleSearch: \{\} \}\] \} \)/,
`            ...(useSearch ? { tools: [{ googleSearch: {} }] } : {})`
);

fs.writeFileSync('services/geminiService.ts', content);
