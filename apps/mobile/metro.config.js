const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

// expo/metro-config handles the pnpm monorepo (workspace packages) automatically.
const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css' });
