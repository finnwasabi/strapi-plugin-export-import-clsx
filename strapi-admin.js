import React from "react";
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
    // Try different injection methods for Strapi v5
    try {
      // Method 1: Direct injection
      if (app.injectContentManagerComponent) {
        app.injectContentManagerComponent("listView", "actions", {
          name: "export-import-buttons",
          Component: ExportImportButtons,
        });
      }
      // Method 2: Plugin-based injection
      else if (app.getPlugin) {
        const contentManager = app.getPlugin("content-manager");
        if (contentManager && contentManager.injectComponent) {
          contentManager.injectComponent("listView", "actions", {
            name: "export-import-buttons",
            Component: ExportImportButtons,
          });
        }
      }
      // Method 3: Global injection
      else if (app.addComponent) {
        app.addComponent(
          "content-manager.listView.actions",
          ExportImportButtons
        );
      }
    } catch (error) {
      console.warn("Failed to inject export-import buttons:", error);

      // Fallback: Add as menu item if injection fails
      app.addMenuLink({
        to: `/plugins/${pluginId}`,
        icon: () => React.createElement("span", null, "📊"),
        intlLabel: {
          id: `${pluginId}.plugin.name`,
          defaultMessage: "Export Import",
        },
        Component: async () => {
          const component = await import("./admin/src/pages/App");
          return component;
        },
        permissions: [],
      });
    }
  },

  async registerTrads(app) {
    const { locales } = app;

    const importedTrads = await Promise.all(
      locales.map((locale) => {
        return import(`./admin/src/translations/${locale}.json`)
          .then(({ default: data }) => {
            return {
              data: data,
              locale,
            };
          })
          .catch(() => {
            return {
              data: {},
              locale,
            };
          });
      })
    );

    return Promise.resolve(importedTrads);
  },
};
