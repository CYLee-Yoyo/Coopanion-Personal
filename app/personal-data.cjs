/** A packaged Windows installation keeps one physical data directory across launch contexts. */
const { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } = require('node:fs');
const { isAbsolute } = require('node:path');

function pinnedDataDirectory(fallback, locationFile) {
  const read = () => {
    const directory = JSON.parse(readFileSync(locationFile, 'utf8')).directory;
    if (typeof directory !== 'string' || !isAbsolute(directory) || !existsSync(directory) || !statSync(directory).isDirectory())
      throw new Error('The personal data location is unavailable. Restore it before starting.');
    return directory;
  };
  if (existsSync(locationFile)) return read();
  mkdirSync(fallback, { recursive: true });
  const directory = realpathSync.native(fallback);
  try { writeFileSync(locationFile, JSON.stringify({ directory }) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code === 'EEXIST') return read(); throw error; }
  return directory;
}

module.exports = { pinnedDataDirectory };
