import React, { useState } from "react";
import { Button } from "@strapi/design-system";
import { Download } from "@strapi/icons";
import { useNotification } from "@strapi/strapi/admin";

const ExportButton = ({ layout, modifiedData }) => {
  const [isExporting, setIsExporting] = useState(false);
  const { toggleNotification } = useNotification();

  const handleExport = async () => {
    try {
      const contentType = layout.uid;
      const entryId = modifiedData.id;

      if (!entryId) {
        toggleNotification({
          type: "warning",
          message: "Please save the entry first",
        });
        return;
      }

      setIsExporting(true);

      const response = await fetch(
        `/export-import-clsx/export/${contentType}/${entryId}`
      );

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `entry-${entryId}-${new Date().toISOString().split("T")[0]}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        toggleNotification({
          type: "success",
          message: "Entry exported successfully",
        });
      } else {
        throw new Error("Export failed");
      }
    } catch (error) {
      toggleNotification({
        type: "danger",
        message: `Export failed: ${error.message}`,
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      onClick={handleExport}
      loading={isExporting}
      startIcon={<Download />}
      variant="secondary"
      size="S"
      style={{ marginLeft: "8px" }}
    >
      Export Entry
    </Button>
  );
};

export default ExportButton;
