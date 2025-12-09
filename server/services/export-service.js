const XLSX = require('xlsx');

module.exports = ({ strapi }) => ({
  async exportData(format = 'json', contentType = null, filters = {}, selectedIds = []) {
    // Get only API content types (collections)
    let contentTypes;
    if (contentType) {
      contentTypes = [contentType];
    } else {
      contentTypes = Object.keys(strapi.contentTypes).filter(
        (key) => key.startsWith('api::')
      );
    }

    const exportData = {
      version: strapi.config.get('info.strapi'),
      timestamp: new Date().toISOString(),
      data: {},
    };

    for (const ct of contentTypes) {
      try {
        // Parse filters from URL format
        const parsedFilters = this.parseFilters(filters);

        strapi.log.info(`Exporting ${ct} with raw filters:`, filters);
        strapi.log.info(`Parsed filters:`, parsedFilters);
        strapi.log.info(`Selected IDs:`, selectedIds);

        let entries = [];

        // If specific IDs are selected, export only those
        if (selectedIds && selectedIds.length > 0) {
          try {
            if (strapi.documents) {
              // Get entries by documentId for Strapi v5
              for (const id of selectedIds) {
                try {
                  const entry = await strapi.documents(ct).findOne({
                    documentId: id,
                    populate: '*',
                  });
                  if (entry) {
                    entries.push(entry);
                  }
                } catch (error) {
                  strapi.log.warn(`Failed to find entry ${id}:`, error.message);
                }
              }
            } else {
              // Fallback for older Strapi versions
              for (const id of selectedIds) {
                try {
                  const entry = await strapi.entityService.findOne(ct, id, {
                    populate: '*',
                  });
                  if (entry) {
                    entries.push(entry);
                  }
                } catch (error) {
                  strapi.log.warn(`Failed to find entry ${id}:`, error.message);
                }
              }
            }
          } catch (error) {
            strapi.log.error(`Failed to export selected entries:`, error);
          }
        } else {
          // Export all entries with filters
          try {
            if (strapi.documents) {
              // Get all entries (both published and draft) but avoid duplicates
              const allEntries = await strapi.documents(ct).findMany({
                populate: '*',
                // Don't specify status to get all
              });
              // Group by documentId and keep only the best version (published > modified draft > draft)
              const uniqueEntries = new Map();
              for (const entry of allEntries) {
                const docId = entry.documentId;
                const isPublished = !!entry.publishedAt;
                const isModified = entry.updatedAt !== entry.createdAt;
                if (!uniqueEntries.has(docId)) {
                  uniqueEntries.set(docId, entry);
                } else {
                  const existing = uniqueEntries.get(docId);
                  const existingIsPublished = !!existing.publishedAt;
                  const existingIsModified = existing.updatedAt !== existing.createdAt;
                  // Priority: published > modified draft > draft
                  if (isPublished && !existingIsPublished) {
                    uniqueEntries.set(docId, entry);
                  } else if (!isPublished && !existingIsPublished && isModified && !existingIsModified) {
                    uniqueEntries.set(docId, entry);
                  }
                }
              }

              entries = Array.from(uniqueEntries.values());
              strapi.log.info(`Found ${allEntries.length} total entries, ${entries.length} unique entries after deduplication`);

              // Apply filters
              if (parsedFilters && Object.keys(parsedFilters).length > 0) {
                strapi.log.info('Applying filters:', parsedFilters);
                entries = this.applyClientSideFilters(entries, parsedFilters);
                strapi.log.info(`After filtering: ${entries.length} entries`);
              }
            } else {
              // Fallback for older Strapi versions
              entries = await strapi.entityService.findMany(ct, {
                populate: '*',
                filters: parsedFilters,
              });
              strapi.log.info(`EntityService found ${entries?.length || 0} entries`);
            }
          } catch (error) {
            strapi.log.error(`Failed to query entries:`, error);
          }
        }

        strapi.log.info(`Final result: ${entries?.length || 0} entries for ${ct} (total found: ${entries?.length || 0})`);

        if (entries && entries.length > 0) {
          exportData.data[ct] = entries;
        }
      } catch (error) {
        strapi.log.error(`Failed to export ${ct}:`, error);
      }
    }

    if (format === 'excel') {
      return this.convertToExcel(exportData.data);
    }

    return exportData;
  },

  parseFilters(filters) {
    const parsed = {};
    for (const [key, value] of Object.entries(filters)) {
      // Skip pagination and sorting params
      if (['page', 'pageSize', 'sort', 'locale', 'format', 'contentType', 'selectedIds'].includes(key)) {
        continue;
      }

      // Handle URL encoded filter format like filters[$and][0][shortName][$contains]
      if (key.startsWith('filters[')) {
        // Extract the actual filter structure
        const match = key.match(/filters\[([^\]]+)\](?:\[(\d+)\])?\[([^\]]+)\](?:\[([^\]]+)\])?/);
        if (match) {
          const [, operator, index, field, condition] = match;

          if (!parsed.filters) parsed.filters = {};

          if (operator === '$and') {
            if (!parsed.filters.$and) parsed.filters.$and = [];
            const idx = parseInt(index) || 0;
            if (!parsed.filters.$and[idx]) parsed.filters.$and[idx] = {};

            if (condition) {
              if (!parsed.filters.$and[idx][field]) parsed.filters.$and[idx][field] = {};
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

  applyClientSideFilters(entries, filters) {
    if (!filters || Object.keys(filters).length === 0) {
      return entries;
    }

    const filtered = entries.filter(entry => {
      // Handle structured filters
      if (filters.filters && filters.filters.$and) {
        for (const condition of filters.filters.$and) {
          for (const [field, criteria] of Object.entries(condition)) {
            if (typeof criteria === 'object' && criteria.$contains) {
              // Handle $contains filter
              if (entry[field]) {
                const fieldValue = String(entry[field]).toLowerCase();
                const searchValue = String(criteria.$contains).toLowerCase();
                if (!fieldValue.includes(searchValue)) {
                  return false;
                }
              } else {
                return false; // Field doesn't exist, exclude entry
              }
            } else {
              // Handle exact match
              if (entry[field] !== criteria) {
                return false;
              }
            }
          }
        }
      }
      // Handle other filter formats
      for (const [key, value] of Object.entries(filters)) {
        if (key === 'filters') continue; // Already handled above

        // Handle simple search (global search)
        if (key === '_q' || key === 'search') {
          // Global search across main fields
          const searchFields = ['shortName', 'name', 'title'];
          const searchValue = String(value).toLowerCase();
          const found = searchFields.some(field => {
            if (entry[field]) {
              return String(entry[field]).toLowerCase().includes(searchValue);
            }
            return false;
          });
          if (!found) {
            return false;
          }
        }
      }
      return true;
    });

    return filtered;
  },

  convertToExcel(data) {
    const workbook = XLSX.utils.book_new();
    let hasData = false;

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
    const NAME_FIELD = "name";
    const TITLE = "title";

    for (const [contentType, entries] of Object.entries(data)) {
      // Clean sheet name (Excel has restrictions)
      const sheetName = contentType
        .split('.')
        .pop()
        .replace(/[^\w\s]/gi, '_')
        .substring(0, 31);

      if (entries && entries.length > 0) {
        hasData = true;

        const attr = strapi.contentTypes[contentType].attributes;
        const customFields = Object.entries(attr)
          .filter(([key, definition]) =>
            definition.customField && definition.type !== 'json'
          )
          .map(([key]) => key);

        const relationFields = Object.entries(attr)
          .filter(([key, definition]) => definition.type === 'relation')
          .map(([key]) => key);

        function handleObject(key, value) {
          if (!value) return;
          if (EMAIL_KEYS.includes(key)) {
            for (const emailField of EMAIL_FIELDS) {
              if (value[emailField]) {
                return value[emailField];
              }
            }
          } else if (TICKER_KEYS.includes(key)) {
            if (value[TICKER_FIELD]) {
              return value[TICKER_FIELD];
            }
          } else if (relationFields.includes(key)) {
            if (value[NAME_FIELD]) {
              return value[NAME_FIELD];
            } else if (value[TITLE]) {
              return value[TITLE];
            }
          }
          return undefined
        }

        // Clean and flatten entries for Excel
        const cleanedEntries = entries.map(entry => {
          function cleanAndFlatten(obj) {
            if (Array.isArray(obj)) {
              return obj.map(cleanAndFlatten);
            } else if (obj !== null && typeof obj === 'object') {
              const result = {};

              for (const key in obj) {
                const value = obj[key];

                // Skip system keys
                if (SYSTEM_KEYS.includes(key)) continue;
                if (customFields.includes(key)) continue;

                if (value === null || typeof value !== 'object') {
                  result[key] = value;
                  continue;
                }

                if (!Array.isArray(value) && typeof value === 'object') {
                  let temp = handleObject(key, value);
                  if (temp !== undefined) {
                    result[key] = temp;
                  }
                  continue;
                }

                if (Array.isArray(value)) {
                  if (value.length > 0 && typeof value[0] === 'object') {
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

                // Component (no documentId)
                if (!('documentId' in value)) {
                  for (const subKey in value) {
                    if (subKey === 'id') continue; // skip id
                    result[`${key}_${subKey}`] = value[subKey];
                  }
                  continue; // skip keeping the original key
                }
                // Relation object (has documentId)
                result[key] = cleanAndFlatten(value);
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
              result[key] = value.join(",");
            } else {
              result[key] = value;
            }
          }
          return result;
        }
        const cleanedFlat = cleanedEntries.map(entry => flattenForXLSX(entry));
        const worksheet = XLSX.utils.json_to_sheet(cleanedFlat);
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      } else {
        // Create empty sheet with headers if no data
        const worksheet = XLSX.utils.json_to_sheet([{ message: 'No data found' }]);
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
        hasData = true; // Prevent empty workbook error
      }
    }

    // If still no data, create a default sheet
    if (!hasData) {
      const worksheet = XLSX.utils.json_to_sheet([{ message: 'No data to export' }]);
      XLSX.utils.book_append_sheet(workbook, worksheet, 'NoData');
    }

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  },

  async exportSingleEntry(contentType, entryId) {
    try {
      const entry = await strapi.entityService.findOne(contentType, entryId, {
        populate: '*',
      });

      if (!entry) {
        throw new Error('Entry not found');
      }

      const exportData = {
        version: strapi.config.get('info.strapi'),
        timestamp: new Date().toISOString(),
        data: {
          [contentType]: [entry]
        },
      };

      return this.convertToExcel(exportData.data);
    } catch (error) {
      throw error;
    }
  },
});