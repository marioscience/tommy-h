import fs from 'fs/promises';

const files = [
  'frontend/public/index.html',
  'frontend/public/hosting-fivem.html',
  'frontend/public/creadores.html'
];

const replacements = [
  {
    from: ` onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color='var(--muted)'"`,
    to: ' data-rn-hover="primary"'
  },
  {
    from: ` onmouseover="this.style.color='white'" onmouseout="this.style.color='rgba(255,255,255,0.7)'"`,
    to: ' data-rn-hover="white"'
  },
  {
    from: ` onmouseover="this.style.transform='translateY(-10px)'" onmouseout="this.style.transform='none'"`,
    to: ' data-rn-hover="lift"'
  }
];

let changed = 0;
for (const file of files) {
  let source = await fs.readFile(file, 'utf8');
  for (const { from, to } of replacements) {
    const occurrences = source.split(from).length - 1;
    if (occurrences) {
      source = source.split(from).join(to);
      changed += occurrences * 2;
    }
  }
  await fs.writeFile(file, source);
}

for (const file of files) {
  const source = await fs.readFile(file, 'utf8');
  for (const { from } of replacements) {
    if (source.includes(from)) throw new Error(`Inline hover handler remains in ${file}`);
  }
}

console.log(`Migrated ${changed} inline hover handlers to CSS.`);
