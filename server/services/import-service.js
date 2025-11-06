const fs = require('fs');
const XLSX = require('xlsx');

module.exports = ({ strapi }) => ({
  async importData(file, targetContentType = null) {
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
        const workbook = XLSX.readFile(filePath);
        importData = {};
        
        strapi.log.info('Excel sheet names:', workbook.SheetNames);
        
        // Convert each sheet to data
        workbook.SheetNames.forEach(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);
          strapi.log.info(`Sheet ${sheetName} has ${jsonData.length} rows`);
          if (jsonData.length > 0) {
            // Map sheet name back to content type
            let contentTypeName = sheetName;
            if (sheetName.startsWith('api__')) {
              // Convert api__corporate_corporate to api::corporate.corporate
              contentTypeName = sheetName.replace(/^api__/, 'api::').replace(/_/g, '.');
            }
            
            // Unflatten Excel data back to nested objects
            const unflattened = jsonData.map((row, index) => {
              const result = {};
              
              // Known component prefixes that should be unflattened
              const componentPrefixes = ['corporateInfo', 'meetingRequirements', 'internalInfo'];
              
              for (const [key, value] of Object.entries(row)) {
                // Skip completely empty values but keep 0, false, etc.
                if (value === null || value === undefined || value === '') {
                  continue;
                }
                
                // Check if this key should be unflattened
                const shouldUnflatten = key.includes('_') && 
                  !['createdAt', 'updatedAt', 'publishedAt'].includes(key) &&
                  componentPrefixes.some(prefix => key.startsWith(prefix + '_'));
                
                if (shouldUnflatten) {
                  // Handle nested objects like corporateInfo_companyName
                  const parts = key.split('_');
                  let current = result;
                  
                  for (let i = 0; i < parts.length - 1; i++) {
                    if (!current[parts[i]]) {
                      current[parts[i]] = {};
                    }
                    current = current[parts[i]];
                  }
                  
                  current[parts[parts.length - 1]] = value;
                } else {
                  // Handle arrays/JSON strings
                  if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
                    try {
                      result[key] = JSON.parse(value);
                    } catch (error) {
                      result[key] = value; // Keep as string if parsing fails
                    }
                  } else {
                    result[key] = value;
                  }
                }
              }
              
              // Debug info removed for cleaner logs
              
              return result;
            });
            
            importData[contentTypeName] = unflattened;
            strapi.log.info(`Mapped sheet ${sheetName} to ${contentTypeName}`);
          }
        });
        
        strapi.log.info('Final import data keys:', Object.keys(importData));
      } else {
        throw new Error('Unsupported file format. Please use JSON or Excel files.');
      }

      const results = {
        created: 0,
        updated: 0,
        errors: [],
      };

      // Handle different data structures
      const dataToProcess = importData.data || importData;

      for (const [contentType, entries] of Object.entries(dataToProcess)) {
        try {
          // If targetContentType is specified, only process that content type
          if (targetContentType && contentType !== targetContentType) {
            continue;
          }

          // Skip if not an API content type
          if (!contentType.startsWith('api::')) {
            continue;
          }

          // Check if content type exists
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
              // Extract system fields for update/create logic
              const { 
                id, 
                documentId, 
                status,
                createdAt, 
                updatedAt, 
                publishedAt, 
                createdBy, 
                updatedBy, 
                localizations,
                locale,
                ...cleanEntry 
              } = entry;

              // Skip empty entries
              if (!cleanEntry || Object.keys(cleanEntry).length === 0) {
                strapi.log.warn('Skipping empty entry');
                continue;
              }
              
              // Clean up empty string values and convert to null
              for (const [key, value] of Object.entries(cleanEntry)) {
                if (value === '' || value === 'null' || value === 'undefined') {
                  cleanEntry[key] = null;
                }
              }
              
              let existingEntry = null;
              let updateMode = false;
              
              // Only try to find existing entry if documentId is provided and valid
              if (documentId && documentId !== '' && documentId !== 'null' && documentId !== 'undefined') {
                try {
                  if (strapi.documents) {
                    existingEntry = await strapi.documents(contentType).findOne({
                      documentId: documentId,
                    });
                    if (existingEntry) {
                      updateMode = true;
                      strapi.log.info(`Found existing entry for update: ${documentId}`);
                    }
                  }
                } catch (error) {
                  // Entry not found, will create new one
                  strapi.log.info(`DocumentId ${documentId} not found, will create new entry`);
                }
              }
              
              // If no documentId provided or not found, this will be a new entry
              if (!existingEntry) {
                strapi.log.info(`Creating new entry for: ${cleanEntry.shortName || cleanEntry.name || cleanEntry.title || 'Unknown'}`);
              }
              
              // Skip entries without basic required fields
              if (!cleanEntry.shortName && !cleanEntry.name && !cleanEntry.title) {
                continue;
              }
              
              // Ensure required components exist for corporate
              if (contentType === 'api::corporate.corporate') {
                if (!cleanEntry.corporateInfo) cleanEntry.corporateInfo = {};
                if (!cleanEntry.meetingRequirements) cleanEntry.meetingRequirements = {};
                if (!cleanEntry.internalInfo) cleanEntry.internalInfo = {};
              }
              
              if (existingEntry) {
                // Check if there are actual changes before updating
                const hasChanges = this.hasDataChanges(existingEntry, cleanEntry);
                const statusChanged = (status === 'published') !== !!existingEntry.publishedAt;
                
                if (hasChanges || statusChanged) {
                  try {
                    if (strapi.documents) {
                      const updateData = {
                        documentId: existingEntry.documentId,
                        data: cleanEntry,
                      };
                      
                      // Handle status change
                      if (statusChanged) {
                        updateData.status = status === 'published' ? 'published' : 'draft';
                      }
                      
                      await strapi.documents(contentType).update(updateData);
                      results.updated++;
                    } else {
                      await strapi.entityService.update(contentType, existingEntry.id, {
                        data: cleanEntry,
                      });
                      results.updated++;
                    }
                  } catch (updateError) {
                    results.errors.push(`Failed to update entry: ${updateError.message}`);
                  }
                } else {
                  // No changes, skip update
                  strapi.log.info(`No changes detected for entry: ${cleanEntry.shortName || 'Unknown'}`);
                }
              } else {
                // Create new entry
                try {
                  if (strapi.documents) {
                    await strapi.documents(contentType).create({
                      data: cleanEntry,
                      status: status === 'published' ? 'published' : 'draft',
                    });
                    results.created++;
                  } else {
                    await strapi.entityService.create(contentType, {
                      data: cleanEntry,
                    });
                    results.created++;
                  }
                } catch (createError) {
                  results.errors.push(`Failed to create entry: ${createError.message}`);
                }
              }
            } catch (error) {
              results.errors.push(`Failed to import entry in ${contentType}: ${error.message}`);
              strapi.log.error('Import entry error:', error);
            }
          }
        } catch (error) {
          results.errors.push(`Failed to process ${contentType}: ${error.message}`);
          strapi.log.error('Import process error:', error);
        }
      }

      // Clean up uploaded file
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      return results;
    } catch (error) {
      // Clean up uploaded file on error
      const filePath = file && (file.path || file.filepath);
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      throw error;
    }
  },

  hasDataChanges(existingEntry, newData) {
    // Compare key fields to detect changes
    const fieldsToCompare = ['shortName', 'name', 'title'];
    
    for (const field of fieldsToCompare) {
      if (existingEntry[field] !== newData[field]) {
        return true;
      }
    }
    
    // Compare nested objects (components)
    const componentsToCompare = ['corporateInfo', 'meetingRequirements', 'internalInfo'];
    
    for (const component of componentsToCompare) {
      if (existingEntry[component] && newData[component]) {
        const existingStr = JSON.stringify(existingEntry[component]);
        const newStr = JSON.stringify(newData[component]);
        if (existingStr !== newStr) {
          return true;
        }
      }
    }
    
    return false;
  },
});