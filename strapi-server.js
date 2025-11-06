module.exports = {
  register({ strapi }) {
    // Register phase
  },

  bootstrap({ strapi }) {
    // Bootstrap phase
  },

  destroy({ strapi }) {
    // Destroy phase
  },

  config: {
    default: {},
    validator() {},
  },

  controllers: {
    'export-controller': require('./server/controllers/export-controller'),
    'import-controller': require('./server/controllers/import-controller'),
  },

  routes: require('./server/routes'),

  services: {
    'export-service': require('./server/services/export-service'),
    'import-service': require('./server/services/import-service'),
  },

  contentTypes: {},
  policies: {},
  middlewares: {},
};