/**
 * NFT（next build 文件追踪器 @vercel/nft）静态求值屏障。
 *
 * `next build --webpack` 收集 standalone 产物时，NFT 会静态求值构建机常量：
 * os.homedir()、process.env.APPDATA / USERPROFILE / HOME 等。一旦这些「已知前缀」
 * 与运行时变量出现在同一个拼接表达式里（如 `path.join(os.homedir(), 变量)`），
 * NFT 会把未知段展开成 `**` 并真的对该前缀递归 glob —— 即扫描整个用户主目录。
 * Windows runner 上撞到 "Application Data" 等受保护 junction 即 EPERM，直接导致
 * build-windows 失败。macOS 上扫得动所以从不报错，故障只在 Windows CI 出现。
 *
 * 修法：经本模块的函数间接取根。两道防线缺一不可：
 * 1. NFT 不对用户函数调用做求值 —— 但前提是函数在产物里仍是函数；
 * 2. terser 会把平凡函数内联回去（claude-home-shadow 的 `() => os.homedir()`
 *    就是这样破防的）—— 因此函数体用 try/catch 包裹，terser 不内联含 try 的函数。
 * 不做记忆化：shadow-home 等测试会逐场景切换 HOME/USERPROFILE，缓存会让
 * 取值定格在首次调用（CI linux 上 16 个场景测试因此挂掉的教训）。
 *
 * 凡是【homedir/APPDATA 类根 + 运行时变量】的路径拼接，一律从这里取根；
 * 根 + 纯字面量的拼接不受影响，无须迁移。
 */
import os from 'os';

/** os.homedir() 的求值屏障版。 */
export function userHome(): string {
  try {
    return os.homedir();
  } catch {
    return process.env.HOME || process.env.USERPROFILE || '';
  }
}

/** HOME → USERPROFILE 兜底的求值屏障版（保持 parallel-safety 既有语义）。 */
export function envHome(): string {
  try {
    return process.env.HOME || process.env.USERPROFILE || '';
  } catch {
    return '';
  }
}

/** process.env.APPDATA 的求值屏障版（Windows 下 Electron userData 根）。 */
export function winAppData(): string | undefined {
  try {
    return process.env.APPDATA;
  } catch {
    return undefined;
  }
}
