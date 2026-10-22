const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);
// The bundled fonts (src/theme/fonts.web.ts): neither Metro's nor Expo's default asset list has woff2, and without it
// a require of a font is read as source. On web the require then yields the hashed file's URL under /assets/.
config.resolver.assetExts = [...config.resolver.assetExts, "woff2"];
module.exports = withNativeWind(config, { input: "./global.css" });
