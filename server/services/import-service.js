const XLSX = require("xlsx");
const fs = require("fs");

function toCamel(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

const SYSTEM_KEYS = [
  "documentId",
  "locale",
  "createdAt",
  "updatedAt",
  "publishedAt",
  "createdBy",
  "updatedBy",
  "localizations",
  "status",
];

const SHORTCUT_FIELDS = [
  "email",
  "businessEmail",
  "name",
  "title",
  "tickerCode",
];
module.exports = ({ strapi }) => ({
  async importData(file, targetContentType = null) {
    let result;
    try {
      let importData;
      // Check file extension
      const fileName = file.name || file.originalFilename || "unknown.json";
      const fileExtension = fileName.split(".").pop().toLowerCase();
      const filePath = file.path || file.filepath;
      if (!filePath) {
        throw new Error("File path not found");
      }

      if (fileExtension === "json") {
        const fileContent = fs.readFileSync(filePath, "utf8");
        importData = JSON.parse(fileContent);
        strapi.log.info("Parsed JSON data:", Object.keys(importData));
      } else if (fileExtension === "xlsx" || fileExtension === "xls") {
        importData = this.transformExcelData(filePath, targetContentType);
      }
      result = await this.bulkInsertData(importData);
      return result;
    } catch (error) {
      // Clean up uploaded file on error
      const filePath = file && (file.path || file.filepath);
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      throw error;
    }
  },

  transformExcelData(filePath, targetContentType = null) {
    const workbook = XLSX.readFile(filePath);
    const importData = {};

    const parseJsonIfNeeded = (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return value;

      try {
        return JSON.parse(trimmed);
      } catch {
        return value; // keep as string if invalid JSON
      }
    };

    const isComponentField = (key) => {
      const parts = key.split("_");
      return parts.length === 2; // exactly one underscore
    };

    const unflattenRow = (rows, targetContentType) => {
      const result = [];
      const attr = strapi.contentTypes[targetContentType].attributes;
      for (const row of rows) {
        const rowData = {};

        for (const [key, value] of Object.entries(row)) {
          if (value === null || value === undefined || value === "") {
            rowData[key] = null;
          } else if (
            attr[key] &&
            attr[key].customField &&
            attr[key].type === "json" &&
            attr[key].default === "[]"
          ) {
            rowData[key] = parseJsonIfNeeded(value).split("|");
          } else if (isComponentField(key)) {
            const [comp, field] = key.split("_");
            if (!rowData[comp]) rowData[comp] = {};
            rowData[comp][field] = parseJsonIfNeeded(value);
          } else {
            rowData[key] = parseJsonIfNeeded(value);
          }
        }
        result.push(rowData);
      }

      return result;
    };

    const mapSheetNameToContentType = (sheetName) => {
      // If targetContentType is provided, use it instead of guessing from sheet name
      if (targetContentType) {
        return targetContentType;
      }
      return "api::" + sheetName + "." + sheetName;
    };

    workbook.SheetNames.forEach((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet);

      if (!rows.length) return;

      const contentTypeName = mapSheetNameToContentType(sheetName);

      strapi.log.info(`Reading sheet "${sheetName}" -> ${rows.length} rows`);
      strapi.log.info(`Mapped sheet to content-type: ${contentTypeName}`);

      if (contentTypeName.startsWith("api::")) {
        // Validate that the content type exists
        if (!strapi.contentTypes[contentTypeName]) {
          strapi.log.error(
            `Content type ${contentTypeName} not found. Available types:`,
            Object.keys(strapi.contentTypes)
          );
          return;
        }
        importData[contentTypeName] = unflattenRow(rows, contentTypeName);
      } else {
        strapi.log.error(`Unknown content-type: ${contentTypeName}`);
        return;
      }
    });

    strapi.log.info("Final import data keys:", Object.keys(importData));
    return importData;
  },

  getRelationFields(contentType) {
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
  },

  getComponentFields(contentType) {
    const schema = strapi.contentTypes[contentType];

    if (!schema) {
      strapi.log.warn(`Content type ${contentType} not found`);
      return [];
    }

    return Object.entries(schema.attributes)
      .filter(([_, attr]) => attr.type === "component")
      .map(([fieldName, attr]) => toCamel(fieldName));
  },

  async handleRelations(entry, contentType) {
    const resolveRelationValue = async (field, value, target) => {
      const targetAttr = strapi.contentTypes[target].attributes;
      for (const field of SHORTCUT_FIELDS) {
        if (!targetAttr[field]) continue;
        const existing = await strapi.documents(target).findFirst({
          filters: { [field]: { $eq: value } },
        });
        if (existing) return { id: existing.id };
        throw new Error(`Data with ${field} ${value} not found`);
      }
      return null;
    };

    const relationFields = this.getRelationFields(contentType);
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
      }

      // Convert CSV to array
      if (
        typeof value === "string" &&
        (relation === "manyToMany" || relation === "oneToMany")
      ) {
        value = value.split("|");
      } else if (typeof value === "string" && value.includes("|")) {
        throw new Error(
          `Invalid value for field ${field}: ${value}, ${field} is not an array`
        );
      }

      const values = Array.isArray(value) ? value : [value];
      try {
        const processed = [];

        for (const v of values) {
          if (!v || v === "") continue;
          const resolved = await resolveRelationValue(field, v, target);
          if (resolved) processed.push(resolved);
        }

        updatedEntry[field] = Array.isArray(value) ? processed : processed[0];
      } catch (err) {
        throw new Error(
          `Failed processing field ${field} with value ${JSON.stringify(value)}: ${err.message}`
        );
      }
    }

    return updatedEntry;
  },

  handleComponents(data, existing, contentType) {
    // Get the component fields for this content type
    const compFields = this.getComponentFields(contentType);

    for (const field of compFields) {
      const newValue = data[field];
      const oldValue = existing?.[field];

      if (!newValue || !oldValue) continue;

      //single component
      if (!Array.isArray(newValue)) {
        if (oldValue?.id) {
          data[field].id = oldValue.id;
        }
        for (const key of Object.keys(data[field])) {
          if (Array.isArray(oldValue[key])) {
            data[field][key] = data[field][key].split("|");
          }
        }
        continue;
      }

      //multiple components
      if (Array.isArray(newValue) && Array.isArray(oldValue)) {
        data[field] = newValue.map((block, i) => {
          const oldBlock = oldValue[i];
          if (oldBlock?.id) {
            return { id: oldBlock.id, ...block };
          }
          for (const key of Object.keys(block)) {
            if (Array.isArray(oldBlock[key])) {
              block[key] = block[key].split("|");
            }
          }
          return block;
        });
      }
    }

    return data;
  },

  hasChanges(existing, incoming) {
    if (!incoming || typeof incoming !== "object") return false;
    if (!existing || typeof existing !== "object") return true;
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
          if (
            typeof newVal[i] === "object" &&
            typeof oldVal[i] === "object" &&
            this.hasChanges(oldVal[i], newVal[i])
          ) {
            return true;
          } else if (
            typeof newVal[i] !== "object" &&
            typeof oldVal[i] !== "object" &&
            newVal[i] !== oldVal[i]
          ) {
            return true;
          }
        }
        continue;
      }

      // OBJECT comparison (recursive, but ONLY fields in incoming object)
      if (typeof newVal === "object" && typeof oldVal === "object") {
        if (this.hasChanges(oldVal, newVal)) {
          return true;
        }
        continue;
      }
    }

    return false;
  },

  async bulkInsertData(importData) {
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

      try {
        const { created, updated, errors } = await this.importEntries(
          entries,
          contentType
        );
        results.created += created;
        results.updated += updated;
        results.errors = results.errors.concat(errors);
      } catch (err) {
        results.errors.push(err.message);
      }
    }

    return results;
  },

  async importEntries(entries, contentType) {
    const results = { created: 0, updated: 0, errors: [] };

    await strapi.db.transaction(async ({ trx, rollback, onRollback }) => {
      onRollback(() => {
        strapi.log.error("Transaction rolled back due to an error!");
        strapi.log.error(results.errors);
      });

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        let existing = null;

        try {
          let { id, ...data } = entry;

          // Check if document exists
          if (id && id !== "null" && id !== "undefined") {
            existing = await strapi.documents(contentType).findFirst(
              {
                filters: { id },
                populate: "*",
              },
              { transaction: trx }
            );
          }

          // Handle relations & components
          data = await this.handleRelations(data, contentType, trx);
          data = await this.handleComponents(data, existing, contentType);

          // Update
          if (existing) {
            if (this.hasChanges(existing, data)) {
              await strapi.documents(contentType).update(
                {
                  documentId: existing.documentId,
                  data,
                },
                { transaction: trx }
              );
              results.updated++;
            }
          }

          // Create
          else {
            await strapi
              .documents(contentType)
              .create({ data }, { transaction: trx });
            results.created++;
          }
        } catch (err) {
          results.errors.push(
            `Failed ${existing ? "updating" : "creating"} on row ${
              i + 2
            }: ${err.message}`
          );
          results.created = 0;
          results.updated = 0;

          // IMPORTANT: force rollback
          throw err;
        }
      }
    });

    return results;
  },
});
