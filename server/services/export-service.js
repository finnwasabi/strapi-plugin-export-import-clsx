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

    for (const [contentType, entries] of Object.entries(data)) {
      // Clean sheet name (Excel has restrictions)
      const sheetName = contentType.replace(/[^\w\s]/gi, '_').substring(0, 31);
      
      if (entries && entries.length > 0) {
        hasData = true;
        
        // Clean and flatten entries for Excel
        const cleanedEntries = entries.map(entry => {
          // Keep important system fields for import
          const { 
            createdBy, 
            updatedBy, 
            localizations,
            ...entryWithSystemFields 
          } = entry;

          const flattened = {
            // Always include these at the beginning for import reference
            id: entry.id,
            documentId: entry.documentId,
            locale: entry.locale || 'en',
          };
          
          const flatten = (obj, prefix = '') => {
            for (const key in obj) {
              // Skip already processed system fields and status fields
              if (['id', 'documentId', 'createdBy', 'updatedBy', 'localizations', 'publishedAt', 'status'].includes(key)) {
                continue;
              }
              
              if (obj[key] !== null && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
                // Skip nested objects that are system fields
                if (key === 'createdBy' || key === 'updatedBy') {
                  continue;
                }
                flatten(obj[key], prefix + key + '_');
              } else if (Array.isArray(obj[key])) {
                flattened[prefix + key] = JSON.stringify(obj[key]);
              } else {
                flattened[prefix + key] = obj[key];
              }
            }
          };
          
          flatten(entryWithSystemFields);
          return flattened;
        });

        const worksheet = XLSX.utils.json_to_sheet(cleanedEntries);
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