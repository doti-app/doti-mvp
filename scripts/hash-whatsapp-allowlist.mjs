#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

const hashes = new Set();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });

for await (const rawLine of input) {
  const phone = rawLine.trim();
  if (!phone) continue;
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) {
    process.stderr.write('Entrada inválida: use um número E.164 por linha.\n');
    process.exitCode = 1;
    continue;
  }
  hashes.add(createHash('sha256').update(phone, 'utf8').digest('hex'));
}

if (!process.exitCode) {
  process.stdout.write(`${JSON.stringify([...hashes], null, 2)}\n`);
}
