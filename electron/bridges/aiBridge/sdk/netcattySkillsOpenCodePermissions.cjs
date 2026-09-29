"use strict";

const fs = require("node:fs");
const path = require("node:path");

function normalizeOpenCodePath(targetPath, platform = process.platform) {
  return platform === "win32"
    ? targetPath.replace(/\\/g, "/")
    : targetPath;
}

function appendOpenCodePathPattern(baseDir, suffix) {
  const trimmedSuffix = suffix.replace(/^\//, "");
  return baseDir.endsWith("/")
    ? `${baseDir}${trimmedSuffix}`
    : `${baseDir}/${trimmedSuffix}`;
}

function toOpenCodeDirectoryBase(dirPath, options = {}) {
  if (!dirPath || typeof dirPath !== "string") return null;
  const pathModule = options.pathModule || path;
  const platform = options.platform || process.platform;
  try {
    const resolved = pathModule.resolve(dirPath);
    let baseDir = resolved;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      baseDir = pathModule.dirname(resolved);
    }
    return normalizeOpenCodePath(baseDir, platform);
  } catch {
    return null;
  }
}

function toOpenCodeDirectoryGlob(dirPath, options = {}) {
  const baseDir = toOpenCodeDirectoryBase(dirPath, options);
  return baseDir ? appendOpenCodePathPattern(baseDir, "**") : null;
}

function toOpenCodeDirectoryPermissionPatterns(dirPath, options = {}) {
  const baseDir = toOpenCodeDirectoryBase(dirPath, options);
  return baseDir
    ? [
        baseDir,
        appendOpenCodePathPattern(baseDir, "*"),
        appendOpenCodePathPattern(baseDir, "**"),
      ]
    : [];
}

function toOpenCodeFileParentGlob(filePath, options = {}) {
  if (!filePath || typeof filePath !== "string") return null;
  const pathModule = options.pathModule || path;
  try {
    return toOpenCodeDirectoryGlob(pathModule.dirname(pathModule.resolve(filePath)), options);
  } catch {
    return null;
  }
}

function toOpenCodeFileParentPermissionPatterns(filePath, options = {}) {
  if (!filePath || typeof filePath !== "string") return [];
  const pathModule = options.pathModule || path;
  try {
    return toOpenCodeDirectoryPermissionPatterns(pathModule.dirname(pathModule.resolve(filePath)), options);
  } catch {
    return [];
  }
}

function dedupePatterns(patterns) {
  return [...new Set(patterns.filter(Boolean))];
}

// OpenCode discovers native agent skills from these well-known directories:
// its global config dirs (~/.opencode and ~/.config/opencode, both "skill"
// and "skills" spellings), Claude/agents-compatible dirs, project-level
// .opencode/.claude/.agents dirs, and the remote-skill download cache.
// Reads inside them must stay allowed even though Netcatty otherwise locks
// external directory access down, or loading a skill's reference files fails
// with an OpenCode permission error (issue #1939).
const OPENCODE_NATIVE_SKILL_DIR_SUFFIXES = [
  ".opencode/skill",
  ".opencode/skills",
  ".config/opencode/skill",
  ".config/opencode/skills",
  ".claude/skills",
  ".agents/skills",
  ".cache/opencode/skills",
];
const MIMO_NATIVE_SKILL_DIR_SUFFIXES = [
  ".mimocode/skill",
  ".mimocode/skills",
  ".config/mimocode/skill",
  ".config/mimocode/skills",
  ".cache/mimocode/skills",
  ".local/share/mimocode/builtin_skills",
  ".local/share/mimocode/compose",
  ".codex/skills",
];

function getNativeSkillSuffixes({ mimo = false } = {}) {
  return mimo
    ? [...OPENCODE_NATIVE_SKILL_DIR_SUFFIXES, ...MIMO_NATIVE_SKILL_DIR_SUFFIXES]
    : OPENCODE_NATIVE_SKILL_DIR_SUFFIXES;
}

function getMimoNativeSkillDirectories({ mimo = false, env = {}, pathModule = path, platform = process.platform } = {}) {
  if (!mimo) return [];
  const absolute = (value) => typeof value === "string" && pathModule.isAbsolute(value) ? value : null;
  const mimoHome = absolute(env.MIMOCODE_HOME);
  const configDir = absolute(env.MIMOCODE_CONFIG_DIR);
  const xdgConfig = absolute(env.XDG_CONFIG_HOME);
  const xdgData = absolute(env.XDG_DATA_HOME);
  const xdgCache = absolute(env.XDG_CACHE_HOME);
  const macData = platform === "darwin" && absolute(env.HOME)
    ? pathModule.join(env.HOME, "Library", "Application Support", "mimocode")
    : null;
  return [
    ...(mimoHome ? [
      pathModule.join(mimoHome, "config", "skill"),
      pathModule.join(mimoHome, "config", "skills"),
      pathModule.join(mimoHome, "data", "builtin_skills"),
      pathModule.join(mimoHome, "data", "compose"),
      pathModule.join(mimoHome, "cache", "skills"),
    ] : []),
    ...(configDir ? [pathModule.join(configDir, "skill"), pathModule.join(configDir, "skills")] : []),
    ...(xdgConfig ? [pathModule.join(xdgConfig, "mimocode", "skill"), pathModule.join(xdgConfig, "mimocode", "skills")] : []),
    ...(xdgData ? [pathModule.join(xdgData, "mimocode", "builtin_skills"), pathModule.join(xdgData, "mimocode", "compose")] : []),
    ...(xdgCache ? [pathModule.join(xdgCache, "mimocode", "skills")] : []),
    ...(macData ? [pathModule.join(macData, "builtin_skills"), pathModule.join(macData, "compose")] : []),
  ];
}

function getMimoRelativeSkillDirectory(dir, options = {}) {
  const pathModule = options.pathModule || path;
  const base = toOpenCodeDirectoryBase(dir, options);
  if (!base) return null;
  const cwd = options.cwd || process.cwd();
  const relative = pathModule.relative(pathModule.resolve(cwd), pathModule.resolve(dir));
  return normalizeOpenCodePath(relative || ".", options.platform || process.platform);
}

// OpenCode's `read` permission checks match worktree-relative paths (e.g.
// "../../.opencode/skills/foo/references/doc.md") while `external_directory`
// checks match absolute directory globs ("C:/Users/me/.opencode/skills/foo/*").
// Anchoring each well-known suffix behind a leading wildcard covers both
// forms on every platform (OpenCode normalizes "\\" to "/" before matching).
function buildOpenCodeNativeSkillPermissionPatterns(options = {}) {
  return getNativeSkillSuffixes(options).flatMap((suffix) => [
    `*${suffix}`,
    `*${suffix}/*`,
    `*${suffix}/**`,
  ]).concat(getMimoNativeSkillDirectories(options).flatMap((dir) => toOpenCodeDirectoryPermissionPatterns(dir, options)));
}

// OpenCode's default rules gate `.env` secret files behind approval. The
// broad skill-directory read allows above would win over those defaults
// (last matching rule wins), so re-deny dot-env files inside skill dirs
// after the allow entries to keep secret-file protection intact.
function buildOpenCodeNativeSkillEnvDenyPatterns(options = {}) {
  const suffixRules = getNativeSkillSuffixes(options).flatMap((suffix) => [
    `*${suffix}/**.env`,
    `*${suffix}/**.env.*`,
  ]);
  const directoryRules = getMimoNativeSkillDirectories(options).flatMap((dir) => {
    const base = toOpenCodeDirectoryBase(dir, options);
    const relative = getMimoRelativeSkillDirectory(dir, options);
    return base && relative
      ? [`${base}/**.env`, `${base}/**.env.*`, `${relative}/**.env`, `${relative}/**.env.*`]
      : [];
  });
  return suffixRules.concat(directoryRules);
}

// Base rules shared by every tool-integration mode so OpenCode's native
// skills keep working: allow loading skills and reading their files while
// still denying all other external directory access.
function buildOpenCodeNativeSkillsPermissionRules(options = {}) {
  const external_directory = { "*": "deny" };
  const read = {};
  for (const pattern of buildOpenCodeNativeSkillPermissionPatterns(options)) {
    external_directory[pattern] = "allow";
    read[pattern] = "allow";
  }
  for (const dir of getMimoNativeSkillDirectories(options)) {
    const relative = getMimoRelativeSkillDirectory(dir, options);
    if (!relative) continue;
    for (const pattern of [relative, `${relative}/*`, `${relative}/**`]) {
      read[pattern] = "allow";
    }
  }
  for (const pattern of buildOpenCodeNativeSkillEnvDenyPatterns(options)) {
    read[pattern] = "deny";
  }
  return {
    skill: "allow",
    read,
    external_directory,
  };
}

function buildNetcattySkillsOpenCodePathAllowlist({
  launcherPath,
  cliScriptPath,
  skillPath,
  discoveryFilePath,
  cliStateDir,
  runtimeBinaryPath,
  tempDir,
  extraFilePaths,
} = {}, options = {}) {
  const filePaths = [
    launcherPath,
    cliScriptPath,
    skillPath,
    discoveryFilePath,
    runtimeBinaryPath,
    ...(Array.isArray(extraFilePaths) ? extraFilePaths : []),
  ];
  return dedupePatterns([
    ...filePaths.flatMap((filePath) => toOpenCodeFileParentPermissionPatterns(filePath, options)),
    ...(cliStateDir ? toOpenCodeDirectoryPermissionPatterns(cliStateDir, options) : []),
    ...(tempDir ? toOpenCodeDirectoryPermissionPatterns(tempDir, options) : []),
  ]);
}

function buildOpenCodeSkillsPermissionRules(pathAllowlist = [], nativeSkillOptions = {}) {
  const { read, external_directory } = buildOpenCodeNativeSkillsPermissionRules(nativeSkillOptions);
  for (const pattern of pathAllowlist) {
    external_directory[pattern] = "allow";
    read[pattern] = "allow";
  }

  return {
    bash: "allow",
    read,
    list: "deny",
    glob: "deny",
    grep: "deny",
    skill: "allow",
    external_directory,
  };
}

module.exports = {
  buildNetcattySkillsOpenCodePathAllowlist,
  buildOpenCodeNativeSkillEnvDenyPatterns,
  buildOpenCodeNativeSkillPermissionPatterns,
  buildOpenCodeNativeSkillsPermissionRules,
  buildOpenCodeSkillsPermissionRules,
  toOpenCodeDirectoryPermissionPatterns,
  toOpenCodeDirectoryGlob,
  toOpenCodeFileParentPermissionPatterns,
  toOpenCodeFileParentGlob,
};
