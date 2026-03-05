# Punto U App with Vercel Speed Insights

This is the Punto U application with Vercel Speed Insights integration for performance monitoring.

## Features

- University campus mission/task management system
- Real-time chat and comments
- User profiles and ratings
- **Vercel Speed Insights** - Performance monitoring integrated

## Speed Insights Implementation

Vercel Speed Insights has been added to this application to track real user performance metrics. The implementation follows Vercel's best practices for React applications.

### What was added:

1. **Package Installation**: `@vercel/speed-insights` package added to dependencies
2. **Component Integration**: The `<SpeedInsights />` component from `@vercel/speed-insights/react` is imported and rendered in the main `App.jsx` file
3. **Project Structure**: Proper Vite + React project structure with all necessary configuration files

### How it works:

The `<SpeedInsights />` component is rendered at the root level of the application (in `src/App.jsx`) and automatically:
- Tracks Core Web Vitals (LCP, FID, CLS, FCP, TTFB)
- Sends performance data to Vercel when the app is deployed
- Requires no additional configuration for basic usage

### Files Modified/Created:

- `src/App.jsx` - Main app wrapper with SpeedInsights component
- `src/main.jsx` - React entry point
- `src/PuntoU.jsx` - Original application component (moved from root)
- `package.json` - Project configuration with Speed Insights dependency
- `vite.config.js` - Vite configuration
- `index.html` - HTML entry point
- `.eslintrc.cjs` - ESLint configuration
- `.gitignore` - Git ignore rules

## Next Steps

After deploying to Vercel:

1. **Enable Speed Insights** on the Vercel dashboard for your project
2. The `/_vercel/speed-insights/script.js` endpoint will be automatically available
3. **View Metrics** in the Speed Insights tab of your Vercel project dashboard after users visit your site

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run linter
npm run lint
```

## Deployment

Deploy to Vercel:

```bash
vercel deploy
```

Or connect your Git repository to Vercel for automatic deployments on push.

## Learn More

- [Vercel Speed Insights Documentation](https://vercel.com/docs/speed-insights)
- [Speed Insights Package](https://vercel.com/docs/speed-insights/package)
- [Core Web Vitals](https://web.dev/vitals/)
