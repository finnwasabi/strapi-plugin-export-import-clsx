import { useState, useRef } from "react";
import { Button } from "@strapi/design-system";
import { Download, Upload } from "@strapi/icons";
import { useNotification } from "@strapi/strapi/admin";

const ExportImportButtons = (props) => {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const { toggleNotification } = useNotification();

  // Get current content type from props or URL
  const getContentType = () => {
    if (props.layout?.uid) {
      return props.layout.uid;
    }
    // Fallback: extract from URL - handle both content-manager and event-manager
    const path = window.location.pathname;

    // For event-manager plugin
    const eventManagerMatch = path.match(
      /\/admin\/plugins\/event-manager\/([^\/]+)\/([^\/]+)/
    );
    if (eventManagerMatch) {
      return eventManagerMatch[2]; // Return the collectionType, not the eventId
    }

    // For content-manager
    const contentManagerMatch = path.match(
      /\/admin\/content-manager\/collection-types\/([^\/]+)/
    );
    if (contentManagerMatch) {
      return contentManagerMatch[1];
    }

    return null;
  };

  // Get event filter for event manager - simplified with exclude list
  const getEventFilter = () => {
    const path = window.location.pathname;
    const eventManagerMatch = path.match(
      /\/admin\/plugins\/event-manager\/([^\/]+)\/([^\/]+)/
    );

    if (eventManagerMatch) {
      const eventId = eventManagerMatch[1];
      const collectionType = eventManagerMatch[2];

      // Exclude list - content types that don't need event filtering
      const excludeFromEventFilter = [
        "api::audit-log.audit-log",
        "api::business-sector.business-sector",
        "api::email-template.email-template",
        "api::sales-person.sales-person",
        "api::speaker.speaker",
        // Add other content types that are not event-specific
      ];

      if (
        eventId &&
        eventId !== "events" &&
        !excludeFromEventFilter.includes(collectionType)
      ) {
        // Default to 'event' as relation field name (most common)
        return {
          eventId,
          relationField: "event",
        };
      }
    }

    return null;
  };

  // Get current filters from URL
  const getCurrentFilters = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const filters = {};

    for (const [key, value] of urlParams.entries()) {
      if (
        key.startsWith("filters[") ||
        key === "sort" ||
        key === "page" ||
        key === "pageSize" ||
        key === "locale" ||
        key === "_q"
      ) {
        filters[key] = value;
      }
    }

    return filters;
  };

  const handleExport = async () => {
    const contentType = getContentType();
    if (!contentType) {
      toggleNotification({
        type: "danger",
        message: "Could not determine content type",
      });
      return;
    }

    setIsExporting(true);
    try {
      const filters = getCurrentFilters();
      const eventFilter = getEventFilter();

      const queryParams = new URLSearchParams({
        format: "excel",
        contentType: contentType,
        ...filters,
      });

      // Add event filter if we're in event manager
      if (eventFilter) {
        queryParams.set(
          `filters[${eventFilter.relationField}][documentId][$eq]`,
          eventFilter.eventId
        );
      }

      const response = await fetch(`/export-import-clsx/export?${queryParams}`);

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;

        const filename = `${contentType.replace("api::", "")}-export-${
          new Date().toISOString().split("T")[0]
        }.xlsx`;

        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        toggleNotification({
          type: "success",
          message: "Successfully exported data",
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

  const handleImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const contentType = getContentType();
    if (!contentType) {
      toggleNotification({
        type: "danger",
        message: "Could not determine content type",
      });
      return;
    }

    setIsImporting(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("contentType", contentType);

    try {
      const response = await fetch("/export-import-clsx/import", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();

        // Create appropriate notification based on results
        const created = result.summary?.created || result.result.created;
        const updated = result.summary?.updated || result.result.updated;
        const errors = result.result.errors?.length || 0;

        const total = created + updated;

        if (errors > 0) {
          toggleNotification({
            type: "warning",
            message: `Import completed with ${errors} error(s). Processed ${total} entries (${created} created, ${updated} updated)`,
          });
        } else if (total > 0) {
          toggleNotification({
            type: "success",
            message: `Import completed successfully! Processed ${total} entries (${created} created, ${updated} updated)`,
          });
        } else {
          toggleNotification({
            type: "info",
            message: "Import completed - no changes were made",
          });
        }

        // Reload the page to show new data
        window.location.reload();
      } else {
        const error = await response.json();
        throw new Error(error.error || "Import failed");
      }
    } catch (error) {
      toggleNotification({
        type: "danger",
        message: `Import failed: ${error.message}`,
      });
    } finally {
      setIsImporting(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Create ref for file input
  const fileInputRef = useRef(null);

  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        alignItems: "center",
        order: -1,
      }}
    >
      <Button
        onClick={handleExport}
        loading={isExporting}
        startIcon={<Download />}
        variant="secondary"
        size="S"
      >
        Export
      </Button>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.json"
        onChange={handleImport}
        disabled={isImporting}
        style={{ display: "none" }}
      />
      <Button
        onClick={handleImportClick}
        loading={isImporting}
        startIcon={<Upload />}
        variant="secondary"
        size="S"
        disabled={isImporting}
      >
        Import
      </Button>
    </div>
  );
};

export default ExportImportButtons;
