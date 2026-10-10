'use strict';

const fs = require('node:fs');

function writeManifest(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function readManifest(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

module.exports = { writeManifest, readManifest };
