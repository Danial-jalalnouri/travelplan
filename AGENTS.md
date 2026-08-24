# AGENTS.md

## File Organization Rules

When implementing features or making changes:

### HTML Files
- Store all HTML in `.html` files
- Place HTML files in the project root or appropriate directory

### JavaScript Files
- Store all JavaScript in `.js` files
- Place JS files in the `js/` folder
- Create the `js/` folder if it doesn't exist
- Configuration files (like `config.js`) should be loaded before main app files

### CSS Files
- Store all CSS in `.css` files
- Place CSS files in the `css/` folder
- Create the `css/` folder if it doesn't exist

### README Maintenance
- If no `README.md` exists, create one documenting the project
- After each change, update the `README.md` with:
  - New features added
  - Files modified
  - Setup instructions (if changed)
  - Any other relevant changes

### Cache Busting (Version Numbers)
Always add version query parameters to CSS and JS file references to prevent browser caching issues:
- HTML files: `<link rel="stylesheet" href="css/styles.css?v=1.0.0">`
- HTML files: `<script src="js/app.js?v=1.0.0"></script>`
- Increment version numbers when making changes:
  - Minor changes (formatting, comments): `?v=1.0.1`
  - Feature additions: `?v=1.1.0`
  - Major changes: `?v=2.0.0`
- This ensures users always see the latest version without hard refresh
- **IMPORTANT**: When modifying any JS or CSS file, you MUST update the version in index.html accordingly

## Example Structure

```
project/
├── index.html
├── README.md
├── css/
│   └── styles.css
└── js/
    └── script.js
```
