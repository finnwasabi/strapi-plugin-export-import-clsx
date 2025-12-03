const XLSX = require('xlsx');
const fs = require('fs');

function toCamel(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

const SPECIAL_KEYS = ['id', 'documentId', 'locale', 'createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy', 'localizations'];

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
        if (SPECIAL_KEYS.includes(key)) return false;
        const parts = key.split('_');
        return parts.length === 2; // exactly one underscore
    };

    function unflattenRow(rows, targetContentType) {
      const result = [];
      for (const row of rows) {
        const rowData = {};

        for (const [key, value] of Object.entries(row)) {
            if (value === null || value === undefined || value === '') {
              rowData[key] = null
            }

            if (isComponentField(key)) {
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

        rowData["publishedAt"] = new Date();

        result.push(rowData);
      }

      return result;
    };

    const mapSheetNameToContentType = (sheetName) => {
        if (!sheetName.startsWith('api__')) return sheetName;
        return sheetName.replace(/^api__/, 'api::').replace(/_/g, '.');
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

async function handleRelations(entry, relationFields) {
  const newEntry = { ...entry };

  for (const rel of relationFields) {
    const { field, target } = rel;
    const relValue = entry[field];
    try {
      if (!relValue) continue;

      if (Array.isArray(relValue)) {
        const processed = [];

        for (const item of relValue) {
          if (item.id) {
            processed.push({ id: item.id });
          } else {
            const created = await strapi.documents(target).create({ data: item });
            processed.push({ id: created.id });
          }
        }
        newEntry[field] = processed;
        continue;
      }

      if (!relValue.id) {
        const created = await strapi.documents(target).create({ data: relValue });
        newEntry[field] = { id: created.id };
      }
    } catch (err) {
      throw new Error(`Field: ${field}, data: ${JSON.stringify(relValue)}, error: ${err.message}`);
    }
  }

  return newEntry;
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
        let { documentId, ...data } = entry; // keep id out, keep everything else

        if (documentId && documentId !== 'null' && documentId !== 'undefined') {
          existing = await strapi.documents(contentType).findOne({ documentId });
        }

        relationFields = getRelationFields(contentType);
        if (relationFields.length) {
          data = await handleRelations(data, relationFields);
        }

        if (existing) {
          await strapi.documents(contentType).update({
            documentId,
            data,
          });
          results.updated++;
        } else {
          await strapi.documents(contentType).create({ data });
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