const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// The wire protocol is shared with the desktop and the relay and lives beside this app, so Metro
// must watch it and resolve `@protocol/*` imports into it.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../protocol")];

module.exports = config;
