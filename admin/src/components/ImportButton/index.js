import React from 'react';

const ImportButton = () => {
  const handleImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

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
        window.location.reload();
      } else {
        throw new Error('Import failed');
      }
    } catch (error) {
      alert('Import failed: ' + error.message);
    } finally {
      event.target.value = '';
    }
  };

  return React.createElement('div', { style: { display: 'inline-block', marginLeft: '8px' } },
    React.createElement('input', {
      type: 'file',
      accept: '.xlsx,.xls,.json',
      onChange: handleImport,
      style: { display: 'none' },
      id: 'import-file-input'
    }),
    React.createElement('label', {
      htmlFor: 'import-file-input',
      style: {
        display: 'inline-block',
        padding: '8px 16px',
        backgroundColor: '#328048',
        color: 'white',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer'
      }
    }, 'Import Data')
  );
};

export default ImportButton;