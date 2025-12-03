const XLSX = require('xlsx');
const fs = require('fs');
const SPECIAL_KEYS = ['id', 'documentId', 'locale', 'createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy', 'localizations'];
const CORPORATE_COMPONENTS = ['interalInfo'];
const INVESTOR_COMPONENTS = ['internalInfo'];

async function importData() {
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

    function unflattenRow(rows, existedComponents = []) {
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

        if(sheetName === 'api::corporate.corporate') {
          importData[contentTypeName] = unflattenRow(rows, CORPORATE_COMPONENTS);
        } else if (sheetName === 'api::investor.investor' || sheetName === 'api::vip_guest.vip_guest') {
          importData[contentTypeName] = unflattenRow(rows, INVESTOR_COMPONENTS);
        } else if (contentTypeName.startsWith('api::')) {
          importData[contentTypeName] = unflattenRow(rows);
        } else {
          strapi.log.error(`Unknown content-type: ${contentTypeName}`);
          return;
        }
    });

    strapi.log.info('Final import data keys:', Object.keys(importData));
    return importData;
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

    for (const entry of entries) {
      try {
        const { documentId, ...data } = entry; // keep id out, keep everything else

        let existing = null;

        if (documentId && documentId !== 'null' && documentId !== 'undefined') {
          existing = await strapi.documents(contentType).findOne({ documentId });
        }

        if (existing) {
          // Update
          if (strapi.documents) {
            await strapi.documents(contentType).update({
              documentId,
              data,
            });
          } else {
            await strapi.entityService.update(contentType, existing.id, { data });
          }
          results.updated++;
        } else {
          // Create new
          if (strapi.documents) {
            await strapi.documents(contentType).create({ data });
          } else {
            await strapi.entityService.create(contentType, { data });
          }
          results.created++;
        }
      } catch (err) {
        results.errors.push(`Failed ${existing ? 'updating' : 'creating'} in ${contentType}: ${err.message}`);
      }
    }
  }

  return results;
}

module.exports = {
  importData,
};