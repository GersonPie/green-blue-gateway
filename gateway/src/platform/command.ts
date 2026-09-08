import { spawn } from 'node:child_process';

export interface CommandOptions { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; signal?: AbortSignal; log?: (text: string) => void; mergeOutput?: boolean }
export type Command = (file: string, args: string[], options?: CommandOptions) => Promise<string>;

export function commandEnvironment(): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY']) {
        if (process.env[key]) environment[key] = process.env[key];
    }
    return environment;
}

export const command: Command = (file, args, options = {}) => new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: options.cwd, env: options.env || commandEnvironment(), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal: options.signal });
    let output = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, options.timeout || 30000);
    const capture = (chunk: Buffer, error: boolean) => {
        const text = chunk.toString();
        if (error) stderr = (stderr + text).slice(-16000);
        if (!error || options.mergeOutput) output = (output + text).slice(-1048576);
        options.log?.(text);
    };
    child.stdout.on('data', (chunk: Buffer) => capture(chunk, false));
    child.stderr.on('data', (chunk: Buffer) => capture(chunk, true));
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && !timedOut) resolve(output.trim());
        else reject(new Error(timedOut ? `${file} timed out` : `${file} failed (${code}): ${stderr.slice(-2000)}`));
    });
});
