const XLSX = require("xlsx");

module.exports = ({ strapi }) => ({
  async exportData(
    format = "json",
    contentType = null,
    rawFilters = {},
    selectedIds = [],
    selectedField = null
  ) {
    // Normalize content type - handle both content-manager and event-manager formats
    if (contentType && !contentType.startsWith("api::")) {
      // If it's already in api:: format from event-manager, use as is
      // If it's from content-manager, it should already be in correct format
      contentType = contentType;
    }

    // Get only API content types (collections)
    let contentTypes;
    if (contentType) {
      // Validate that the content type exists
      if (!strapi.contentTypes[contentType]) {
        strapi.log.error(
          `Content type ${contentType} not found. Available types:`,
          Object.keys(strapi.contentTypes)
        );
        throw new Error(`Content type ${contentType} not found`);
      }
      contentTypes = [contentType];
    } else {
      contentTypes = Object.keys(strapi.contentTypes).filter((key) =>
        key.startsWith("api::")
      );
    }

    const exportData = {
      version: strapi.config.get("info.strapi"),
      timestamp: new Date().toISOString(),
      data: {},
    };

    for (const ct of contentTypes) {
      try {
        // Parse filters from URL format
        const parsedFilters = this.parseFilters(rawFilters);

        if (rawFilters["_q"]) {
          parsedFilters._q = rawFilters["_q"];
        }

        strapi.log.info(
          `Exporting ${ct} with raw filters: ${JSON.stringify(rawFilters)}`
        );
        strapi.log.info(`Parsed filters: ${JSON.stringify(parsedFilters)}`);
        strapi.log.info(`Selected IDs: ${JSON.stringify(selectedIds)}`);

        let entries = [];
        let filters = parsedFilters.filters;

        // If specific IDs are selected, export only those
        if (selectedIds && selectedIds.length > 0) {
          strapi.log.info(
            `Exporting selected: ${JSON.stringify(selectedIds)}, field: ${selectedField}`
          );
          if (
            selectedField === "id" ||
            (strapi.contentTypes[ct].attributes[selectedField] &&
              ["number", "integer", "biginteger", "float", "decimal"].includes(
                strapi.contentTypes[ct].attributes[selectedField].type
              ))
          ) {
            selectedIds = selectedIds.map((id) => Number(id));
          }
          try {
            entries = await strapi.documents(ct).findMany({
              filters: {
                [selectedField]: { $in: selectedIds },
              },
              populate: "*",
            });
          } catch (error) {
            strapi.log.error(`Failed to export selected entries:`, error);
          }
        } else {
          // Export all entries with filters
          const searchable = this.getSearchableFields(strapi.contentTypes[ct]);
          const numberSearchable = this.getNumberFields(
            strapi.contentTypes[ct]
          );

          if (parsedFilters._q) {
            strapi.log.info(
              `Applying search query: ${parsedFilters._q} for fields: ${JSON.stringify([...searchable, ...numberSearchable])}`
            );
            const orConditions = [];

            if (searchable.length > 0) {
              orConditions.push(
                ...searchable.map((field) => ({
                  [field]: { $containsi: parsedFilters._q },
                }))
              );
            }

            if (numberSearchable.length > 0 && !isNaN(parsedFilters._q)) {
              orConditions.push(
                ...numberSearchable.map((field) => ({
                  [field]: { $eq: Number(parsedFilters._q) },
                }))
              );
            }

            if (orConditions.length > 0) {
              filters = {
                ...filters,
                $and: [...(filters?.$and || []), { $or: orConditions }],
              };
            }
          }
          strapi.log.info(`Parsed query filters: ${JSON.stringify(filters)}`);
          try {
            entries = await strapi.documents(ct).findMany({
              filters: { ...filters },
              populate: "*",
            });
            strapi.log.info(
              `EntityService found ${entries?.length || 0} entries`
            );
          } catch (error) {
            strapi.log.error(`Failed to query entries:`, error);
          }
        }

        strapi.log.info(
          `Final result: ${entries?.length || 0} entries for ${ct} (total found: ${entries?.length || 0})`
        );

        if (entries && entries.length > 0) {
          exportData.data[ct] = entries;
        }
      } catch (error) {
        strapi.log.error(`Failed to export ${ct}:`, error);
      }
    }

    if (format === "excel") {
      return this.convertToExcel(exportData.data);
    }

    return exportData;
  },

  getSearchableFields(contentTypeSchema) {
    const searchable = [];

    for (const [fieldName, field] of Object.entries(
      contentTypeSchema.attributes
    )) {
      if (
        ["string", "text", "richtext", "email", "uid", "enumeration"].includes(
          field.type
        ) &&
        fieldName !== "locale"
      ) {
        searchable.push(fieldName);
      }
    }

    return searchable;
  },

  getNumberFields(contentTypeSchema) {
    const numberFields = [];

    for (const [fieldName, field] of Object.entries(
      contentTypeSchema.attributes
    )) {
      if (
        ["number", "integer", "biginteger", "float", "decimal"].includes(
          field.type
        )
      ) {
        numberFields.push(fieldName);
      }
    }

    numberFields.push("id");

    return numberFields;
  },

  parseFilters(filters) {
    const parsed = {};
    for (const [key, value] of Object.entries(filters)) {
      // Skip pagination and sorting params
      if (
        [
          "page",
          "pageSize",
          "sort",
          "locale",
          "format",
          "contentType",
          "_q",
        ].includes(key)
      ) {
        continue;
      }

      // Handle URL encoded filter format like filters[$and][0][shortName][$contains]
      if (key.startsWith("filters[")) {
        // Extract the actual filter structure
        const match = key.match(
          /filters\[([^\]]+)\](?:\[(\d+)\])?\[([^\]]+)\](?:\[([^\]]+)\])?/
        );
        if (match) {
          const [, operator, index, field, condition] = match;

          if (!parsed.filters) parsed.filters = {};

          if (operator === "$and") {
            if (!parsed.filters.$and) parsed.filters.$and = [];
            const idx = parseInt(index) || 0;
            if (!parsed.filters.$and[idx]) parsed.filters.$and[idx] = {};

            if (condition) {
              if (!parsed.filters.$and[idx][field])
                parsed.filters.$and[idx][field] = {};
              parsed.filters.$and[idx][field][condition] = value;
            } else {
              parsed.filters.$and[idx][field] = value;
            }
          }
        }
      } else {
        parsed[key] = value;
      }
    }

    return parsed;
  },

  convertToExcel(data) {
    const workbook = XLSX.utils.book_new();
    let hasData = false;

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

    for (const [contentType, entries] of Object.entries(data)) {
      // Clean sheet name (Excel has restrictions)
      const sheetName = contentType
        .split(".")
        .pop()
        .replace(/[^\w\s-]/gi, "_")
        .substring(0, 31);

      if (entries && entries.length > 0) {
        hasData = true;

        const attr = strapi.contentTypes[contentType].attributes;
        const customFields = Object.entries(attr)
          .filter(([key, definition]) => definition.customField)
          .map(([key]) => key);

        const relationFields = Object.entries(attr)
          .filter(([key, definition]) => definition.type === "relation")
          .map(([key]) => key);

        const skipFields = Object.entries(attr)
          .filter(([key, definition]) => definition.type === "media")
          .map(([key]) => key);

        const componentFields = Object.entries(attr)
          .filter(([key, definition]) => definition.type === "component")
          .map(([key]) => key);

        function handleObject(key, value) {
          if (!value) return;
          if (relationFields.includes(key)) {
            for (const field of SHORTCUT_FIELDS) {
              if (value[field]) {
                return value[field];
              }
            }
          }
          return undefined;
        }
        // Clean and flatten entries for Excel
        const cleanedEntries = entries.map((entry) => {
          function cleanAndFlatten(obj) {
            if (Array.isArray(obj)) {
              return obj.map(cleanAndFlatten);
            } else if (obj !== null && typeof obj === "object") {
              const result = {};

              for (const key in obj) {
                const value = obj[key];

                // Skip system keys
                if (SYSTEM_KEYS.includes(key)) continue;
                if (customFields.includes(key)) continue;
                if ([...skipFields, "wishlist", "availableSlot"].includes(key))
                  continue;

                if (componentFields.includes(key)) {
                  for (const subKey in value) {
                    if (subKey === "id") continue;
                    result[`${key}_${subKey}`] = value[subKey];
                  }
                  continue;
                }

                if (value === null || typeof value !== "object") {
                  result[key] = value;
                  continue;
                }

                if (!Array.isArray(value) && typeof value === "object") {
                  let temp = handleObject(key, value);
                  if (temp !== undefined) {
                    result[key] = temp;
                  }
                  continue;
                }

                if (Array.isArray(value)) {
                  if (value.length > 0 && typeof value[0] === "object") {
                    let arrValue = [];
                    for (const subValue in value) {
                      arrValue.push(handleObject(key, value[subValue]));
                    }
                    result[key] = arrValue;
                  } else {
                    result[key] = value;
                  }
                  continue;
                }
              }
              return result;
            } else {
              return obj; // primitive
            }
          }
          // Example usage
          const cleaned = cleanAndFlatten(entry);
          return cleaned;
        });

        function flattenForXLSX(obj) {
          const result = {};
          for (const key in obj) {
            const value = obj[key];
            if (Array.isArray(value)) {
              result[key] = value.join("|");
            } else {
              result[key] = value;
            }
          }
          return result;
        }
        const cleanedFlat = cleanedEntries.map((entry) =>
          flattenForXLSX(entry)
        );
        const worksheet = XLSX.utils.json_to_sheet(cleanedFlat);
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      } else {
        // Create empty sheet with headers if no data
        const worksheet = XLSX.utils.json_to_sheet([
          { message: "No data found" },
        ]);
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
        hasData = true; // Prevent empty workbook error
      }
    }

    // If still no data, create a default sheet
    if (!hasData) {
      const worksheet = XLSX.utils.json_to_sheet([
        { message: "No data to export" },
      ]);
      XLSX.utils.book_append_sheet(workbook, worksheet, "NoData");
    }

    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  },

  async exportSingleEntry(contentType, entryId) {
    try {
      const entry = await strapi.entityService.findOne(contentType, entryId, {
        populate: "*",
      });

      if (!entry) {
        throw new Error("Entry not found");
      }

      const exportData = {
        version: strapi.config.get("info.strapi"),
        timestamp: new Date().toISOString(),
        data: {
          [contentType]: [entry],
        },
      };

      return this.convertToExcel(exportData.data);
    } catch (error) {
      throw error;
    }
  },
});
