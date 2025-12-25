import React, { useState } from "react";
import { Button } from "@strapi/design-system";
import { Upload } from "@strapi/icons";
import { useNotification } from "@strapi/strapi/admin";

const ImportButton = () => {
  const [isImporting, setIsImporting] = useState(false);
  const { toggleNotification } = useNotification();

  const handleImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsImporting(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/export-import-clsx/import", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        const imported = result.result.imported || 0;
        const errors = result.result.errors?.length || 0;

        if (errors > 0) {
          toggleNotification({
            type: "warning",
            message: `Import completed with ${errors} error(s). Imported: ${imported} entries`,
          });
        } else {
          toggleNotification({
            type: "success",
            message: `Import completed successfully! Imported: ${imported} entries`,
          });
        }

        window.location.reload();
      } else {
        throw new Error("Import failed");
      }
    } catch (error) {
      toggleNotification({
        type: "danger",
        message: `Import failed: ${error.message}`,
      });
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  };

  return (
    <div style={{ display: "inline-block", marginLeft: "8px" }}>
      <input
        type="file"
        accept=".xlsx,.xls,.json"
        onChange={handleImport}
        disabled={isImporting}
        style={{ display: "none" }}
        id="import-file-input"
      />
      <Button
        as="label"
        htmlFor="import-file-input"
        loading={isImporting}
        startIcon={<Upload />}
        variant="secondary"
        size="S"
        style={{ cursor: isImporting ? "not-allowed" : "pointer" }}
      >
        Import Data
      </Button>
    </div>
  );
};

export default ImportButton;
