import { spawn } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Execute a command with stdin input.
 * Returns true if the command succeeded (exit code 0).
 */
function execWithStdin(command: string, args: string[], input: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ['pipe', 'ignore', 'ignore'],
    });

    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));

    child.stdin?.write(input);
    child.stdin?.end();
  });
}

export async function copyToClipboard(text: string): Promise<boolean> {
  const os = platform();

  try {
    if (os === 'darwin') {
      // macOS: use pbcopy
      return await execWithStdin('pbcopy', [], text);
    } else if (os === 'linux') {
      // Linux: try xclip first, then xsel
      const xclipResult = await execWithStdin('xclip', ['-selection', 'clipboard'], text);
      if (xclipResult) return true;
      return await execWithStdin('xsel', ['--clipboard', '--input'], text);
    } else if (os === 'win32') {
      // Windows: use clip.exe
      return await execWithStdin('clip', [], text);
    }
    return false;
  } catch {
    return false;
  }
}
