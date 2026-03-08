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

const repositoryUrl = getRepositoryUrl();
if (!repositoryUrl) {
  warnings.push("未能解析仓库地址；后续提交 awesome-orcanote PR 时需要手动填写 `repo` 和 `releases`。");
} else if (!repositoryUrl.startsWith("https://github.com/")) {
  warnings.push("当前仓库地址不是 GitHub；awesome-orcanote 的插件索引通常使用 GitHub 仓库与 Releases 链接。");
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

console.log("市场提交流程校验通过。\n");
console.log("已满足官方要求中的 package.json 必填元数据校验：");
console.log("- name");
console.log("- description");
console.log("- version");
console.log("- keywords");
console.log("- license");
console.log("- author\n");

if (warnings.length > 0) {
  console.log("附加提示：");
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
  console.log("");
}

if (repositoryUrl) {
  const submissionFileName = packageJson.name.replace(/^orca-plugin-/, "");
  const submissionJson = {
    name: packageJson.name,
    description: packageJson.description,
    version: packageJson.version,
    author: packageJson.author,
    repo: repositoryUrl,
    releases: `${repositoryUrl}/releases`,
  };

  console.log(`建议在 awesome-orcanote 中新增文件：plugins/${submissionFileName}.json`);
  console.log("建议提交内容：");
  console.log(JSON.stringify(submissionJson, null, 2));
}
