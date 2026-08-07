import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const sourceRoot = join(root, 'src');
const failures = [];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

for (const directory of ['app', 'shared', 'domains', 'styles']) {
  if (!existsSync(join(sourceRoot, directory))) failures.push(`src/${directory} está ausente.`);
}

if (!failures.length) {
  for (const file of sourceFiles(sourceRoot)) {
    const source = readFileSync(file, 'utf8');
    const display = relative(root, file);
    if (source.includes('@ts-nocheck')) failures.push(`${display} não pode desativar a checagem de tipos.`);
    if (source.includes('dotiAuthContext') || source.includes('doti:auth-ready')) {
      failures.push(`${display} não pode depender do contrato global de autenticação legado.`);
    }
    if (/from\s+['"][^'"]*\?v=|import\(\s*['"][^'"]*\?v=/.test(source)) {
      failures.push(`${display} contém cache-busting manual em import.`);
    }
    if (display.startsWith('src/shared/') && /(?:\.\.\/)+(?:app|domains)\//.test(source)) {
      failures.push(`${display} não pode importar app ou domínios.`);
    }
  }
}

for (const legacy of ['app.js', 'core', 'domains']) {
  if (existsSync(join(root, legacy))) failures.push(`${legacy} é uma localização legada e não deve conter código-fonte.`);
}

for (const entry of ['index.html', 'dot-admin/index.html', 'doti/index.html']) {
  const source = readFileSync(join(root, entry), 'utf8');
  if (/\?v=\d+/.test(source)) failures.push(`${entry} contém cache-busting manual.`);
}

if (failures.length) {
  console.error(`Falha de arquitetura:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Arquitetura verificada: ${sourceFiles(sourceRoot).length} módulos em src/.`);
}
