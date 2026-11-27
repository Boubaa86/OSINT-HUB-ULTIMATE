import { writeFile } from 'node:fs/promises';

const raw = process.env.OSINT_API_BASE_URL;
if (!raw) throw new Error('OSINT_API_BASE_URL doit être configurée pour le Static Site.');

let apiUrl;
try {
  apiUrl = new URL(raw);
} catch {
  throw new Error('OSINT_API_BASE_URL doit être une URL valide.');
}
if (apiUrl.protocol !== 'https:' || apiUrl.username || apiUrl.password) {
  throw new Error('OSINT_API_BASE_URL doit être une URL HTTPS publique sans identifiants.');
}

const config = {
  apiBase: apiUrl.origin
};
const output = `window.OSINT_CONFIG = Object.freeze(${JSON.stringify(config)});\n`;
await writeFile(new URL('../public/config.js', import.meta.url), output, 'utf8');
console.log('Configuration du frontend statique générée.');
