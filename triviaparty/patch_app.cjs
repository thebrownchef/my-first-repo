const fs = require('fs');
let content = fs.readFileSync('App.tsx', 'utf8');

const regex = /if \(nextDiff && \(\!bufferedQuestion \|\| bufferedQuestion\.diff \!\=\= nextDiff\)\) \{/;
if (regex.test(content)) {
    content = content.replace(regex, `if (nextDiff) { prefetchTriviaQuestion(genre, nextDiff); if (!bufferedQuestion || bufferedQuestion.diff !== nextDiff) {`);
    
    // We need to add one more closing brace. 
    // It's followed by:
    //              if (fetchingDiff !== nextDiff) { ... }
    //           }
    //        }
    const regex2 = /return \(\) \=\> clearTimeout\(timer\);\n             \}\n          \}/;
    content = content.replace(regex2, "return () => clearTimeout(timer);\n             }\n          }\n          }");
    
    fs.writeFileSync('App.tsx', content);
    console.log("Patched successfully via regex");
} else {
    console.log("Regex not found");
}
