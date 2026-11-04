// Adds the NotificationService app-extension target to an Xcode project (the `xcode` package's
// object model, as handed to `withXcodeProject`). Follows the pattern public NSE plugins use:
// group, native target, three build phases, per-configuration build settings. Idempotent.
const fs = require("node:fs");
const path = require("node:path");
const { NSE_TARGET_NAME, NSE_BUNDLE_ID } = require("./constants");

const SOURCE_FILES = ["NotificationService.swift"];
const RESOURCE_FILES = ["Info.plist", "NotificationService.entitlements"];

function firstDeploymentTarget(project) {
  const configurations = project.pbxXCBuildConfigurationSection();
  for (const key of Object.keys(configurations)) {
    const target = configurations[key].buildSettings?.IPHONEOS_DEPLOYMENT_TARGET;
    if (target) return String(target);
  }
  return "16.0";
}

function copyTargetFiles(sourceDir, iosDir) {
  const destination = path.join(iosDir, NSE_TARGET_NAME);
  fs.mkdirSync(destination, { recursive: true });
  for (const file of [...SOURCE_FILES, ...RESOURCE_FILES]) {
    fs.copyFileSync(path.join(sourceDir, file), path.join(destination, file));
  }
}

function addExtensionTarget(project, { sourceDir, iosDir, version, buildNumber, teamId }) {
  if (project.pbxTargetByName(NSE_TARGET_NAME)) return project;
  copyTargetFiles(sourceDir, iosDir);

  const objects = project.hash.project.objects;
  objects.PBXTargetDependency = objects.PBXTargetDependency || {};
  objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};

  const group = project.addPbxGroup(
    [...SOURCE_FILES, ...RESOURCE_FILES],
    NSE_TARGET_NAME,
    NSE_TARGET_NAME,
  );
  // Hang the new group under the project's main (unnamed, unpathed) group.
  const groups = project.hash.project.objects.PBXGroup;
  for (const key of Object.keys(groups)) {
    const entry = groups[key];
    if (typeof entry === "object" && entry.name === undefined && entry.path === undefined) {
      project.addToPbxGroup(group.uuid, key);
    }
  }

  // `app_extension` also creates the target dependency and the "Embed App Extensions" copy phase
  // in the main target.
  const target = project.addTarget(
    NSE_TARGET_NAME,
    "app_extension",
    NSE_TARGET_NAME,
    NSE_BUNDLE_ID,
  );
  project.addBuildPhase(SOURCE_FILES, "PBXSourcesBuildPhase", "Sources", target.uuid);
  project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
  project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);

  const deploymentTarget = firstDeploymentTarget(project);
  const configurations = project.pbxXCBuildConfigurationSection();
  for (const key of Object.keys(configurations)) {
    const settings = configurations[key].buildSettings;
    if (!settings || settings.PRODUCT_NAME !== `"${NSE_TARGET_NAME}"`) continue;
    Object.assign(settings, {
      CLANG_ENABLE_MODULES: "YES",
      CODE_SIGN_ENTITLEMENTS: `${NSE_TARGET_NAME}/${NSE_TARGET_NAME}.entitlements`,
      CODE_SIGN_STYLE: "Automatic",
      CURRENT_PROJECT_VERSION: buildNumber,
      GENERATE_INFOPLIST_FILE: "NO",
      INFOPLIST_FILE: `${NSE_TARGET_NAME}/Info.plist`,
      IPHONEOS_DEPLOYMENT_TARGET: deploymentTarget,
      LD_RUNPATH_SEARCH_PATHS:
        '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
      MARKETING_VERSION: version,
      PRODUCT_BUNDLE_IDENTIFIER: NSE_BUNDLE_ID,
      SKIP_INSTALL: "YES",
      SWIFT_VERSION: "5.0",
      TARGETED_DEVICE_FAMILY: '"1,2"',
      ...(teamId ? { DEVELOPMENT_TEAM: teamId } : {}),
    });
  }
  return project;
}

module.exports = { addExtensionTarget, firstDeploymentTarget };
