const XLSX = require('xlsx');
const fs = require('fs');

function toCamel(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

const SYSTEM_KEYS = [
  'documentId',
  'locale',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'localizations',
  'status'
];

const EMAIL_KEYS = [
  'investor',
  'investors',
  'vipGuest',
  'vipGuests',
  'whitelistEmail',
  'whitelistEmails',
  'corporateRepresentative',
  'corporateRepresentatives',
  'representative',
  'representatives'
];

const EMAIL_FIELDS = [
  'email',
  'businessEmail',
];

const TICKER_KEYS = [
  'corporate',
  'corporates',
];

const TICKER_FIELD = "tickerCode";

const OTHER_FIELDS = [
  'name','title'
]

async function importData(file) {
  let result;
  try {
    let importData;
    // Check file extension
    const fileName = file.name || file.originalFilename || 'unknown.json';
    const fileExtension = fileName.split('.').pop().toLowerCase();
    const filePath = file.path || file.filepath;
    if (!filePath) {
      throw new Error('File path not found');
    }

    if (fileExtension === 'json') {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      importData = JSON.parse(fileContent);
      strapi.log.info('Parsed JSON data:', Object.keys(importData));
    } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
      importData = transformExcelData(filePath);
    }
    result = await bulkInsertData(importData);
    return result;
  } catch (error) {
    // Clean up uploaded file on error
    const filePath = file && (file.path || file.filepath);
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    throw error;
  }
}


function transformExcelData(filePath) {
    const workbook = XLSX.readFile(filePath);
    const importData = {};

    const parseJsonIfNeeded = (value) => {
        if (typeof value !== 'string') return value;
        const trimmed = value.trim();
        if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return value;

        try {
        return JSON.parse(trimmed);
        } catch {
        return value; // keep as string if invalid JSON
        }
    };

    const isComponentField = (key) => {
        const parts = key.split('_');
        return parts.length === 2; // exactly one underscore
    };

    function unflattenRow(rows, targetContentType) {
      const result = [];
      const attr = strapi.contentTypes[targetContentType].attributes;
      for (const row of rows) {
        const rowData = {};

        for (const [key, value] of Object.entries(row)) {
            if (value === null || value === undefined || value === '') {
              rowData[key] = null
            } else if (attr[key] && attr[key].customField && attr[key].type === 'json' && attr[key].default === '[]') {
              rowData[key] = parseJsonIfNeeded(value).split(',');
            } else if (isComponentField(key)) {
              const [comp, field] = key.split('_');
              if (!rowData[comp]) rowData[comp] = {};
              rowData[comp][field] = parseJsonIfNeeded(value);
            } else {
              rowData[key] = parseJsonIfNeeded(value);
            }
        }

        existedComponents = getComponentFields(targetContentType);
        for (const comp of existedComponents) {
          if (!rowData[comp]) {
            rowData[comp] = {};
          }
        }

        result.push(rowData);
      }

      return result;
    };

    const mapSheetNameToContentType = (sheetName) => {
        return "api::" + sheetName + "." + sheetName;
    };

    workbook.SheetNames.forEach(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet);

        if (!rows.length) return;

        const contentTypeName = mapSheetNameToContentType(sheetName);

        strapi.log.info(`Reading sheet "${sheetName}" -> ${rows.length} rows`);
        strapi.log.info(`Mapped sheet to content-type: ${contentTypeName}`);

        if (contentTypeName.startsWith('api::')) {
          importData[contentTypeName] = unflattenRow(rows, contentTypeName);
        } else {
          strapi.log.error(`Unknown content-type: ${contentTypeName}`);
          return;
        }
    });

    strapi.log.info('Final import data keys:', Object.keys(importData));
    return importData;
}

function getRelationFields(contentType) {
  const schema = strapi.contentTypes[contentType];

  if (!schema) {
    strapi.log.warn(`Content type ${contentType} not found`);
    return [];
  }

  return Object.entries(schema.attributes)
    .filter(([_, attr]) => attr.type === "relation")
    .map(([fieldName, attr]) => ({
      field: toCamel(fieldName),
      target: attr.target, // e.g. "api::category.category"
      relation: attr.relation,
    }));
}

function getComponentFields(contentType) {
  const schema = strapi.contentTypes[contentType];

  if (!schema) {
    strapi.log.warn(`Content type ${contentType} not found`);
    return [];
  }

  return Object.entries(schema.attributes)
    .filter(([_, attr]) => attr.type === "component")
    .map(([fieldName, attr]) => toCamel(fieldName));
}

async function handleRelations(entry, contentType) {
  async function resolveRelationValue(field, value, target) {
    const targetAttr = strapi.contentTypes[target].attributes;
    if (EMAIL_KEYS.includes(field)) {
      for (const emailField of EMAIL_FIELDS) {
        if (!targetAttr[emailField]) continue;
        const existing = await strapi.documents(target).findFirst({
          filters: { [emailField]: { $eq: value } },
        });
        if (existing) return {id: existing.id};
      }
      return null;
    } else if (TICKER_KEYS.includes(field)) {
      if (!targetAttr[TICKER_FIELD]) return null;
      const existing = await strapi.documents(target).findFirst({
        filters: { [TICKER_FIELD]: { $eq: value } },
      });
      return { id: existing.id };
    } else {
      for (const field of OTHER_FIELDS) {
        if (!targetAttr[field]) continue;
        const existing = await strapi.documents(target).findFirst({
          filters: { [field]: { $eq: value } },
        });
        if (existing) return {id: existing.id};
      }
      return null;
    }
  }

  const relationFields = getRelationFields(contentType);
  if (relationFields.length === 0) return entry;

  const updatedEntry = { ...entry };

  for (const rel of relationFields) {
    const { field, target, relation } = rel;

    let value = entry[field];
    if (!value || value === "") {
      if (relation === "manyToMany" || relation === "oneToMany") {
        updatedEntry[field] = [];
      } else {
        updatedEntry[field] = null;
      }
      continue;
    };

    // Convert CSV to array
    if (typeof value === "string" && value.includes(",")) {
      value = value.split(",");
    }

    const values = Array.isArray(value) ? value : [value];
    try {
      const processed = [];

      for (const v of values) {
        const resolved = await resolveRelationValue(field, v, target);
        if (resolved) processed.push(resolved);
      }

      updatedEntry[field] = Array.isArray(value) ? processed : processed[0];
    } catch (err) {
      throw new Error(
        `Failed processing field "${field}" with value "${JSON.stringify(value)}": ${err.message}`
      );
    }
  }

  return updatedEntry;
}

function hasChanges(existing, incoming) {
  if (!incoming || typeof incoming !== "object") return false;

  for (const key of Object.keys(incoming)) {
    // Skip system keys
    if (SYSTEM_KEYS.includes(key)) continue;

    const newVal = incoming[key];
    const oldVal = existing[key];

    // If incoming defines a field but existing doesn't → change
    if (oldVal === undefined || newVal === undefined) {
      continue;
    }

    // Primitive comparison
    if (newVal === null || typeof newVal !== "object") {
      if (oldVal !== newVal) {
        return true;
      }
      continue;
    }

    // ARRAY comparison
    if (Array.isArray(newVal)) {
      if (!Array.isArray(oldVal)) return true;
      if (newVal.length !== oldVal.length) return true;
      // Compare values shallowly
      for (let i = 0; i < newVal.length; i++) {
        if (typeof newVal[i] === "object" && typeof oldVal[i] === "object" && hasChanges(oldVal[i], newVal[i])) {
          return true;
        } else if (typeof newVal[i] !== "object" && typeof oldVal[i] !== "object" && newVal[i] !== oldVal[i]) {
          return true;
        }
      }
      continue;
    }

    // OBJECT comparison (recursive, but ONLY fields in incoming object)
    if (typeof newVal === "object" && typeof oldVal === "object") {
      if (hasChanges(oldVal, newVal)) {
        return true;
      }
      continue;
    }
  }

  return false;
}


async function bulkInsertData(importData) {
  const results = {
    created: 0,
    updated: 0,
    errors: [],
  };

  for (const [contentType, entries] of Object.entries(importData)) {
    // Validate entries
    if (!strapi.contentTypes[contentType]) {
      results.errors.push(`Content type ${contentType} not found`);
      continue;
    }
    if (!Array.isArray(entries)) {
      results.errors.push(`Invalid data format for ${contentType}`);
      continue;
    }

    for (i = 0; i < entries.length; i++) {
      const entry = entries[i];
      let existing = null;
      try {
        let { id, ...data } = entry; // keep id out, keep everything else
        let isUpdated = false;
        let isCreated = false;
        if (id && id !== 'null' && id !== 'undefined') {
          existing = await strapi.documents(contentType).findFirst({
            filters: {
              id: { $eq: id }
            },
            populate: '*'
          });
        }

        data = await handleRelations(data, contentType);

        if (existing) {
          if (hasChanges(existing, data)) {
            await strapi.documents(contentType).update({
              documentId: existing.documentId,
              data,
            });
            isUpdated = true;
          }
        } else {
          await strapi.documents(contentType).create({ data });
          isCreated = true;
        }
        if (isUpdated) {
          results.updated++;
        } else if (isCreated) {
          results.created++;
        }
      } catch (err) {
        results.errors.push(`Failed ${existing ? 'updating' : 'creating'} on row ${i+2}: ${err.message}`);
      }
    }
  }

  return results;
}

module.exports = {
  importData,
};