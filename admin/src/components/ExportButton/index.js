import React from 'react';

const ExportButton = ({ layout, modifiedData }) => {
  const handleExport = async () => {
    try {
      const contentType = layout.uid;
      const entryId = modifiedData.id;
      
      if (!entryId) {
        alert('Please save the entry first');
        return;
      }

      const response = await fetch(`/export-import-clsx/export/${contentType}/${entryId}`);
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `entry-${entryId}-${new Date().toISOString().split('T')[0]}.xlsx`;
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

  return React.createElement('button', {
    onClick: handleExport,
    style: {
      padding: '8px 16px',
      backgroundColor: '#4945ff',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      marginLeft: '8px'
    }
  }, 'Export Entry');
};

export default ExportButton;