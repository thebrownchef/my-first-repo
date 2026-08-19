const fs = require('fs');
const files = [
  'src/components/DeploymentUI.tsx',
  'src/components/Grid.tsx',
  'src/components/SidePanel.tsx',
  'src/components/WarbandBuilder.tsx'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/<img /g, '<img referrerPolicy="no-referrer" ');
  fs.writeFileSync(file, content);
}
