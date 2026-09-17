// electron-builder afterPack hook: strips Chromium files the widget never uses
// so the installed app takes less disk space.
const fs = require('fs');
const path = require('path');

// DirectX shader compiler used only by WebGPU, which the app does not use.
const UNUSED = ['dxcompiler.dll', 'dxil.dll'];

exports.default = async function afterPack(context) {
  for (const name of UNUSED) {
    const file = path.join(context.appOutDir, name);
    if (fs.existsSync(file)) {
      fs.rmSync(file);
      console.log(`  • removed unused ${name}`);
    }
  }
};
