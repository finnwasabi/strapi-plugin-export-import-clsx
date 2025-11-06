# @tunghtml/strapi-plugin-export-import-clsx

A powerful Strapi plugin for exporting and importing data with enhanced functionality, including Excel support and advanced filtering.

## Features

- 📊 **Excel Export/Import**: Full support for .xlsx files
- 🔍 **Advanced Filtering**: Export filtered data based on UI filters
- 🎯 **Selective Export**: Export specific entries by selection
- 🌐 **Multi-locale Support**: Handle localized content properly
- 🔄 **Bulk Operations**: Import multiple entries efficiently
- 📝 **Smart Deduplication**: Avoid duplicate entries during import
- 🎨 **Clean UI**: Integrated seamlessly with Strapi admin panel

## Installation

```bash
npm install @tunghtml/strapi-plugin-export-import-clsx
# or
yarn add @tunghtml/strapi-plugin-export-import-clsx
```

## Usage

1. Install the plugin in your Strapi project
2. Add it to your `config/plugins.js`:

```javascript
module.exports = {
  'export-import-clsx': {
    enabled: true,
  },
};
```

3. Restart your Strapi application
4. Navigate to the plugin in your admin panel

## API Endpoints

### Export Data
```
GET /export-import-clsx/export
```

Query parameters:
- `format`: `excel` or `json` (default: `excel`)
- `contentType`: Specific content type to export (e.g., `api::article.article`)
- `selectedIds`: Array of specific entry IDs to export
- `filters[...]`: Advanced filtering options

### Import Data
```
POST /export-import-clsx/import
```

Body: Excel file or JSON data

## Examples

### Export all articles as Excel
```bash
curl "http://localhost:1337/export-import-clsx/export?format=excel&contentType=api::article.article"
```

### Export filtered data
```bash
curl "http://localhost:1337/export-import-clsx/export?format=excel&contentType=api::article.article&filters[$and][0][title][$contains]=news"
```

### Export selected entries
```bash
curl "http://localhost:1337/export-import-clsx/export?format=excel&contentType=api::article.article&selectedIds=[\"1\",\"2\",\"3\"]"
```

## Configuration

The plugin works out of the box with default settings. For advanced configuration, you can customize the behavior in your Strapi application.

## Compatibility

- Strapi v4.x
- Strapi v5.x (with document service support)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © finnwasabi

## Support

For issues and questions, please create an issue on the GitHub repository.