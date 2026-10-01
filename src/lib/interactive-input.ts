/**
 * Interactive input handling for multi-line input
 */

import * as readline from 'node:readline';
import chalk from 'chalk';

export interface InteractiveInputOptions {
  secret?: boolean;
  prompt?: string;
  hint?: string;
  /**
   * Number of consecutive empty lines to trigger completion
   * Default: 2 (press Enter twice)
   */
  emptyLinesToComplete?: number;
}

/**
 * Read multi-line input from the user interactively
 * Completes when user presses Enter twice or Ctrl+D
 */
export async function readInteractiveInput(
  options: InteractiveInputOptions = {}
): Promise<string> {
  if (options.secret && process.stdin.isTTY) {
    throw new Error('Interactive secret entry is disabled. Pipe credentials from a local file or clipboard into stdin.');
  }
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf-8');
  }
  const {
    prompt = 'Paste your input (press Enter twice when done):',
    hint = 'Tip: You can also press Ctrl+D to finish',
    emptyLinesToComplete = 2,
  } = options;

  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    let consecutiveEmptyLines = 0;

    console.log(chalk.bold(`\n${prompt}`));
    console.log(chalk.gray(hint));
    console.log();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    rl.on('line', (line) => {
      if (line.trim() === '') {
        consecutiveEmptyLines++;
        if (consecutiveEmptyLines >= emptyLinesToComplete) {
          rl.close();
          // Remove trailing empty lines
          while (lines.at(-1)?.trim() === '') {
            lines.pop();
          }
          resolve(lines.join('\n'));
          return;
        }
      } else {
        consecutiveEmptyLines = 0;
      }
      lines.push(line);
    });

    rl.on('close', () => {
      // Remove trailing empty lines
      while (lines.at(-1)?.trim() === '') {
        lines.pop();
      }
      resolve(lines.join('\n'));
    });

    rl.on('error', reject);

    // Handle Ctrl+C
    rl.on('SIGINT', () => {
      rl.close();
      process.exit(130);
    });
  });
}

/**
 * Check if we're running in an interactive terminal
 */
export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY);
}

/**
 * Check if there's piped input available
 */
export function hasPipedInput(): boolean {
  return !process.stdin.isTTY;
}
