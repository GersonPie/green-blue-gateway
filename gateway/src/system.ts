import { exec, execSync, spawn, spawnSync } from 'node:child_process';
import { Log } from './functions.ts';
import { _STARTING_PORT, _MAX_CONTAINERS, _BASE_URL } from './index.js';
import { promisify } from 'node:util';

interface RunningApps {
    name: unknown;
    port: number;
}

const check_running_apps = async () => {
    Log.system('running check_running_apps()');
    
    const running_apps: RunningApps[] = [];

    for (let i = 0; i < _MAX_CONTAINERS; i++) {

        const port = _STARTING_PORT + i;

    

        try {
            const response = await fetch(
                `${_BASE_URL}${port}/name`
            );

            if (response.ok) {
                const data = await response.json();
                
                running_apps.push({
                    port,
                    ...data
                });
            }

            else {
                Log.system(`${port} is offline`)
            }
        } catch (err) {
            Log.error(
                'system.ts',
                `error occurred while fetching ${_BASE_URL}${port}/name`
            );
        }
    }
    Log.system(`👍found ${running_apps.length} running containers`)
    running_apps.map((app)=>{
        return Log.system(`name: ${app.name} | PORT: ${app.port}`)
    })
    return running_apps;
};


const run_command = async (command:string)=>{
   const execAsync = promisify(exec)

    // const child = await execAsync(`${command}`)
    
    const child = await execAsync(`${command}`)
    
    if(child.stderr)Log.error('system.ts', child.stderr)
    
    return Log.system(child.stdout)
    
    

}

export { check_running_apps , run_command}; 