import React, { useState, useEffect } from 'react';

const HomePage = () => {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [contentTypes, setContentTypes] = useState([]);
  const [selectedContentType, setSelectedContentType] = useState('');

  useEffect(() => {
    // Fetch available content types
    fetch('/admin/content-manager/content-types')
      .then(res => res.json())
      .then(data => {
        const apiTypes = data.data.filter(ct => ct.uid.startsWith('api::'));
        setContentTypes(apiTypes);
      })
      .catch(err => console.error('Failed to fetch content types:', err));
  }, []);

  const handleExportAll = async () => {
    setIsExporting(true);
    try {
      const response = await fetch('/export-import-clsx/export?format=excel');
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `strapi-all-export-${new Date().toISOString().split('T')[0]}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        alert('Export completed successfully');
      } else {
        throw new Error('Export failed');
      }
    } catch (error) {
      alert('Export failed: ' + error.message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportSingle = async () => {
    if (!selectedContentType) {
      alert('Please select a content type');
      return;
    }

    setIsExporting(true);
    try {
      const response = await fetch(`/export-import-clsx/export?format=excel&contentType=${selectedContentType}`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selectedContentType.replace('api::', '')}-export-${new Date().toISOString().split('T')[0]}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        alert('Export completed successfully');
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

    setIsImporting(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/export-import-clsx/import', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Import completed! Imported: ${result.result.imported}, Errors: ${result.result.errors.length}`);
      } else {
        throw new Error('Import failed');
      }
    } catch (error) {
      alert('Import failed: ' + error.message);
    } finally {
      setIsImporting(false);
      event.target.value = '';
    }
  };

  return React.createElement('div', { 
    style: { 
      padding: '24px',
      maxWidth: '1200px',
      margin: '0 auto',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    } 
  },
    React.createElement('div', { style: { marginBottom: '32px' } },
      React.createElement('h1', { 
        style: { 
          fontSize: '32px', 
          fontWeight: '600', 
          color: '#212134',
          marginBottom: '8px'
        } 
      }, 'Export Import CLSX'),
      React.createElement('p', { 
        style: { 
          fontSize: '16px', 
          color: '#666687',
          margin: '0'
        } 
      }, 'Export and import your Strapi collections as Excel files')
    ),
    
    React.createElement('div', { 
      style: { 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', 
        gap: '24px' 
      } 
    },
      // Export All Card
      React.createElement('div', { 
        style: { 
          backgroundColor: 'white',
          border: '1px solid #dcdce4',
          borderRadius: '8px',
          padding: '24px',
          boxShadow: '0 1px 4px rgba(33, 33, 52, 0.1)'
        } 
      },
        React.createElement('h3', { 
          style: { 
            fontSize: '20px', 
            fontWeight: '600', 
            color: '#212134',
            marginBottom: '12px'
          } 
        }, 'Export All Collections'),
        React.createElement('p', { 
          style: { 
            fontSize: '14px', 
            color: '#666687',
            marginBottom: '20px',
            lineHeight: '1.5'
          } 
        }, 'Export all your API collections to a single Excel file with multiple sheets.'),
        React.createElement('button', {
          onClick: handleExportAll,
          disabled: isExporting,
          style: { 
            padding: '12px 24px', 
            backgroundColor: isExporting ? '#dcdce4' : '#4945ff', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: isExporting ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.2s'
          }
        }, isExporting ? 'Exporting...' : 'Export All Collections')
      ),

      // Export Single Card
      React.createElement('div', { 
        style: { 
          backgroundColor: 'white',
          border: '1px solid #dcdce4',
          borderRadius: '8px',
          padding: '24px',
          boxShadow: '0 1px 4px rgba(33, 33, 52, 0.1)'
        } 
      },
        React.createElement('h3', { 
          style: { 
            fontSize: '20px', 
            fontWeight: '600', 
            color: '#212134',
            marginBottom: '12px'
          } 
        }, 'Export Single Collection'),
        React.createElement('p', { 
          style: { 
            fontSize: '14px', 
            color: '#666687',
            marginBottom: '20px',
            lineHeight: '1.5'
          } 
        }, 'Export a specific collection to an Excel file.'),
        React.createElement('select', {
          value: selectedContentType,
          onChange: (e) => setSelectedContentType(e.target.value),
          style: {
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #dcdce4',
            borderRadius: '4px',
            fontSize: '14px',
            marginBottom: '16px',
            backgroundColor: 'white'
          }
        }, 
          React.createElement('option', { value: '' }, 'Select a collection...'),
          ...contentTypes.map(ct => 
            React.createElement('option', { 
              key: ct.uid, 
              value: ct.uid 
            }, ct.info.displayName || ct.info.singularName)
          )
        ),
        React.createElement('button', {
          onClick: handleExportSingle,
          disabled: isExporting || !selectedContentType,
          style: { 
            padding: '12px 24px', 
            backgroundColor: (isExporting || !selectedContentType) ? '#dcdce4' : '#328048', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: (isExporting || !selectedContentType) ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.2s'
          }
        }, isExporting ? 'Exporting...' : 'Export Collection')
      ),

      // Import Card
      React.createElement('div', { 
        style: { 
          backgroundColor: 'white',
          border: '1px solid #dcdce4',
          borderRadius: '8px',
          padding: '24px',
          boxShadow: '0 1px 4px rgba(33, 33, 52, 0.1)'
        } 
      },
        React.createElement('h3', { 
          style: { 
            fontSize: '20px', 
            fontWeight: '600', 
            color: '#212134',
            marginBottom: '12px'
          } 
        }, 'Import Data'),
        React.createElement('p', { 
          style: { 
            fontSize: '14px', 
            color: '#666687',
            marginBottom: '20px',
            lineHeight: '1.5'
          } 
        }, 'Import data from Excel or JSON files. Supports multiple collections.'),
        React.createElement('input', {
          type: 'file',
          accept: '.xlsx,.xls,.json',
          onChange: handleImport,
          disabled: isImporting,
          style: { display: 'none' },
          id: 'import-file'
        }),
        React.createElement('label', {
          htmlFor: 'import-file',
          style: { 
            display: 'inline-block',
            padding: '12px 24px', 
            backgroundColor: isImporting ? '#dcdce4' : '#f6a609', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: isImporting ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.2s'
          }
        }, isImporting ? 'Importing...' : 'Choose File to Import')
      )
    )
  );
};

export default HomePage;