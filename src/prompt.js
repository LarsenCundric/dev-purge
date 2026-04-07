import { createInterface } from "node:readline";

/**
 * Ask a yes/no question. Returns true for yes, false for no.
 */
export function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`${question} (y/n) `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === "y" || a === "yes");
    });
  });
}
