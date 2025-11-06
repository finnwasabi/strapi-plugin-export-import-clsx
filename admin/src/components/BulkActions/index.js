import React from 'react';
import ExportButton from '../ExportButton';
import ImportButton from '../ImportButton';

const BulkActions = ({ layout }) => {
  const handleExportAll = async () => {
    try {
      const contentType = layout.uid;
      
      // Get current filters from URL if any
      const urlParams = new URLSearchParams(window.location.search);
      const filters = {};
      
      // Build filters from URL params
      for (const [key, value] of urlParams.entries()) {
        if (key.startsWith('filters[')) {
          filters[key] = value;
        }
      }

      const queryString = new URLSearchParams({
        format: 'excel',
        contentType: contentType,
        ...filters
      }).toString();

      const response = await fetch(`/export-import-clsx/export?${queryString}`);
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${contentType.replace('api::', '')}-export-${new Date().toISOString().split('T')[0]}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        throw new Error('Export failed');
      }
    } catch (error) {
      alert('Export failed: ' + error.message);
    }
  };

  return React.createElement('div', { 
    style: { 
      display: 'flex', 
      gap: '8px', 
      alignItems: 'center',
      marginLeft: '16px'
    } 
  },
    React.createElement('button', {
      onClick: handleExportAll,
      style: {
        padding: '8px 16px',
        backgroundColor: '#4945ff',
        color: 'white',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer'
      }
    }, 'Export All'),
    React.createElement(ImportButton)
  );
};

export default BulkActions;