const fs = require('fs');

let content = fs.readFileSync('services/geminiService.ts', 'utf8');

content = content.replace(
/    const useSearch = attempt === 1 && !searchFailed;/,
`    const useSearch = false; // Disable search completely for faster response`
);

fs.writeFileSync('services/geminiService.ts', content);
