import pluginPkg from "./package.json";
import pluginId from "./admin/src/pluginId";
import Initializer from "./admin/src/components/Initializer";
import ExportImportButtons from "./admin/src/components/ExportImportButtons";

const name = pluginPkg.strapi.name;

export default {
  register(app) {
    const plugin = {
      id: pluginId,
      initializer: Initializer,
      isReady: false,
      name,
    };

    app.registerPlugin(plugin);
  },

  bootstrap(app) {
    const contentManager = app.getPlugin("content-manager");
    if (contentManager && contentManager.injectComponent) {
      contentManager.injectComponent("listView", "actions", {
        name: "export-import-buttons",
        Component: ExportImportButtons,
      });
    }
  },
};
