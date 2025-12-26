module.exports = ({ strapi }) => ({
  async export(ctx) {
    try {
      const { format = "excel", contentType, ...filters } = ctx.query;
      const exportService = strapi
        .plugin("export-import-clsx")
        .service("export-service");

      if (format === "excel") {
        const buffer = await exportService.exportData(
          "excel",
          contentType,
          filters
        );

        const filename = `${
          contentType?.replace("api::", "") || "strapi"
        }-export-${new Date().toISOString().split("T")[0]}.xlsx`;

        ctx.set(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        ctx.set("Content-Disposition", `attachment; filename="${filename}"`);

        ctx.body = buffer;
      } else {
        const data = await exportService.exportData(
          "json",
          contentType,
          filters
        );

        const filename = `${
          contentType?.replace("api::", "") || "strapi"
        }-export-${new Date().toISOString().split("T")[0]}.json`;

        ctx.set("Content-Type", "application/json");
        ctx.set("Content-Disposition", `attachment; filename="${filename}"`);

        ctx.body = JSON.stringify(data, null, 2);
      }
    } catch (error) {
      strapi.log.error("Export error:", error);
      ctx.throw(500, "Export failed");
    }
  },

  async exportSingle(ctx) {
    try {
      const { contentType, id } = ctx.params;
      const exportService = strapi
        .plugin("export-import-clsx")
        .service("export-service");

      const buffer = await exportService.exportSingleEntry(contentType, id);

      ctx.set(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      ctx.set(
        "Content-Disposition",
        `attachment; filename="entry-${id}-${
          new Date().toISOString().split("T")[0]
        }.xlsx"`
      );

      ctx.body = buffer;
    } catch (error) {
      strapi.log.error("Export single error:", error);
      ctx.throw(500, "Export failed");
    }
  },
});
