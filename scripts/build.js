const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function parseArgs() {
  const args = process.argv.slice(2);
  let apiKey = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (
      arg.startsWith("--api-key=") ||
      arg.startsWith("--api-keys=") ||
      arg.startsWith("--key=") ||
      arg.startsWith("-k=")
    ) {
      apiKey = arg.split("=").slice(1).join("=").trim();
    } else if (
      arg === "--api-key" ||
      arg === "--api-keys" ||
      arg === "--key" ||
      arg === "-k"
    ) {
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        apiKey = args[i + 1].trim();
        i++;
      }
    } else if (!arg.startsWith("-") && !apiKey) {
      apiKey = arg.trim();
    }
  }

  return apiKey;
}

async function build() {
  const rootDir = path.resolve(__dirname, "..");
  const packageJsonPath = path.join(rootDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const version = packageJson.version;
  const outputFileName = `diff-draft-v${version}.vsix`;
  const outputFilePath = path.join(rootDir, outputFileName);

  const apiKey = parseArgs();

  console.log(`[build] Building extension version v${version}...`);
  if (apiKey) {
    console.log(`[build] API key(s) assigned: ${apiKey.substring(0, 8)}...`);
  } else {
    console.log(`[build] No API key argument provided.`);
  }

  const vscodeIgnorePath = path.join(rootDir, ".vscodeignore");
  const envPath = path.join(rootDir, ".env");
  let originalVscodeIgnore = null;
  let originalEnv = null;

  if (fs.existsSync(vscodeIgnorePath)) {
    originalVscodeIgnore = fs.readFileSync(vscodeIgnorePath, "utf8");
  }
  if (fs.existsSync(envPath)) {
    originalEnv = fs.readFileSync(envPath, "utf8");
  }

  try {
    if (apiKey) {
      // Write .env with OVERRIDE_API_KEYS
      fs.writeFileSync(envPath, `OVERRIDE_API_KEYS=${apiKey}\n`, "utf8");

      // Temporarily remove .env from .vscodeignore so vsce includes it
      if (originalVscodeIgnore) {
        const lines = originalVscodeIgnore
          .split("\n")
          .filter((line) => line.trim() !== ".env");
        fs.writeFileSync(vscodeIgnorePath, lines.join("\n"), "utf8");
      }
    }

    // Run vsce package to create diff-draft-v{version}.vsix
    const vsceFlags = apiKey ? "--allow-package-env-file " : "";
    console.log(`[build] Packaging extension into ${outputFileName}...`);
    execSync(`npx @vscode/vsce package ${vsceFlags}-o "${outputFileName}"`, {
      stdio: "inherit",
      cwd: rootDir,
    });

    if (fs.existsSync(outputFilePath)) {
      const stats = fs.statSync(outputFilePath);
      const sizeKb = (stats.size / 1024).toFixed(2);
      console.log(`\n✅ Build successful!`);
      console.log(`   Output: ${outputFileName} (${sizeKb} KB)`);
      console.log(`   Location: ${outputFilePath}`);
      if (apiKey) {
        console.log(`   API Key embedded: YES (OVERRIDE_API_KEYS in .env)`);
      }
    } else {
      throw new Error(
        `Expected output file ${outputFileName} was not created.`,
      );
    }
  } finally {
    // Restore original .vscodeignore and .env
    if (originalVscodeIgnore !== null) {
      fs.writeFileSync(vscodeIgnorePath, originalVscodeIgnore, "utf8");
    }
    if (originalEnv !== null) {
      fs.writeFileSync(envPath, originalEnv, "utf8");
    }
  }
}

build().catch((err) => {
  console.error(`❌ Build failed:`, err);
  process.exit(1);
});
