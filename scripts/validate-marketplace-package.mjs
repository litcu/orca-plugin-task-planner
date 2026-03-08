import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const packagePath = path.join(repoRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

const errors = [];
const warnings = [];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeRepoUrl(input) {
  if (!isNonEmptyString(input)) {
    return "";
  }

  const value = input.trim();
  if (value.startsWith("git@github.com:")) {
    return `https://github.com/${value.slice("git@github.com:".length).replace(/\.git$/, "")}`;
  }

  return value
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/^git:\/\//, "https://");
}

function getRepositoryUrl() {
  if (typeof packageJson.repository === "string") {
    return normalizeRepoUrl(packageJson.repository);
  }

  if (packageJson.repository && typeof packageJson.repository === "object") {
    return normalizeRepoUrl(packageJson.repository.url);
  }

  try {
    const remote = execSync("git config --get remote.origin.url", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return normalizeRepoUrl(remote);
  } catch {
    return "";
  }
}

function validateGithubUsername(value) {
  return /^[A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38}$/.test(value);
}

function readPngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new Error(`文件不是合法 PNG：${filePath}`);
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function getIconInfo() {
  const svgPath = path.join(repoRoot, "icon.svg");
  if (fs.existsSync(svgPath)) {
    return {
      type: "svg",
      path: svgPath,
      content: fs.readFileSync(svgPath, "utf8").trim(),
    };
  }

  const pngPath = path.join(repoRoot, "icon.png");
  if (fs.existsSync(pngPath)) {
    const { width, height } = readPngDimensions(pngPath);
    return {
      type: "png",
      path: pngPath,
      width,
      height,
      content: fs.readFileSync(pngPath).toString("base64"),
    };
  }

  return null;
}

const marketplace = packageJson.orcaNoteMarketplace ?? {};
const translationsZh = marketplace.translations?.zh ?? {};

const requiredStringFields = ["name", "description", "version", "license", "author"];
for (const field of requiredStringFields) {
  if (!isNonEmptyString(packageJson[field])) {
    errors.push(`package.json 缺少必填字段 \`${field}\`，或其值为空。`);
  }
}

if (!Array.isArray(packageJson.keywords) || packageJson.keywords.length === 0) {
  errors.push("package.json 缺少必填字段 `keywords`，或其值不是非空数组。");
} else if (packageJson.keywords.some((keyword) => !isNonEmptyString(keyword))) {
  errors.push("package.json 的 `keywords` 必须全部为非空字符串。");
}

if (isNonEmptyString(packageJson.name) && !packageJson.name.startsWith("orca-plugin-")) {
  errors.push("package.json 的 `name` 必须以 `orca-plugin-` 开头。");
}

if (isNonEmptyString(packageJson.author)) {
  if (packageJson.author.includes("@")) {
    errors.push("package.json 的 `author` 必须填写真实 GitHub 用户名，不能填写邮箱地址。");
  } else if (!validateGithubUsername(packageJson.author.trim())) {
    errors.push("package.json 的 `author` 必须是合法的 GitHub 用户名格式。");
  }
}

if (!isNonEmptyString(marketplace.id)) {
  errors.push("package.json 缺少 `orcaNoteMarketplace.id`。");
} else if (!/^[A-Za-z0-9_-]+$/.test(marketplace.id)) {
  errors.push("`orcaNoteMarketplace.id` 只能包含英文字母、数字、连字符和下划线。");
}

if (!isNonEmptyString(marketplace.name)) {
  errors.push("package.json 缺少 `orcaNoteMarketplace.name`。");
}

if (!isNonEmptyString(marketplace.category)) {
  errors.push("package.json 缺少 `orcaNoteMarketplace.category`。");
}

if (!isNonEmptyString(marketplace.artifactName)) {
  errors.push("package.json 缺少 `orcaNoteMarketplace.artifactName`。");
}

if (!isNonEmptyString(translationsZh.description)) {
  errors.push("package.json 缺少 `orcaNoteMarketplace.translations.zh.description`。");
}

if (!isNonEmptyString(translationsZh.category)) {
  errors.push("package.json 缺少 `orcaNoteMarketplace.translations.zh.category`。");
}

const repositoryUrl = getRepositoryUrl();
if (!repositoryUrl) {
  errors.push("未能解析 GitHub 仓库地址，无法生成 `home` 和 `zip` 链接。");
} else if (!repositoryUrl.startsWith("https://github.com/")) {
  errors.push("当前仓库地址不是 GitHub，无法直接用于 awesome-orcanote 的 `home` / `zip` 字段。");
}

const licensePath = path.join(repoRoot, "LICENSE");
if (!fs.existsSync(licensePath)) {
  errors.push("仓库根目录缺少 `LICENSE` 文件；awesome-orcanote 要求发布包中必须包含该文件。");
}

const iconInfo = getIconInfo();
if (!iconInfo) {
  errors.push("仓库根目录缺少 `icon.png` 或 `icon.svg`；awesome-orcanote 要求必须提供图标。");
} else if (iconInfo.type === "png" && (iconInfo.width > 80 || iconInfo.height > 80)) {
  errors.push(
    `当前 icon.png 尺寸为 ${iconInfo.width}x${iconInfo.height}，超过 awesome-orcanote 要求的 80x80 上限。`,
  );
}

if (errors.length > 0) {
  console.error("市场提交流程校验失败：\n");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  if (warnings.length > 0) {
    console.error("\n附加提示：");
    for (const warning of warnings) {
      console.error(`- ${warning}`);
    }
  }
  process.exit(1);
}

const version = packageJson.version;
const zipFileName = `${marketplace.artifactName}-v${version}.zip`;
const pluginEntry = {
  author: packageJson.author,
  id: marketplace.id,
  name: marketplace.name,
  description: packageJson.description,
  category: marketplace.category,
  [iconInfo.type === "svg" ? "icon_svg" : "icon_png"]: iconInfo.content,
  version,
  updated: new Date().toISOString(),
  home: repositoryUrl,
  zip: `${repositoryUrl}/releases/download/v${version}/${zipFileName}`,
  translations: {
    zh: {
      description: translationsZh.description,
      category: translationsZh.category,
    },
  },
};

console.log("市场提交流程校验通过。\n");
console.log("已满足当前 awesome-orcanote 的核心校验项：");
console.log("- package.json 必填元数据");
console.log("- GitHub 用户名 author");
console.log("- plugins.json 所需扩展元数据");
console.log("- LICENSE 文件存在");
console.log(`- 图标文件存在且尺寸符合要求（${iconInfo.type.toUpperCase()}）`);
console.log("");

if (warnings.length > 0) {
  console.log("附加提示：");
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
  console.log("");
}

console.log("请将以下对象插入 awesome-orcanote 的 `plugins.json`，并按 author、id 排序：");
console.log(JSON.stringify(pluginEntry, null, 2));
console.log("");
console.log("提示：`updated` 可在提交 PR 前按实际提交时间或发布时间微调。");
