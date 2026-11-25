#!/usr/bin/env node
/**
 * Generates prisma/schema.prisma from the shared resource registry, so the database schema,
 * API validation, OpenAPI document and web forms can never drift apart.
 *
 *   node apps/api/scripts/generate-schema.mjs          # write
 *   node apps/api/scripts/generate-schema.mjs --check  # fail if the committed file is stale
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const shared = require(join(here, '../../../packages/shared/dist/index.js'));
const { RESOURCES, refTarget, delegateName } = shared;

const COMMON_HEAD = `  id          String    @id @default(uuid()) @db.Uuid
  householdId String    @db.Uuid
  household   Household @relation(fields: [householdId], references: [id], onDelete: Cascade)`;
const COMMON_TAIL = `  createdById String?   @db.Uuid
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?`;

/** Extra lines for generated models (relations to core models, extra indexes). */
const EXTRA = {
  Document: ['versions DocumentVersion[]', 'shares DocumentShare[]'],
  Notification: ['@@unique([recipientMemberId, dedupeKey])'],
  Transaction: ['@@index([householdId, fingerprint])'],
  Expense: ['@@index([householdId, sourceType, sourceId])'],
  AuditLog: ['@@index([householdId, entityType, entityId])'],
};

function defaultAttr(field) {
  const d = field.default;
  if (d === undefined) return '';
  if (Array.isArray(d)) return ` @default([${d.map((x) => JSON.stringify(x)).join(', ')}])`;
  if (typeof d === 'string') return ` @default(${JSON.stringify(d)})`;
  return ` @default(${d})`;
}

function scalar(field) {
  const optional = !field.required && field.default === undefined;
  const q = optional ? '?' : '';
  switch (field.type) {
    case 'string':
    case 'text':
    case 'enum':
      return `String${q}${defaultAttr(field)}`;
    case 'int':
      return `Int${q}${defaultAttr(field)}`;
    case 'number':
      return `Float${q}${defaultAttr(field)}`;
    case 'money':
      return `Decimal${q} @db.Decimal(14, 2)${defaultAttr(field)}`;
    case 'date':
    case 'datetime':
      return `DateTime${q}`;
    case 'boolean':
      return `Boolean${q}${defaultAttr(field)}`;
    case 'tags':
      return `String[]${field.default === undefined ? ' @default([])' : defaultAttr(field)}`;
    case 'json':
      return 'Json?';
    case 'ref':
      return `String${field.required ? '' : '?'} @db.Uuid`;
    default:
      throw new Error(`Unsupported field type ${field.type}`);
  }
}

const backRels = {}; // target model -> lines
const householdRels = [];
const models = [];

for (const def of RESOURCES) {
  const lines = [COMMON_HEAD];
  const indexes = ['@@index([householdId, deletedAt])'];
  for (const field of def.fields) {
    lines.push(`  ${field.key} ${scalar(field)}`);
    if (field.type === 'ref') {
      const target = refTarget(field.ref).model;
      const relName = `${def.model}_${field.key}`;
      const relField = `${field.key.replace(/Id$/, '')}Ref`;
      lines.push(
        `  ${relField} ${target}${field.required ? '' : '?'} @relation("${relName}", fields: [${field.key}], references: [id], onDelete: ${field.required ? 'NoAction' : 'SetNull'})`,
      );
      (backRels[target] ??= []).push(`  ${delegateName(def.model)}_${field.key} ${def.model}[] @relation("${relName}")`);
      if (field.required) indexes.push(`@@index([${field.key}])`);
    }
  }
  if (def.dateField) indexes.push(`@@index([householdId, ${def.dateField}])`);
  lines.push(COMMON_TAIL);
  for (const extra of EXTRA[def.model] ?? []) (extra.startsWith('@@') ? indexes : lines).push(extra.startsWith('@@') ? extra : `  ${extra}`);
  models.push({ name: def.model, lines, indexes });
  householdRels.push(`  ${delegateName(def.model)}Records ${def.model}[]`);
}

const generated = models
  .map((m) => {
    const back = backRels[m.name] ?? [];
    return `model ${m.name} {\n${[...m.lines, ...back, '', ...m.indexes.map((i) => `  ${i}`)].join('\n')}\n}`;
  })
  .join('\n\n');

let core = readFileSync(join(here, '../prisma/core.prisma'), 'utf8');
core = core.replace('  //@@HOUSEHOLD_BACKRELS', householdRels.join('\n'));
core = core.replace('  //@@MEMBER_BACKRELS', (backRels.HouseholdMember ?? []).join('\n'));
if (core.includes('//@@')) throw new Error('Unreplaced placeholder in core.prisma');

const output = `// GENERATED FILE — do not edit by hand.
// Source: prisma/core.prisma + packages/shared/src/resources.ts
// Regenerate with: npm run db:generate

${core.trim()}

// ---------------------------------------------------------------------------
// Models generated from the resource registry
// ---------------------------------------------------------------------------

${generated}
`;

const target = join(here, '../prisma/schema.prisma');
if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8');
  if (current !== output) {
    console.error('prisma/schema.prisma is stale. Run: npm run db:generate');
    process.exit(1);
  }
  console.log('schema.prisma is up to date');
} else {
  writeFileSync(target, output);
  console.log(`Wrote ${target} (${models.length} generated models)`);
}
