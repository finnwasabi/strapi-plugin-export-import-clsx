module.exports = [
  {
    method: 'GET',
    path: '/export',
    handler: 'export-controller.export',
    config: {
      policies: [],
      auth: false,
    },
  },
  {
    method: 'GET',
    path: '/export/:contentType/:id',
    handler: 'export-controller.exportSingle',
    config: {
      policies: [],
      auth: false,
    },
  },
  {
    method: 'POST',
    path: '/import',
    handler: 'import-controller.import',
    config: {
      policies: [],
      auth: false,
    },
  },
];