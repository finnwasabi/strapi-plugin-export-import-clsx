module.exports = ({ strapi }) => ({
  async import(ctx) {
    try {
      const { files, body } = ctx.request;
      
      if (!files || !files.file) {
        return ctx.throw(400, 'No file provided');
      }

      const file = Array.isArray(files.file) ? files.file[0] : files.file;
      const targetContentType = body.contentType;
      
      const importService = strapi.plugin('export-import-clsx').service('import-service');
      
      const result = await importService.importData(file);
      
      // Create appropriate message based on results
      let message = 'Import completed successfully';
      if (result.errors && result.errors.length > 0) {
        message = `Import completed with ${result.errors.length} error(s). Please check the details below.`;
      }
      
      ctx.body = {
        message,
        result,
        summary: {
          total: result.created + result.updated,
          created: result.created,
          updated: result.updated,
          errors: result.errors.length,
        },
      };
    } catch (error) {
      strapi.log.error('Import error:', error);
      ctx.body = {
        error: error.message,
        details: error.stack
      };
      ctx.status = 500;
    }
  },
});