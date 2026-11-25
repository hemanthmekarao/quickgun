import type { FieldDef, ResourceDef } from './fields';
import { RESOURCES } from './resources';
import { MODULE_LABELS } from './roles';

type Json = Record<string, any>;

function fieldSchema(field: FieldDef): Json {
  const base: Json = { description: field.help ? `${field.label}. ${field.help}` : field.label };
  switch (field.type) {
    case 'string':
    case 'text':
      return { ...base, type: 'string' };
    case 'int':
      return { ...base, type: 'integer', ...(field.min !== undefined ? { minimum: field.min } : {}), ...(field.max !== undefined ? { maximum: field.max } : {}) };
    case 'number':
    case 'money':
      return { ...base, type: 'number', ...(field.min !== undefined ? { minimum: field.min } : {}), ...(field.max !== undefined ? { maximum: field.max } : {}) };
    case 'date':
      return { ...base, type: 'string', format: 'date' };
    case 'datetime':
      return { ...base, type: 'string', format: 'date-time' };
    case 'boolean':
      return { ...base, type: 'boolean' };
    case 'enum':
      return { ...base, type: 'string', enum: [...(field.options ?? [])] };
    case 'ref':
      return { ...base, type: 'string', format: 'uuid', description: `${base.description} (id of a ${field.ref} record)` };
    case 'tags':
      return { ...base, type: 'array', items: field.options ? { type: 'string', enum: [...field.options] } : { type: 'string' } };
    case 'json':
      return { ...base, type: 'object', additionalProperties: true };
  }
}

function pascal(key: string): string {
  return key
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

export function resourceSchemas(def: ResourceDef): { name: string; record: Json; input: Json } {
  const name = pascal(def.key);
  const visible = def.fields.filter((x) => !x.hidden);
  const writable = def.fields.filter((x) => !x.system);
  const record: Json = {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      householdId: { type: 'string', format: 'uuid' },
      ...Object.fromEntries(visible.map((x) => [x.key, { ...fieldSchema(x), nullable: !x.required }])),
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      createdById: { type: 'string', format: 'uuid', nullable: true },
      _refs: {
        type: 'object',
        description: 'Display labels for referenced records, keyed by field name.',
        additionalProperties: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' } } },
      },
    },
  };
  const input: Json = {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(writable.map((x) => [x.key, fieldSchema(x)])),
    required: writable.filter((x) => x.required && x.default === undefined).map((x) => x.key),
  };
  if (input.required.length === 0) delete input.required;
  return { name, record, input };
}

const errorResponses: Json = {
  '400': { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  '401': { description: 'Not authenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  '403': { description: 'Not permitted for this role', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  '404': { description: 'Not found in this household', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
};

const householdHeader: Json = { $ref: '#/components/parameters/HouseholdId' };
const idParam: Json = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };

/** OpenAPI paths + component schemas for every registry resource. */
export function buildResourceOpenApi(resources: ResourceDef[] = RESOURCES): { paths: Json; schemas: Json; tags: Json[] } {
  const paths: Json = {};
  const schemas: Json = {};
  const tags = new Map<string, Json>();
  for (const def of resources) {
    const { name, record, input } = resourceSchemas(def);
    const tag = MODULE_LABELS[def.module];
    tags.set(tag, { name: tag });
    schemas[name] = record;
    if (!def.readOnly) schemas[`${name}Input`] = input;
    const ref = { $ref: `#/components/schemas/${name}` };
    const inputRef = { $ref: `#/components/schemas/${name}Input` };
    const filters = def.fields
      .filter((x) => !x.hidden && ['enum', 'ref', 'boolean'].includes(x.type))
      .map((x) => ({ name: x.key, in: 'query', required: false, schema: fieldSchema(x), description: `Filter by ${x.label.toLowerCase()}` }));
    const collection: Json = {
      get: {
        tags: [tag],
        operationId: `list${name}`,
        summary: `List ${def.plural.toLowerCase()}`,
        description: `${def.description ? def.description + ' ' : ''}Requires \`${def.module}:read\`.`,
        security: [{ bearer: [] }],
        parameters: [
          householdHeader,
          { name: 'q', in: 'query', schema: { type: 'string' }, description: `Text search over: ${def.search.join(', ') || 'n/a'}` },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
          { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'Field to sort by' },
          { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
          ...(def.dateField
            ? [
                { name: 'from', in: 'query', schema: { type: 'string', format: 'date' }, description: `Earliest ${def.dateField}` },
                { name: 'to', in: 'query', schema: { type: 'string', format: 'date' }, description: `Latest ${def.dateField}` },
              ]
            : []),
          ...filters,
        ],
        responses: {
          '200': {
            description: 'A page of records',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { items: { type: 'array', items: ref }, total: { type: 'integer' }, page: { type: 'integer' }, pageSize: { type: 'integer' } },
                },
              },
            },
          },
          ...errorResponses,
        },
      },
    };
    if (!def.readOnly && !def.noCreate) {
      collection.post = {
        tags: [tag],
        operationId: `create${name}`,
        summary: `Create a ${def.singular.toLowerCase()}`,
        description: `Requires \`${def.module}:write\`.`,
        security: [{ bearer: [] }],
        parameters: [householdHeader],
        requestBody: { required: true, content: { 'application/json': { schema: inputRef } } },
        responses: { '201': { description: 'Created', content: { 'application/json': { schema: ref } } }, ...errorResponses },
      };
    }
    paths[`/v1/${def.key}`] = collection;
    const item: Json = {
      get: {
        tags: [tag],
        operationId: `get${name}`,
        summary: `Get a ${def.singular.toLowerCase()}`,
        security: [{ bearer: [] }],
        parameters: [householdHeader, idParam],
        responses: { '200': { description: 'The record', content: { 'application/json': { schema: ref } } }, ...errorResponses },
      },
    };
    if (!def.readOnly) {
      item.patch = {
        tags: [tag],
        operationId: `update${name}`,
        summary: `Update a ${def.singular.toLowerCase()}`,
        description: `Partial update; send only the fields to change. Requires \`${def.module}:write\`.`,
        security: [{ bearer: [] }],
        parameters: [householdHeader, idParam],
        requestBody: { required: true, content: { 'application/json': { schema: inputRef } } },
        responses: { '200': { description: 'Updated', content: { 'application/json': { schema: ref } } }, ...errorResponses },
      };
      item.delete = {
        tags: [tag],
        operationId: `delete${name}`,
        summary: `Delete a ${def.singular.toLowerCase()}`,
        description: `Soft delete; the record is retained for audit. Requires \`${def.module}:delete\`.`,
        security: [{ bearer: [] }],
        parameters: [householdHeader, idParam],
        responses: { '204': { description: 'Deleted' }, ...errorResponses },
      };
    }
    paths[`/v1/${def.key}/{id}`] = item;
  }
  return { paths, schemas, tags: [...tags.values()] };
}

export const OPENAPI_COMMON_COMPONENTS: Json = {
  securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  parameters: {
    HouseholdId: {
      name: 'X-Household-Id',
      in: 'header',
      required: true,
      schema: { type: 'string', format: 'uuid' },
      description: 'Household to act in. The caller must be an active member of it.',
    },
  },
  schemas: {
    Error: {
      type: 'object',
      properties: {
        statusCode: { type: 'integer' },
        code: { type: 'string' },
        message: { type: 'string' },
        issues: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } },
      },
    },
  },
};
