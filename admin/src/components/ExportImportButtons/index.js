import React, { useState } from 'react';

const ExportImportButtons = (props) => {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Get current content type from props or URL
  const getContentType = () => {
    if (props.layout?.uid) {
      return props.layout.uid;
    }
    // Fallback: extract from URL
    const path = window.location.pathname;
    const match = path.match(/\/admin\/content-manager\/collection-types\/([^\/]+)/);
    return match ? match[1] : null;
  };

  // Get current filters from URL
  const getCurrentFilters = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const filters = {};
    
    for (const [key, value] of urlParams.entries()) {
      if (key.startsWith('filters[') || key === 'sort' || key === 'page' || key === 'pageSize' || key === 'locale' || key === '_q') {
        filters[key] = value;
      }
    }
    
    return filters;
  };

  // Get selected entries from props
  const getSelectedEntries = () => {
    // Try to get selected entries from various possible props
    if (props.selectedEntries && props.selectedEntries.length > 0) {
      return props.selectedEntries;
    }
    if (props.selected && props.selected.length > 0) {
      return props.selected;
    }
    if (props.selection && props.selection.length > 0) {
      return props.selection;
    }
    const selectedIds = [];
    let field = '';
    const getHeaderKey = i => {
      const el = document.querySelector(`thead th:nth-child(${i}) button, thead th:nth-child(${i}) span`);
      if (!el) return '';
      const parts = el.textContent.trim().split(/\s+/);
      return parts.pop(); // last word
    };

    try {
      const rows = document.querySelectorAll('tbody tr');
      const allowedFields = [
        'id', 'name', 'title', 'tickerCode',
        'fullName', 'email', 'businessEmail',
        'telephone', 'mobile'
      ];

      let foundIndex = null;

      for (let i = 1; i <= 10; i++) {
        const headerBtn = getHeaderKey(i);
        if (headerBtn !== '' && allowedFields.includes(headerBtn)) {
          field = headerBtn;
          foundIndex = i;
          break;
        }
      }

      if (!foundIndex) {
        console.warn('No valid header column found');
        return [[], ''];
      }

      // gather values for selected rows
      rows.forEach(row => {
        const checkbox = row.querySelector('td:nth-child(1) button[role="checkbox"]');
        if (checkbox?.getAttribute('aria-checked') === 'true') {
          const cellSpan = row.querySelector(`td:nth-child(${foundIndex}) span`);
          const text = cellSpan?.textContent.trim();
          if (text) selectedIds.push(text);
        }
      });

      return [selectedIds, field];

    } catch (e) {
      console.error(e);
      return [[], ''];
    }
  };

  const handleExport = async () => {
    const contentType = getContentType();
    if (!contentType) {
      alert('Could not determine content type');
      return;
    }

    setIsExporting(true);
    try {
      const filters = getCurrentFilters();
      const [selectedEntries, selectedField] = getSelectedEntries();

      const queryParams = new URLSearchParams({
        format: 'excel',
        contentType: contentType,
        ...filters
      });

      // Add selected IDs if any
      if (selectedEntries.length > 0) {
        queryParams.set('selectedIds', JSON.stringify(selectedEntries));
        queryParams.set('selectedField', selectedField);
      }

      const response = await fetch(`/export-import-clsx/export?${queryParams}`);

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        // Set filename based on selection
        const filename = selectedEntries.length > 0 
          ? `${contentType.replace('api::', '')}-selected-${selectedEntries.length}-${new Date().toISOString().split('T')[0]}.xlsx`
          : `${contentType.replace('api::', '')}-export-${new Date().toISOString().split('T')[0]}.xlsx`;
        
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        throw new Error('Export failed');
      }
    } catch (error) {
      alert('Export failed: ' + error.message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const contentType = getContentType();
    if (!contentType) {
      alert('Could not determine content type');
      return;
    }

    setIsImporting(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('contentType', contentType);

    try {
      const response = await fetch('/export-import-clsx/import', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        
        // Create simple, human message
        const created = result.summary?.created || result.result.created;
        const updated = result.summary?.updated || result.result.updated;
        const errors = result.result.errors?.length || 0;
        
        const total = created + updated;
        let message = 'Import completed!\n\n';
        
        if (total > 0) {
          message += `Processed ${total} ${total === 1 ? 'entry' : 'entries'}\n`;
          if (created > 0) {
            message += `• Created: ${created}\n`;
          }
          if (updated > 0) {
            message += `• Updated: ${updated}\n`;
          }
        } else if (errors === 0) {
          message += 'No changes were made\n';
        }
        
        if (errors > 0) {
          message += `\nFound ${errors} ${errors === 1 ? 'error' : 'errors'}:\n`;
          result.result.errors.slice(0, 2).forEach((error, index) => {
            message += `• ${error}\n`;
          });
          if (errors > 2) {
            message += `• ... and ${errors - 2} more\n`;
          }
        }
        
        alert(message);
        
        // Reload the page to show new data
        window.location.reload();
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Import failed');
      }
    } catch (error) {
      alert('Import failed: ' + error.message);
    } finally {
      setIsImporting(false);
      event.target.value = '';
    }
  };

  const [selectedEntries, selectedField] = getSelectedEntries();
  const exportButtonText = isExporting 
    ? 'Exporting...' 
    : selectedEntries.length > 0 
      ? `Export (${selectedEntries.length})`
      : 'Export';

  return React.createElement('div', { 
    style: { 
      display: 'flex', 
      gap: '8px', 
      alignItems: 'center',
      marginRight: '16px',
      order: -1 // This will place it before other elements
    } 
  },
    // Export Button
    React.createElement('button', {
      onClick: handleExport,
      disabled: isExporting,
      style: {
        padding: '8px 16px',
        backgroundColor: isExporting ? '#dcdce4' : '#4945ff',
        color: 'white',
        border: 'none',
        borderRadius: '4px',
        fontSize: '14px',
        fontWeight: '500',
        cursor: isExporting ? 'not-allowed' : 'pointer',
        transition: 'background-color 0.2s'
      }
    }, exportButtonText),

    // Import Button - same color as Export
    React.createElement('div', { style: { position: 'relative' } },
      React.createElement('input', {
        type: 'file',
        accept: '.xlsx,.xls,.json',
        onChange: handleImport,
        disabled: isImporting,
        style: { display: 'none' },
        id: 'import-file-input'
      }),
      React.createElement('label', {
        htmlFor: 'import-file-input',
        style: {
          display: 'inline-block',
          padding: '8px 16px',
          backgroundColor: isImporting ? '#dcdce4' : '#4945ff', // Same color as Export
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          fontSize: '14px',
          fontWeight: '500',
          cursor: isImporting ? 'not-allowed' : 'pointer',
          transition: 'background-color 0.2s'
        }
      }, isImporting ? 'Importing...' : 'Import')
    )
  );
};

export default ExportImportButtons;