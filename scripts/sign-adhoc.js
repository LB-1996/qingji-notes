// 打包后给 macOS 的 .app 做 ad-hoc 签名（electron-builder 的 afterPack 钩子）。
//
// 为什么必须做：项目没有 Apple 开发者证书，package.json 里 mac.identity 设成了 null，
// electron-builder 会「完全跳过」签名。这样产出的 .app 只带链接器自动加的 ad-hoc 签名，
// 没有 sealed resources、Info.plist 未绑定 —— 在 Apple 芯片的 macOS 上会被判定成
// 「已损坏 / 签名已被吊销」，不但双击打不开，还可能被 XProtect 直接移到废纸篓。
//
// ad-hoc 签名（codesign -s -）不需要任何证书、不联网，能让 App 在本机正常运行。
// 注意：它仍然不是「公证过」的签名，别人第一次打开还是会看到「无法验证开发者」，
// 右键「打开」即可 —— 要去掉那个提示需要付费的 Apple 开发者账号 + notarize。
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function signAdhoc(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  console.log('  • ad-hoc 签名      app=' + app);

  // --deep：连里面的 Framework / Helper 一起签（顺序由 codesign 处理，先内后外）
  // --timestamp=none：ad-hoc 不需要时间戳服务器，避免联网失败
  execFileSync('codesign', ['--force', '--deep', '--timestamp=none', '--sign', '-', app], { stdio: 'inherit' });
  // 签完立刻校验，签坏了就让打包直接失败，而不是产出一个打不开的包
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });

  console.log('  • ad-hoc 签名完成  校验通过');
};
