const minimum = { major: 20, minor: 12, patch: 0 };

function parseVersion(version) {
  const [major = 0, minor = 0, patch = 0] = version
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  return { major, minor, patch };
}

function compareVersions(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

const current = parseVersion(process.versions.node);

if (compareVersions(current, minimum) < 0) {
  console.error(
    `[BunnyFy] Node.js ${process.versions.node} incompatível. ` +
      `Use Node.js >= ${minimum.major}.${minimum.minor}.${minimum.patch}.`,
  );
  process.exit(1);
}

if (current.major === 20) {
  console.warn(
    `[BunnyFy] Node.js ${process.versions.node} está na linha 20, ` +
      'mantida apenas por compatibilidade temporária com o primeiro ambiente de hospedagem.',
  );
}
